// Pure: the "use my normal login on these websites" list, and what it turns into.
//
// WHY it exists (decision dec_01a124168bea78c6a5d1efab2f5fc671, research in
// docsi/research/google-signin.md): Google sets its flow cookie on a 302 and expects it back
// on the redirect's follow-up request. Under MV3 a per-tab header rule is installed AFTER
// the response is seen, so the follow-up leaves without it (0 of 10 in the probe), and
// Google's device-bound session refreshes run inside the browser where no per-tab rule can
// reach them. Isolating Google inside a persona is therefore not possible; letting the
// persona tab use the BROWSER's own login on the identity provider is. The app's own
// session (the cookie the app sets after the OAuth callback) stays per persona, because the
// app's host is not on this list.
//
// Mechanism and decision are kept apart: this module only turns a user-chosen list into
// match patterns and rules. The preset (GOOGLE_SIGN_IN_HOSTS) is offered, never applied.
//
// Chrome-free on purpose (boundary test): engine/passthrough.ts acts.

import {
  GOOGLE_DOMAINS, GOOGLE_SIGN_IN_HOSTS, MAX_PASS_THROUGH_HOSTS, RULE_RESOURCE_TYPES,
} from './constants';
import { grantRegex } from './gate';
import type { PassThroughOffer, PassThroughRule, TabBindings } from '@/domain/types';

/** A hostname: dot-separated labels of letters, digits and hyphens. A single label is
 *  allowed (`localhost`, the development fixtures). */
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//;
const PORT_SUFFIX = /:(\d{1,5})$/;
const MAX_PORT = 65_535;
const WILDCARD_PREFIX = '*.';
/** A wildcard needs at least a registrable domain after it: `*.com` would exempt a whole
 *  TLD, and nobody means that. */
const MIN_WILDCARD_LABELS = 2;

/**
 * One list entry from whatever the user typed or pasted, or null when it is not a host.
 *
 * Accepts `accounts.google.com`, `https://accounts.google.com/signin?x=1`, `*.example.com`
 * and `localhost:8790`; returns the canonical `host`, `*.host` or `host:port`. Everything
 * else (userinfo, an empty host, a bare `*`, a TLD wildcard, a port out of range) is null:
 * a list that quietly stored garbage would exempt hosts nobody chose.
 */
export function normalizeHostEntry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase().replace(SCHEME_PREFIX, '');
  s = s.split(/[/?#]/, 1)[0] ?? '';
  if (!s || s.includes('@')) return null;

  let port = '';
  const portMatch = PORT_SUFFIX.exec(s);
  if (portMatch) {
    if (Number(portMatch[1]) < 1 || Number(portMatch[1]) > MAX_PORT) return null;
    port = portMatch[0];
    s = s.slice(0, -port.length);
  }
  const wildcard = s.startsWith(WILDCARD_PREFIX);
  const host = wildcard ? s.slice(WILDCARD_PREFIX.length) : s;
  if (!HOSTNAME.test(host)) return null;
  if (wildcard && host.split('.').length < MIN_WILDCARD_LABELS) return null;
  return `${wildcard ? WILDCARD_PREFIX : ''}${host}${port}`;
}

/** Entries from untrusted storage or input: each normalised, duplicates dropped, sorted so
 *  re-saving compares equal, capped at MAX_PASS_THROUGH_HOSTS. Anything that is not an
 *  array reads as the empty list (nothing is exempted by accident). */
export function normalizePassThroughHosts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw.map(normalizeHostEntry).filter((e): e is string => e !== null);
  return [...new Set(entries)].sort().slice(0, MAX_PASS_THROUGH_HOSTS);
}

/** `list` plus `additions` (any shape the user typed), normalised. A NEW array. */
export function withPassThroughHosts(list: readonly string[], additions: readonly unknown[]): string[] {
  return normalizePassThroughHosts([...list, ...additions]);
}

/** `list` without `entry` (compared after normalising). A NEW array. */
export function withoutPassThroughHost(list: readonly string[], entry: unknown): string[] {
  const drop = normalizeHostEntry(entry);
  return list.filter((e) => e !== drop);
}

/** The RE2 pattern for the request urls one entry covers: same host rules as a Chrome
 *  grant (`*.` = the domain and every subdomain, no port = any port, a lookalike never). */
export function passThroughRegex(entry: string): string | null {
  return grantRegex(`*://${entry}/*`);
}

