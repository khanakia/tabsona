// Which origins the extension may actually touch, read from the LIVE permission set.
//
// Deliberately not the manifest's `host_permissions`: almost every origin is granted
// at runtime through the UI, so the manifest would under-report and the capture
// listener would never fire for the sites a user actually added.

import { ALL_SITES_PATTERN } from '@/core/constants';
import { hostAccessPatterns } from '@/core/hostAccess';

/**
 * TRAP, paid for once: with optional host permissions, registering a webRequest
 * listener for `<all_urls>` logs a single host-permission warning and then NEVER FIRES
 * AT ALL. Listeners must be scoped to exactly what was granted, which is also why
 * `boot()` re-runs on `chrome.permissions.onAdded`. Once "Allow on all sites" has really
 * granted the all-sites pattern, a listener filtered on exactly that pattern does fire:
 * observed in `e2e:signin` phase C, which signs a persona in with nothing else granted.
 */
export async function grantedOriginPatterns(): Promise<string[]> {
  const granted = await chrome.permissions.getAll();
  return [...(granted.origins ?? [])];
}

/** `https://sync.localhost` -> `https://sync.localhost/*`, the shape Chrome wants. */
export function originPattern(origin: string): string {
  return `${origin.replace(/\/$/, '')}/*`;
}

/**
 * The patterns the capture listener and the content scripts are scoped to: the live
 * grants, collapsed to the single all-sites pattern when "Allow on all sites" is on.
 * See core/hostAccess.ts for why both callers must share this one answer.
 */
export async function accessPatterns(): Promise<string[]> {
  return hostAccessPatterns(await grantedOriginPatterns());
}

/** Whether a site is covered by the current grants. Asked of Chrome, like
 *  ungrantedOrigins, so an all-sites grant and a subdomain wildcard count exactly as Chrome
 *  counts them rather than as a hand-written pattern match would. */
export async function isOriginAllowed(origin: string): Promise<boolean> {
  return (await ungrantedOrigins([origin])).length === 0;
}

/** Whether "Allow on all sites" is in force: what the welcome card, the Settings row and
 *  the popup's suggestion all show. Never throws; an unanswerable check reads as "no". */
export async function allSitesAllowed(): Promise<boolean> {
  return chrome.permissions.contains({ origins: [ALL_SITES_PATTERN] }).catch(() => false);
}

/**
 * The subset of `origins` the extension holds NO host permission for.
 *
 * Asks Chrome (`permissions.contains`) rather than matching patterns here, so wildcard
 * grants such as `*://*.example.com/*` count exactly as Chrome counts them. Chrome is
 * also what decides whether a declarativeNetRequest header rule applies to a request, so
 * this is the same question the rules are subject to.
 */
export async function ungrantedOrigins(origins: readonly string[]): Promise<string[]> {
  const held = await Promise.all(origins.map((o) =>
    chrome.permissions.contains({ origins: [originPattern(o)] }).catch(() => false)));
  return origins.filter((_, i) => !held[i]);
}
