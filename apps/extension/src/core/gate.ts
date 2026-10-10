// Pure: the sign-in gate. Stop a persona tab BEFORE it visits a website Tabsona is not
// allowed on, instead of noticing afterwards that it came back as the browser's user.
//
// THE FLOW THIS REPLACES, in the user's words: "lets fix the borken or irititaitng flow".
// A persona tab's sign-in went app → api.workos.com → auth.franchiseatlas.ai →
// *.authkit.app. Tabsona was allowed on the app only, and a header rule applies only on a
// host the extension may touch, so the hop to the provider carried the BROWSER's own
// login, the provider answered as the browser's user, and the persona came back signed in
// as them. The cookies were then saved into the persona, an alert appeared one host at a
// time, and the user had to forget the login and start again — a flow nobody worked out.
//
// What a rule CAN do on a host without permission is block (measured in
// spike/probe-gate.mjs): a session rule `{tabIds:[tab], resourceTypes:[main_frame]}` with
// action `block` stops the navigation before any request leaves, and
// `webNavigation.onErrorOccurred` reports the exact url that was stopped, including the
// target of a server redirect. A `redirect` to an extension page does NOT apply without
// host access (the navigation simply proceeds), so the engine replaces the stopped tab
// with the gate page itself.
//
// Chrome-free on purpose (boundary test): this module only decides; engine/gate.ts acts.

import { coversAllSites } from './hostAccess';
import { BLOCKED_BY_CLIENT_ERROR, FORM_HINT_MAX_AGE_MS, FORM_METHOD_POST, LEAK_WINDOW_MS } from './constants';
import type { GateRule, Origin, SessionId, TabBindings, TabId } from '@/domain/types';

/** `urlFilter` for "any http(s) url": `|` anchors at the start, and `http` prefixes both
 *  schemes. A urlFilter, not a regex, so the gate spends none of Chrome's regex-rule budget
 *  on its per-tab block rules. */
export const GATE_BLOCK_URL_FILTER = '|http';

/** Schemes a Chrome match pattern's `*` scheme stands for. */
const WILDCARD_SCHEMES = ['http', 'https'] as const;

/** RE2 has the same metacharacters as JS for everything a hostname can hold. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The RE2 pattern for the request urls one granted Chrome match pattern covers, or null
 * when it cannot be one rule (every website, a non-web scheme, or malformed).
 *
 * Mirrors Chrome's match-pattern rules for hosts: `*.example.com` is the domain and every
 * subdomain, an explicit port is exact, and no port means any port. The path is ignored,
 * because Tabsona only ever grants `origin/*`.
 *
 * Why not `excludedRequestDomains`, which would need no regex at all: a DNR domain list
 * ignores ports and always includes subdomains, so granting `localhost:8790` would exempt
 * every localhost port and granting `example.com` would exempt `auth.example.com` that
 * nobody allowed — exactly the hop the gate exists to stop.
 */
export function grantRegex(pattern: string): string | null {
  const m = /^(\*|https?):\/\/([^/]+)\/.*$/.exec(pattern);
  if (!m) return null;
  const [, scheme = '', hostPort = ''] = m;
  if (hostPort === '*') return null; // every website: no gate at all, see buildGateRules

  const portMatch = /^(.*?)(?::(\d+))?$/.exec(hostPort);
  const host = portMatch?.[1] ?? '';
  const port = portMatch?.[2];
  if (!host) return null;

  const schemes = scheme === '*' ? WILDCARD_SCHEMES : [scheme];
  const wildcard = host.startsWith('*.');
  const bare = wildcard ? host.slice(2) : host;
  if (!bare || bare.includes('*')) return null;

  const schemePart = `(?:${schemes.join('|')})`;
  const subPart = wildcard ? '(?:[^/?#@]+\\.)?' : '';
  const portPart = port === undefined ? '(?::[0-9]+)?' : `:${port}`;
  return `^${schemePart}://${subPart}${escapeRegex(bare.toLowerCase())}${portPart}(?:[/?#]|$)`;
}

