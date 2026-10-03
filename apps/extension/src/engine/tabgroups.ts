// Put a persona's opened tabs into a NATIVE Chrome tab group.
//
// Why this is worth a permission: it makes "which tabs belong to which persona"
// visible in Chrome's own tab strip — collapsible, movable and closable together —
// which no badge of ours can do. It is the single biggest answer to "wait, who am I in
// this tab?".
//
// Entirely optional: every failure path here is swallowed, because a missing tab group
// must never stop a persona from opening. Isolation does not depend on it.

import { tabGroupColorFor } from '@/core/personas';
import type { Persona, TabId } from '@/domain/types';

/** Whether this Chrome exposes the API at all, so the caller can skip quietly. */
export function tabGroupsAvailable(): boolean {
  return typeof chrome.tabs?.group === 'function' && chrome.tabGroups !== undefined;
}

export async function groupTabsForPersona(
  persona: Persona,
  tabIds: readonly TabId[],
): Promise<number | null> {
  const [first, ...rest] = tabIds;
  // chrome.tabs.group types its input as a non-empty tuple, which is also the only
  // shape that makes sense: grouping zero tabs is not a thing.
  if (!tabGroupsAvailable() || first === undefined) return null;
  try {
    const groupId: number = await chrome.tabs.group({ tabIds: [first, ...rest] });
    await chrome.tabGroups.update(groupId, {
      title: persona.name,
      color: tabGroupColorFor(persona.color),
      collapsed: false,
    });
    return groupId;
  } catch {
    return null; // never block opening a persona on cosmetics
  }
}
