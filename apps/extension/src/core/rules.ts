// Pure: turn sessions + tab bindings into declarativeNetRequest session rules.
// No chrome.* calls — only the rule OBJECTS, so every decision below is testable.

import {
  DOMAIN_RULE_TIER, HOST_RULE_TIER, MAX_PATH_PRIORITY, PRIORITY_LABEL_SPAN, PRIORITY_TIER_SPAN,
  RULE_ID_BASE, RULE_RESOURCE_TYPES, RULE_SCHEMES, STRIP_RULE_PRIORITY,
} from './constants';
import { domainMatches, serializeCookieHeader } from './cookies';
import type {
  CookieRecord, HeaderEdit, Session, SessionId, TabBindings, TabId, TabRule,
} from '@/domain/types';

/** Everything needed to decide what every bound tab should send. Passed in rather than
 *  read, so this module stays pure and testable with plain objects.
 *
 *  Deliberately NO tab url. Rules used to be computed from the url a tab was on, and
 *  a tab is always on `about:blank` when it is bound, so the rule installed before
 *  its first real request said "send no cookies". That request went out signed out,
 *  an app that redirects signed-out users (any AuthKit/OAuth app) bounced it to its
 *  login page, and the correct rule arrived a moment too late. Rules are now a
 *  function of the session alone, scoped by request url. */
export interface RuleInput {
  readonly bindings: TabBindings;
  readonly sessions: Readonly<Record<SessionId, Session>>;
  readonly now?: number;
}

/** One rule before it has an id, so ids can be assigned once over the whole set. */
type DraftRule = Omit<TabRule, 'id'>;

/** Set-Cookie never reaches the shared jar from a bound tab. See buildSessionRules. */
const STRIP_SET_COOKIE: HeaderEdit = { header: 'set-cookie', operation: 'remove' };
const STRIP_COOKIE: HeaderEdit = { header: 'cookie', operation: 'remove' };

/** RE2 has the same metacharacters as JS for everything a hostname or path can hold. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The url pattern for "this host (or its subdomains), this cookie path, these schemes".
 *
 * Port is optional because a cookie records no port: a `localhost` cookie is sent to
 * every localhost port, exactly as the browser does. The path tail follows RFC 6265
 * §5.1.4: `/api` matches `/api`, `/api/x` and `/api?q`, never `/apix`.
 */
export function urlPattern(
  schemes: readonly string[],
  host: string,
  path: string,
  subdomainsOnly: boolean,
): string {
  const scheme = `(?:${schemes.map(escapeRegex).join('|')})`;
  const sub = subdomainsOnly ? '[^/?#]+\\.' : '';
  const tail = path.endsWith('/') ? '' : '(?:[/?#]|$)';
  return `^${scheme}://${sub}${escapeRegex(host)}(?::[0-9]+)?${escapeRegex(path)}${tail}`;
}

/** See the priority layering doc in constants.ts. */
export function rulePriority(tier: number, host: string, path: string): number {
  const labels = host.split('.').length;
  return tier * PRIORITY_TIER_SPAN + labels * PRIORITY_LABEL_SPAN + Math.min(path.length, MAX_PATH_PRIORITY);
}

/** A host a token-injection session may send its bearer token to: the site itself and
 *  any host it has collected cookies from. Never every host — a token sent to an
 *  analytics domain the page loads is a leaked credential. */
function tokenHosts(session: Session): Set<string> {
  const hosts = new Set(session.domains.map((d) => d.toLowerCase()));
  try { hosts.add(new URL(session.site).hostname.toLowerCase()); } catch { /* malformed site */ }
  return hosts;
}

/**
 * Rules for one (host, path) pair: one per distinct header value across schemes.
 *
 * Usually the http and https values are equal and collapse into one rule; they differ
 * only when the jar holds a `Secure` cookie for a non-localhost host.
 */
function hostPathRules(params: {
  readonly tabId: TabId;
  readonly jar: readonly CookieRecord[];
  readonly host: string;
  readonly path: string;
  readonly subdomainsOnly: boolean;
  readonly tier: number;
  readonly bearer: string | null;
  readonly now: number;
}): DraftRule[] {
  const byValue = new Map<string, string[]>();
  for (const scheme of RULE_SCHEMES) {
    const value = serializeCookieHeader(params.jar, `${scheme}://${params.host}${params.path}`, params.now);
    byValue.set(value, [...(byValue.get(value) ?? []), scheme]);
  }

  const out: DraftRule[] = [];
  for (const [value, schemes] of byValue) {
    const requestHeaders: HeaderEdit[] = [
      value ? { header: 'cookie', operation: 'set', value } : STRIP_COOKIE,
    ];
    if (params.bearer) {
      requestHeaders.push({ header: 'authorization', operation: 'set', value: `Bearer ${params.bearer}` });
    }
    // A rule that would only repeat the strip rule is noise in a limited rule budget.
    if (!value && !params.bearer) continue;
    out.push({
      priority: rulePriority(params.tier, params.host, params.path),
      tabId: params.tabId,
      urlRegex: urlPattern(schemes, params.host, params.path, params.subdomainsOnly),
      resourceTypes: RULE_RESOURCE_TYPES,
      requestHeaders,
      responseHeaders: [STRIP_SET_COOKIE],
    });
  }
  return out;
}