/** Everything buildGateRules needs, passed in so this stays testable with plain objects. */
export interface GateInput {
  readonly bindings: TabBindings;
  /** The live grant set, as `chrome.permissions.getAll().origins` returns it. */
  readonly granted: readonly string[];
  /** First rule id to assign. The caller places the gate after the cookie rules. */
  readonly firstId: number;
}

/**
 * The gate's rules for every bound tab: one `block` per tab for every http(s) top-level
 * navigation, and one `allow` per granted pattern, scoped to the bound tabs, that lets the
 * tab through to a host Tabsona may touch.
 *
 * INVARIANTS:
 * - No rule at all when "Allow on all sites" is in force: there is no host to stop at.
 * - No rule at all for an unbound tab. An ordinary tab must behave exactly like Chrome
 *   without Tabsona, which is project rule one of the badge and of this gate.
 * - Main frame only. A sub-frame, a fetch or a service worker's request is not stopped,
 *   because blocking those breaks pages in ways nobody could trace back to a sign-in;
 *   those leaks are caught after the fact instead (leakWindowFor) and listed in
 *   docs/limits.md.
 */
export function buildGateRules(input: GateInput): GateRule[] {
  if (coversAllSites(input.granted)) return [];
  const tabIds = Object.keys(input.bindings)
    .map(Number)
    .filter((id) => Number.isInteger(id) && id >= 0)
    .sort((a, b) => a - b);
  if (tabIds.length === 0) return [];

  let id = input.firstId;
  const rules: GateRule[] = tabIds.map((tabId) => ({
    kind: 'block', id: id++, tabId, urlFilter: GATE_BLOCK_URL_FILTER,
  }));
  const regexes = [...new Set(input.granted.map(grantRegex).filter((r): r is string => r !== null))].sort();
  for (const urlRegex of regexes) rules.push({ kind: 'allow', id: id++, tabIds, urlRegex });
  return rules;
}

/**
 * The website a stopped navigation was going to, or null when this error is not the gate's.
 *
 * Only a top-level frame, only `ERR_BLOCKED_BY_CLIENT`, only http(s). The caller still
 * checks the tab is bound and the target is not allowed: another extension's block reports
 * the same error string.
 */
