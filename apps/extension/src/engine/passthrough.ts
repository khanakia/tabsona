// The chrome.* half of "use my normal login on these websites": read the list, change it,
// and ask the questions every other engine module needs ("is this origin a pass-through
// host?"). The decisions (matching, normalising, the rule itself) are core/passthrough.ts;
// the rules are installed by rules-sync.ts and the content scripts re-scoped by index.ts.

import { urlIsPassThrough, withPassThroughHosts, withoutPassThrough, withoutPassThroughHost } from '@/core/passthrough';
import { loadPassThroughHosts, updatePassThroughHosts } from './repo';
import { syncRules } from './rules-sync';

/** Whether `url` (a page url or an origin) is on the list RIGHT NOW. Read from storage on
 *  every call: the worker holds no state (project rule 6), and the list is tiny. */
export async function isPassThroughUrl(url: string): Promise<boolean> {
  return urlIsPassThrough(await loadPassThroughHosts(), url);
}

/** `origins` without the pass-through ones. Every "is this host unguarded?" check goes
 *  through here, so a host the user chose is never reported as a leak. */
export async function dropPassThrough(origins: readonly string[]): Promise<string[]> {
  return withoutPassThrough(await loadPassThroughHosts(), origins);
}

/**
 * Add hosts (any shape the user typed) to the list and bring the live rules in step.
 * Entries that are not a host are dropped by the normaliser, never stored. Returns the
 * list as stored. The caller re-scopes the content scripts and redraws the badges, which
 * live in index.ts.
 */
export async function addPassThroughHosts(raw: readonly string[]): Promise<string[]> {
  const list = await updatePassThroughHosts((current) => withPassThroughHosts(current, raw));
  await syncRules();
  return list;
}

/** Remove one entry and bring the live rules in step. */
export async function removePassThroughHost(entry: string): Promise<string[]> {
  const list = await updatePassThroughHosts((current) => withoutPassThroughHost(current, entry));
  await syncRules();
  return list;
}
