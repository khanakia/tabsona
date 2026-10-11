// Pure: decide what to do with open tabs that CARRY a session marker.
//
// Tab bindings live in chrome.storage.session and the per-tab cookie rules in DNR session
// rules, and Chrome wipes BOTH whenever the extension is reloaded, updated or re-enabled
// while its tabs stay open. A tab that was a persona's a moment ago is then an unbound tab
// whose page still resolves the persona's storage from the carriers it holds (window.name,
// a sessionStorage marker, see content/shim.ts). The engine reads those carriers and hands
// them to this module, which says which tabs to bind again and which to let go.
//
// Kept out of the engine so the decision is unit-tested in Node with no chrome mock.

import type { SessionId, TabBindings, TabId } from '@/domain/types';

/** A tab and the session id its page carries. */
export interface CarriedMarker {
  readonly tabId: TabId;
  readonly sessionId: SessionId;
}

/**
 * What to do with the carrying tabs.
 *
 * `adopt`: the session still exists and the tab has no binding, so bind it again.
 * `release`: the session is gone (forgotten while the tab was unbound, or deleted from
 * another profile), so the tab must stop acting as it.
 */
export interface AdoptionPlan {
  readonly adopt: readonly CarriedMarker[];
  readonly release: readonly CarriedMarker[];
}

/**
 * Plan the re-adoption of open tabs.
 *
 * A tab that already has a binding is never touched, even when the marker disagrees: the
 * binding is what the rules were built from, and two sources of truth for one tab is how a
 * tab ends up on two identities. So this is safe to run on every boot, not only after a
 * reload. Order of `found` is preserved.
 */
export function planAdoption(
  found: readonly CarriedMarker[],
  bindings: TabBindings,
  knownSessionIds: ReadonlySet<SessionId>,
): AdoptionPlan {
  const adopt: CarriedMarker[] = [];
  const release: CarriedMarker[] = [];
  for (const marker of found) {
    if (String(marker.tabId) in bindings) continue;
    (knownSessionIds.has(marker.sessionId) ? adopt : release).push(marker);
  }
  return { adopt, release };
}

/**
 * Which carrying tabs belong to a login that was just forgotten and were NOT already
 * released through their binding. Forgetting a login must reach a tab even when the
 * binding that would have named it is gone (an extension reload not yet re-adopted).
 */
export function strandedFor(
  found: readonly CarriedMarker[],
  forgotten: ReadonlySet<SessionId>,
  alreadyReleased: ReadonlySet<TabId>,
): CarriedMarker[] {
  return found.filter((m) => forgotten.has(m.sessionId) && !alreadyReleased.has(m.tabId));
}