export function blockedTarget(details: {
  readonly frameId: number;
  readonly error: string;
  readonly url: string;
}): Origin | null {
  if (details.frameId !== 0 || details.error !== BLOCKED_BY_CLIENT_ERROR) return null;
  try {
    const u = new URL(details.url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** A navigation the gate stopped, kept until the gate page acts on it. */
export interface GatePending {
  /** The exact url the tab was going to, query included, so "Allow and continue" resumes
   *  the sign-in where it stopped rather than starting it over. */
  readonly url: string;
  /** Its origin: the website Tabsona was not allowed on. */
  readonly host: Origin;
  readonly sessionId: SessionId;
  readonly at: number;
  /** True when the stopped navigation was a form POST (see FormHint). Its body is gone,
   *  so the url alone must never be navigated to: the provider would get a GET with every
   *  parameter missing. Absent on records written before this field existed, meaning GET. */
  readonly viaForm?: boolean;
}

/** A form POST a persona tab's page just submitted, kept so a navigation the gate stops
 *  right after it can be recognised as that POST. Target and method only: never fields. */
export interface FormHint {
  readonly action: string;
  readonly method: string;
  readonly at: number;
}

/** Form hints by tab id (string keys, like the bindings). */
export type FormHints = Readonly<Record<string, FormHint>>;

/** `url` without its query and fragment, or null when it is not a url. A form's action
 *  and the url a blocked POST reports agree on origin and path; the query of a POST is
 *  the form's own and may differ from what the page computed. */
function withoutQuery(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Whether a navigation the gate stopped at `blockedUrl` was the POST `hint` describes:
 * the form's method is POST, it was submitted within FORM_HINT_MAX_AGE_MS, and the stopped
 * url is the form's own origin and path. Anything else is treated as a plain GET.
 */
export function hintExplainsStop(hint: FormHint | undefined, blockedUrl: string, now: number): boolean {
  if (!hint || hint.method !== FORM_METHOD_POST) return false;
  if (now - hint.at >= FORM_HINT_MAX_AGE_MS || now < hint.at) return false;
  const want = withoutQuery(hint.action);
  return want !== null && want === withoutQuery(blockedUrl);
}

/** Stopped navigations by tab id (string keys, like the bindings). */
export type GatePendings = Readonly<Record<string, GatePending>>;

/**
 * The hosts one "Allow and continue" asks Chrome for: the stopped host first, then every
 * other host this site's sign-in is known to pass through. De-duplicated, stopped host
 * always included.
 *
 * Why the whole chain: each hop of a sign-in is visible only once the one before it is
 * allowed, so asking per hop is one prompt and one stop per hop. A chain seen once is
 * remembered (STORAGE_KEY_SIGNIN_CHAINS), and from then on ONE prompt covers all of it.
 * The caller removes hosts that are already allowed.
 */
export function hostsToAsk(chain: readonly Origin[], stopped: Origin): Origin[] {
  return [stopped, ...[...new Set(chain)].filter((h) => h !== stopped).sort()];
}

// --- leak windows -----------------------------------------------------------------

/** One tab's open leak window: which unguarded hosts it passed through, and since when. */
export interface LeakWindow {
  readonly hosts: readonly Origin[];
  readonly openedAt: number;
}

/** Open leak windows by tab id. */
export type LeakWindows = Readonly<Record<string, LeakWindow>>;

/**
 * `windows` with `tabId`'s window opened (or extended) because the tab just passed
 * through `host`, a website Tabsona is not allowed on. Returns a NEW map. Extending
 * restarts the clock: the window lasts LEAK_WINDOW_MS from the LAST unguarded hop.
 */
export function withLeakWindow(windows: LeakWindows, tabId: TabId, host: Origin, now: number): LeakWindows {
  const key = String(tabId);
  const current = windows[key];
  const live = current && now - current.openedAt < LEAK_WINDOW_MS ? current.hosts : [];
  const hosts = [...new Set([...live, host])].sort();
  return { ...windows, [key]: { hosts, openedAt: now } };
}

/**
 * The unguarded hosts `tabId` passed through within the last LEAK_WINDOW_MS, or null
 * when no window is open. While one is, cookies and page storage captured from the tab
 * are NOT saved into its session: they may be the browser's own user, carried back by a
 * provider that saw the browser's login.
 */
export function leakWindowFor(windows: LeakWindows, tabId: TabId, now: number): readonly Origin[] | null {
  const w = windows[String(tabId)];
  if (!w || now - w.openedAt >= LEAK_WINDOW_MS) return null;
  return w.hosts;
}

/** `windows` without `tabId`'s window, and without every expired one. Returns a NEW map. */
export function withoutLeakWindow(windows: LeakWindows, tabId: TabId, now: number): LeakWindows {
  const out: Record<string, LeakWindow> = {};
  for (const [key, w] of Object.entries(windows)) {
    if (key !== String(tabId) && now - w.openedAt < LEAK_WINDOW_MS) out[key] = w;
  }
  return out;
}

/**
 * Whether a cross-origin redirect a bound tab just received, to a host Tabsona is not
 * allowed on, opens a leak window.
 *
 * A TOP-LEVEL redirect does not when the tab is gated: the gate blocks the navigation it
 * starts, so no request reaches the host. Every other case does — a fetch that follows a
 * redirect is not stopped by the gate, and a top-level one in a tab without its gate rule
 * (a rule sync that failed, a tab bound before the gate existed) reaches the host.
 */
export function redirectOpensLeakWindow(resourceType: string, tabGated: boolean): boolean {
  return !(resourceType === 'main_frame' && tabGated);
}
