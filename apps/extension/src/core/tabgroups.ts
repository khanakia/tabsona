// Pure: decide which Chrome tab group each newly opened persona tab belongs in.
//
// Kept out of the engine so the rule — "one group per persona per window, joined when it
// already exists" — is unit-tested in Node with no chrome mock. The engine supplies the
// tab positions it read from Chrome and carries the plan out.

import type { TabId } from '@/domain/types';

/** Where a tab sits in Chrome's tab strip: the two facts grouping depends on. */
export interface TabPlacement {
  readonly tabId: TabId;
  readonly windowId: number;
  /** Chrome's group id, or the caller's "no group" sentinel. */
  readonly groupId: number;
}

/**
 * One grouping action: put `tabIds` into `joinGroupId`, or into a new group when it is
 * null. Every tab in one plan shares `windowId`, because a Chrome group never spans
 * windows — grouping tabs from two windows would drag one window's tabs into the other.
 */
export interface GroupPlan {
  readonly windowId: number;
  readonly tabIds: readonly TabId[];
  readonly joinGroupId: number | null;
}

/**
 * Plan the grouping of a persona's freshly opened tabs.
 *
 * `siblings` are the persona's OTHER open tabs (the caller excludes the new ones). In
 * each window, the new tabs join the group a sibling already sits in, so opening one more
 * site of a persona lands beside the rest of it instead of in a second same-named group;
 * a window with no grouped sibling gets a new group. `noGroup` is Chrome's
 * `TAB_GROUP_ID_NONE`, passed in so this module never names the chrome API.
 *
 * The first grouped sibling wins when siblings sit in different groups of one window
 * (the user split them by hand); the plan never moves an existing tab.
 */
export function planPersonaGroups(
  opened: readonly TabPlacement[],
  siblings: readonly TabPlacement[],
  noGroup: number,
): GroupPlan[] {
  const byWindow = new Map<number, TabId[]>();
  for (const tab of opened) {
    const list = byWindow.get(tab.windowId) ?? [];
    list.push(tab.tabId);
    byWindow.set(tab.windowId, list);
  }
  const openedIds = new Set(opened.map((t) => t.tabId));
  return [...byWindow].map(([windowId, tabIds]) => {
    const existing = siblings.find((s) =>
      s.windowId === windowId && s.groupId !== noGroup && !openedIds.has(s.tabId));
    return { windowId, tabIds, joinGroupId: existing?.groupId ?? null };
  });
}
