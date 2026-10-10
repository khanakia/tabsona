// Pure: notice when a persona tab's sign-in leaves for a website Tabsona cannot guard.
//
// THE BUG THIS EXISTS FOR, in the user's words: "i remove the site in s2 and add again it
// also loads as admin@ifpghub.demo as s1". The app (Next.js + WorkOS AuthKit) sends a
// signed-out visitor to its identity provider on ANOTHER host. Chrome only applies a
// declarativeNetRequest header rule to a host the extension holds a permission for, and
// the user had allowed the app alone, so the tab's request to the provider went out with
// the BROWSER's own provider cookie. The provider recognised the browser's user and sent
// the tab straight back signed in as them: a "signed out" persona tab arriving as admin,
// every time, with nothing on screen saying why.
//
// No rule can fix that on a host without permission, so the engine's job is to SEE it and
// say so (project rule 2), with a one-click way to allow that host, after which the
// per-tab rules cover the provider too.
//
// A sign-in is usually a CHAIN, not one hop. Measured on that app:
// staging-app → api.workos.com → auth.franchiseatlas.ai → *.authkit.app. Every hop is
// recorded against the persona's SITE (the app the tab belongs to), never against the
// host that answered, or each later hop would be filed under a provider nobody asks about
// and the warning would vanish after the first Allow while the leak went on.

import { MAX_SIGNIN_CHAIN_HOSTS } from './constants';
import type { SignInAlert } from '@/domain/messages';
import type { Origin } from '@/domain/types';

/** Lowest and highest HTTP status that carry a `Location` the browser will follow. */
const REDIRECT_STATUS_MIN = 300;
const REDIRECT_STATUS_MAX = 399;

/** Schemes a cookie rule can apply to. Anything else (a custom app scheme, `data:`) is
 *  not a website and holds no browser login to leak. */
const WEB_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/**
 * Sign-in hosts seen per site: the site's origin → every OTHER origin its tabs were
 * redirected to. Kept across browser runs (STORAGE_KEY_SIGNIN_CHAINS): the chain an app
 * signs in through is a property of the app, and remembering it is what lets the gate
 * page ask for the whole chain in one prompt the next time (core/gate.ts, hostsToAsk).
 * What it says about TODAY is still decided against the live permission set by every
 * reader, so a host allowed since it was seen is never reported again.
 */
export type SignInHops = Readonly<Record<Origin, readonly Origin[]>>;

/**
 * The origin a response redirects to, when it is a DIFFERENT website.
 *
 * Returns null for anything that is not a cross-origin http(s) redirect: a non-3xx
 * status, no `Location`, a same-origin hop (`/` → `/auth/login`, already covered by the
 * site's own permission), or an unparseable value. `Location` may be relative, so it is
 * resolved against the request url the way the browser resolves it.
 */
export function crossOriginRedirect(
  requestUrl: string,
  statusCode: number,
  location: string | undefined,
): Origin | null {
  if (statusCode < REDIRECT_STATUS_MIN || statusCode > REDIRECT_STATUS_MAX || !location) return null;
  try {
    const from = new URL(requestUrl);
    const to = new URL(location, from);
    if (!WEB_PROTOCOLS.includes(to.protocol) || to.origin === from.origin) return null;
    return to.origin;
  } catch {
    return null;
  }
}

/** The `Location` header's value, matched case-insensitively as HTTP requires. */
export function locationHeader(
  headers: readonly { readonly name: string; readonly value?: string | undefined }[] | undefined,
): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === 'location')?.value;
}

/**
 * Record one hop, returning a NEW map. Idempotent and sorted, so noting the same hop on
 * every page load neither grows the list nor reorders what the popup shows. A site that
 * already holds MAX_SIGNIN_CHAIN_HOSTS keeps what it has: the list is persistent, and an
 * app that redirects everywhere must not grow storage forever.
 */
export function withHop(hops: SignInHops, site: Origin, target: Origin): SignInHops {
  const current = hops[site] ?? [];
  if (current.includes(target) || current.length >= MAX_SIGNIN_CHAIN_HOSTS) return hops;
  return { ...hops, [site]: [...current, target].sort() };
}

/**
 * The sign-in hosts recorded for each of `sites`, one alert per site that has any.
 *
 * Pure grouping: the caller still filters each alert's hosts against the LIVE permission
 * set (a host allowed since it was seen is no longer a leak) and drops alerts left empty.
 * Sites are de-duplicated and sorted, so two tabs on one app give one alert and the
 * popup does not reorder between renders.
 */
export function signInAlertsFor(hops: SignInHops, sites: readonly Origin[]): SignInAlert[] {
  return [...new Set(sites)].sort()
    .map((site) => ({ site, hosts: hops[site] ?? [] }))
    .filter((alert) => alert.hosts.length > 0);
}

/** Every distinct host across `alerts`, sorted: what one "Allow all" asks Chrome for, in
 *  a single permission prompt rather than one prompt per host. */
export function allSignInHosts(alerts: readonly SignInAlert[]): Origin[] {
  return [...new Set(alerts.flatMap((a) => a.hosts))].sort();
}

/**
 * `hops` plus the website a persona tab is currently ON, when that is not the persona's
 * own site. Returns the SAME map when there is nothing to add.
 *
 * Why: a signed-out chain ends on the provider's login page (`*.authkit.app`). The
 * extension sees no response from a host it may not touch, so the redirect INTO that page
 * is only visible when the host before it is allowed — but the tab sitting there is
 * visible always. The caller still filters against the live permission set, so a tab on
 * an allowed host adds nothing. A tab the user simply navigated elsewhere is listed too:
 * it is just as un-separated there, which is the thing the warning is about.
 */
export function withLandingHost(hops: SignInHops, site: Origin, tabOrigin: Origin | null): SignInHops {
  if (tabOrigin === null || tabOrigin === site) return hops;
  return withHop(hops, site, tabOrigin);
}
