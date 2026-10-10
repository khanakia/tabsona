// Pure: what the live host-permission set means, once "every website" can be in it.
//
// "Allow on all sites" grants the single pattern `*://*/*`. Every place that turns the
// granted set into something Chrome matches against (the capture listener's url filter,
// the content scripts' `matches`) or into something a person reads (the Sites list) goes
// through here, so the all-sites case is decided once rather than rediscovered per
// caller. Chrome-free on purpose: `core/` never names a chrome API (boundary test).

import { ALL_SITES_PATTERN, ALL_URLS_PATTERN } from './constants';

/** Patterns that grant every http(s) website. */
const ALL_SITES_GRANTS: readonly string[] = [ALL_SITES_PATTERN, ALL_URLS_PATTERN];

/** Whether `patterns` (as `chrome.permissions.getAll().origins` returns them) include an
 *  every-website grant. */
export function coversAllSites(patterns: readonly string[]): boolean {
  return patterns.some((p) => ALL_SITES_GRANTS.includes(p));
}

/**
 * The url patterns the capture listener and the content scripts must be scoped to.
 *
 * With an every-website grant this is exactly `[ALL_SITES_PATTERN]`: one pattern instead
 * of the wildcard plus every per-site grant the user made before, so a script is never
 * listed twice for one page. Otherwise the granted patterns, de-duplicated and sorted so
 * re-registering after an unrelated permission change compares equal.
 *
 * INVARIANT: never `<all_urls>`. That pattern also matches file:// and other schemes the
 * extension holds no permission for, and a webRequest filter naming hosts it may not touch
 * is the trap in engine/permissions.ts: one warning, then a listener that never fires.
 */
export function hostAccessPatterns(granted: readonly string[]): string[] {
  if (coversAllSites(granted)) return [ALL_SITES_PATTERN];
  return [...new Set(granted)].sort();
}

/**
 * The granted patterns as the Sites list shows them: an every-website grant first, then
 * each per-site grant. Patterns are kept as Chrome holds them, because a row's remove
 * button passes its pattern straight to `permissions.remove`. Per-site grants are kept even beside an all-sites grant, because
 * removing "all sites" leaves them in force and the user should see what remains.
 */
export function listedGrants(granted: readonly string[]): string[] {
  const unique = [...new Set(granted)];
  const everywhere = unique.filter((p) => ALL_SITES_GRANTS.includes(p)).sort();
  const sites = unique.filter((p) => !ALL_SITES_GRANTS.includes(p)).sort();
  return [...everywhere, ...sites];
}