/** Every rule one bound tab needs, before ids are assigned. */
function rulesForTab(tabId: TabId, session: Session, now: number): DraftRule[] {
  const jar = session.cookies;
  const bearer = session.engine === 'token-injection' ? session.bearerToken : null;
  const bearerHosts = bearer ? tokenHosts(session) : new Set<string>();

  // The STRIP rule: no Cookie on any request, no Set-Cookie on any response.
  //
  // Removing Cookie is the non-obvious half: without it the tab rides the shared jar's
  // existing login and arrives already signed in, so a second session is impossible.
  // Removing Set-Cookie stops a session tab from signing the whole browser in — measured:
  // a plain tab signed in as alice became bob the moment a session tab signed in as bob.
  // Safe for us: the session's own copy comes from observational webRequest, which reads
  // the response independently of what declarativeNetRequest does to it.
  const rules: DraftRule[] = [{
    priority: STRIP_RULE_PRIORITY,
    tabId,
    urlRegex: null,
    resourceTypes: RULE_RESOURCE_TYPES,
    requestHeaders: [STRIP_COOKIE],
    responseHeaders: [STRIP_SET_COOKIE],
  }];

  // Exact hosts: every host a cookie names, plus every host the token may go to.
  const hosts = new Set([...jar.map((c) => c.domain.toLowerCase()), ...bearerHosts]);
  for (const host of [...hosts].sort()) {
    const paths = new Set(['/', ...jar.filter((c) => domainMatches(c, host)).map((c) => c.path)]);
    for (const path of [...paths].sort()) {
      rules.push(...hostPathRules({
        tabId, jar, host, path, subdomainsOnly: false, tier: HOST_RULE_TIER,
        bearer: bearerHosts.has(host) ? bearer : null, now,
      }));
    }
  }

  // Parent domains: a `Domain=example.com` cookie must also reach a subdomain the
  // session never recorded. Only domain cookies apply there; host-only ones never do.
  const domainJar = jar.filter((c) => !c.hostOnly);
  const domains = new Set(domainJar.map((c) => c.domain.toLowerCase()));
  for (const domain of [...domains].sort()) {
    const paths = new Set(['/', ...domainJar.filter((c) => domainMatches(c, domain)).map((c) => c.path)]);
    for (const path of [...paths].sort()) {
      rules.push(...hostPathRules({
        tabId, jar: domainJar, host: domain, path, subdomainsOnly: true, tier: DOMAIN_RULE_TIER,
        bearer: null, now,
      }));
    }
  }

  return rules;
}

/**
 * Build every bound tab's rules.
 *
 * Per tab: one priority-1 STRIP rule covering every request, then higher-priority rules
 * that SET the session's Cookie header, each scoped to the host (and cookie path) that
 * owns those cookies. DNR cannot patch a header, only replace it, so each value is the
 * full header for that host and path.
 *
 * Scoping is what stops one host's cookies reaching another: a single tab-wide `set`
 * sent the app's session cookie to every analytics, CDN and SSO host the page loaded.
 *
 * A `token-injection` session additionally sets Authorization on its own hosts, the
 * one fully reliable path for apps we control: no jar, no race, no shim.
 *
 * Ids are assigned sequentially from RULE_ID_BASE over the whole set, so they are unique
 * within one sync and carry no meaning across syncs.
 */
export function buildSessionRules(input: RuleInput): TabRule[] {
  const now = input.now ?? Date.now();
  const drafts: DraftRule[] = [];

  for (const [tabIdStr, sessionId] of Object.entries(input.bindings)) {
    const tabId = Number(tabIdStr);
    if (!Number.isInteger(tabId) || tabId < 0) continue;
    const session = input.sessions[sessionId];
    if (!session) continue;
    drafts.push(...rulesForTab(tabId, session, now));
  }

  return drafts.map((d, i) => ({ id: RULE_ID_BASE + i, ...d }));
}

/** One header edit in a canonical, order-independent form. */
function headerKey(h: HeaderEdit): string {
  return JSON.stringify([h.header.toLowerCase(), h.operation, h.value ?? null]);
}

/**
 * A rule's identity without its id: what it matches and what it does.
 *
 * Ids are reassigned on every sync, so "is the right rule installed" has to compare
 * content. Comparing ids alone is how a tab was confirmed against a rule that said
 * "send no cookies" and then navigated signed out.
 *
 * Canonical (lists sorted, absent value = null) because the same rule read back from
 * Chrome need not preserve our field or list order, and a false mismatch here makes the
 * caller refuse to open the tab at all.
 */
export function ruleSignature(rule: Omit<TabRule, 'id'>): string {
  return JSON.stringify([
    rule.tabId, rule.priority, rule.urlRegex,
    [...rule.resourceTypes].sort(),
    rule.requestHeaders.map(headerKey).sort(),
    rule.responseHeaders.map(headerKey).sort(),
  ]);
}

/**
 * True when `installed` holds exactly the rules `expected` asks for this tab, no more
 * and no fewer. "No more" matters: a leftover rule from the tab's previous session
 * would keep sending that session's cookies.
 */
export function tabRulesMatch(
  expected: readonly Omit<TabRule, 'id'>[],
  installed: readonly Omit<TabRule, 'id'>[],
  tabId: TabId,
): boolean {
  const want = expected.filter((r) => r.tabId === tabId).map(ruleSignature).sort();
  const have = installed.filter((r) => r.tabId === tabId).map(ruleSignature).sort();
  return want.length > 0 && JSON.stringify(want) === JSON.stringify(have);
}
