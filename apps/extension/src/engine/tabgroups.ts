// Put a persona's opened tabs into a NATIVE Chrome tab group.
//
// Why this is worth a permission: it makes "which tabs belong to which persona"
// visible in Chrome's own tab strip — collapsible, movable and closable together —
// which no badge of ours can do. It is the single biggest answer to "wait, who am I in
// this tab?".
//
// Optional, but never silent: a failure to group must not stop a persona from opening
// (isolation does not depend on it), and it must not vanish either — "it stopped making
// groups" is a bug report, and a swallowed error leaves nothing to read. Every failure
// is logged with the persona's name and Chrome's message.

import { tabGroupColorFor } from '@/core/personas';
import { planPersonaGroups, type TabPlacement } from '@/core/tabgroups';
import type { Persona, TabId } from '@/domain/types';
import { loadBindings, loadLibrary } from './repo';

/** Whether this Chrome exposes the API at all, so the caller can skip quietly. */
export function tabGroupsAvailable(): boolean {
  return typeof chrome.tabs?.group === 'function' && chrome.tabGroups !== undefined;
}

async function placementOf(tabId: TabId): Promise<TabPlacement | null> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return tab ? { tabId, windowId: tab.windowId, groupId: tab.groupId } : null;
}

/**
 * Put a persona's freshly opened tabs into its native Chrome tab group.
 *
 * Every open path calls this — a whole persona, one session, an added site, another
 * login — so a persona's tabs end up together however they were opened. In each window
 * the tabs join the group the persona's other open tabs are already in; with none, a new
 * group named and coloured after the persona is made. Never throws: failures are logged.
 * Callers check the `useTabGroups` setting first, because grouping is the user's choice.
 */
export async function groupTabsForPersona(persona: Persona, tabIds: readonly TabId[]): Promise<void> {
  if (tabIds.length === 0) return;
  if (!tabGroupsAvailable()) {
    console.warn('[tabsona] tab groups unavailable in this Chrome; not grouping', persona.name);
    return;
  }
  try {
    const [lib, bindings] = await Promise.all([loadLibrary(), loadBindings()]);
    const sessionIds = new Set(lib.sessions.filter((s) => s.personaId === persona.id).map((s) => s.id));
    const opened = new Set(tabIds);
    const siblingIds = Object.entries(bindings)
      .filter(([tabId, sessionId]) => sessionIds.has(sessionId) && !opened.has(Number(tabId)))
      .map(([tabId]) => Number(tabId));
    const placements = async (ids: readonly TabId[]) =>
      (await Promise.all(ids.map(placementOf))).filter((p): p is TabPlacement => p !== null);
    const plans = planPersonaGroups(
      await placements(tabIds), await placements(siblingIds), chrome.tabGroups.TAB_GROUP_ID_NONE);

    for (const plan of plans) {
      const [first, ...rest] = plan.tabIds;
      // chrome.tabs.group types its input as a non-empty tuple; a plan is never empty.
      if (first === undefined) continue;
      if (plan.joinGroupId !== null) {
        await chrome.tabs.group({ groupId: plan.joinGroupId, tabIds: [first, ...rest] });
        continue;
      }
      const groupId = await chrome.tabs.group({
        tabIds: [first, ...rest], createProperties: { windowId: plan.windowId },
      });
      await chrome.tabGroups.update(groupId, {
        title: persona.name,
        color: tabGroupColorFor(persona.color),
        collapsed: false,
      });
    }
  } catch (err) {
    console.warn('[tabsona] could not group tabs for persona', persona.name, err);
  }
}

/**
 * Bring the tab groups holding a persona's open tabs in line with its current name and
 * colour. Only groups the tabs are already in are touched; a tab outside any group is
 * left alone, because grouping is the user's choice (Settings) and their arrangement.
 */
export async function restyleGroupsForPersona(persona: Persona, tabIds: readonly TabId[]): Promise<void> {
  if (!tabGroupsAvailable()) return;
  const groupIds = new Set<number>();
  for (const id of tabIds) {
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (tab && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) groupIds.add(tab.groupId);
  }
  for (const groupId of groupIds) {
    await chrome.tabGroups.update(groupId, { title: persona.name, color: tabGroupColorFor(persona.color) })
      .catch(() => undefined); // cosmetic: never fail the edit over a group
  }
}