/**
 * The Chrome match pattern for one entry, as content scripts' `excludeMatches` takes it.
 *
 * The PORT IS DROPPED: Chrome refuses a port in a content-script match pattern ("Invalid
 * port", observed in e2e:signin phase P, where it made registration throw and left every
 * page without the shim). So `localhost:8790` excludes the scripts on every `localhost`
 * port while the network rule stays exact to the port. The only effect of the wider
 * exclusion is that the persona shim is absent on a same-host other port; real
 * identity-provider hosts carry no port.
 */
export function passThroughMatchPattern(entry: string): string {
  return `*://${entry.replace(PORT_SUFFIX, '')}/*`;
}

/** Whether `url` (a page url or an origin) is on the list. */
export function urlIsPassThrough(list: readonly string[], url: string): boolean {
  return list.some((entry) => {
    const pattern = passThroughRegex(entry);
    return pattern !== null && new RegExp(pattern).test(url);
  });
}

/** `origins` without the ones on the list: what every "is this host unguarded?" question
 *  asks, so a pass-through host is never reported as a leak. */
export function withoutPassThrough(list: readonly string[], origins: readonly string[]): string[] {
  return origins.filter((o) => !urlIsPassThrough(list, o));
}

/**
 * The exemption rules: ONE tab-scoped `allow` per entry, covering every bound tab.
 *
 * Sits above every cookie rule and the gate (see PASS_THROUGH_ALLOW_PRIORITY), so for a
 * listed host a persona tab sends the browser's Cookie header, keeps the original
 * Set-Cookie, and is not stopped by the gate even where Tabsona holds no permission.
 * No rule for an unbound tab (an ordinary tab is never touched) or an empty list.
 *
 * Independent of "Allow on all sites": that makes the strip cover every host, and this
 * exemption outranks the strip, so the two compose without a special case.
 */
export function buildPassThroughRules(input: {
  readonly bindings: TabBindings;
  readonly hosts: readonly string[];
  readonly firstId: number;
}): PassThroughRule[] {
  const tabIds = Object.keys(input.bindings)
    .map(Number)
    .filter((id) => Number.isInteger(id) && id >= 0)
    .sort((a, b) => a - b);
  if (tabIds.length === 0) return [];
  let id = input.firstId;
  const out: PassThroughRule[] = [];
  for (const entry of input.hosts) {
    const urlRegex = passThroughRegex(entry);
    if (urlRegex !== null) out.push({ id: id++, tabIds, urlRegex });
  }
  return out;
}

/** The resource types the exemption covers: exactly those the strip covers, so no request
 *  the strip would have touched is left half-exempt. */
export const PASS_THROUGH_RESOURCE_TYPES = RULE_RESOURCE_TYPES;

// --- the Google preset --------------------------------------------------------------

/** Whether a hostname is Google's: a google.com or youtube.com domain or subdomain. */
export function isGoogleHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return GOOGLE_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** The list entry for an origin: its host, with the port when it is not the default. */
export function entryForOrigin(origin: string): string | null {
  try { return normalizeHostEntry(new URL(origin).host); } catch { return null; }
}

/**
 * What to offer for `origins` given the current list, or null when nothing is left to
 * offer (every one already on the list, or none is a website).
 *
 * Google gets the whole preset in one click because a sign-in walks several of its hosts
 * and each is seen only after the one before it; offering one at a time is the
 * prompt-per-hop flow the gate was built to end.
 */
export function offerFor(origins: readonly string[], list: readonly string[]): PassThroughOffer | null {
  const todo = withoutPassThrough(list, origins);
  const entries = todo.map(entryForOrigin).filter((e): e is string => e !== null);
  if (entries.length === 0) return null;
  const google = todo.some((o) => {
    try { return isGoogleHostname(new URL(o).hostname); } catch { return false; }
  });
  if (!google) return { kind: 'host', hosts: [...new Set(entries)].sort() };
  const missing = GOOGLE_SIGN_IN_HOSTS.filter((h) => !urlIsPassThrough(list, `https://${h}`));
  return { kind: 'google', hosts: [...new Set([...missing, ...entries])].sort() };
}

/** Whether the whole Google preset is on the list, for the Settings "add" button. */
export function googlePresetActive(list: readonly string[]): boolean {
  return GOOGLE_SIGN_IN_HOSTS.every((h) => urlIsPassThrough(list, `https://${h}`));
}

/**
 * The Google preset hosts NOT yet on the list, for "Restore default sites": it re-adds
 * only these, so a restore never duplicates an entry or touches the user's own.
 * A wildcard entry (`*.google.com`) counts as covering its hosts.
 */
export function missingGoogleHosts(list: readonly string[]): readonly string[] {
  return GOOGLE_SIGN_IN_HOSTS.filter((h) => !urlIsPassThrough(list, `https://${h}`));
}
