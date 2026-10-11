// Re-adopt persona tabs after the extension was reloaded or updated.
//
// Chrome wipes chrome.storage.session (the tab bindings) and every session DNR rule
// (the per-tab cookie rules) when an extension reloads, updates or is re-enabled, while
// the tabs it governed stay open. Such a tab keeps its page-side carriers (window.name, a
// sessionStorage marker) and its in-memory app state, so it LOOKS like the persona's tab,
// in the persona's tab group, but the worker no longer knows it: "Forget this login" found
// no binding to release, nothing ungrouped it, and it stayed signed in. This module reads
// the carriers back and restores the bindings, or lets the tab go when its session is gone.

import { SESSION_MARKER } from '@/core/constants';
import { planAdoption, strandedFor, type CarriedMarker } from '@/core/adopt';
import type { SessionId, TabId } from '@/domain/types';
import { loadBindings, loadLibrary, saveBindings, withLock } from './repo';
import { awaitRuleForTab, syncRules } from './rules-sync';
import { closeTab } from './storage';
import { renderBadge } from './badge';

/**
 * Read the session marker out of every open web tab's page.
 *
 * Reads the same carriers the shim resolves its session from (content/shim.ts), in the
 * ISOLATED world where `sessionStorage` is the real object. A tab we may not script (no
 * host permission, a browser page, a discarded tab) yields nothing and is skipped: a
 * page we cannot script holds no shim of ours either.
 */
export async function scanCarriedMarkers(): Promise<CarriedMarker[]> {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  const found: CarriedMarker[] = [];
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id === undefined || tab.discarded) return;
    const tabId = tab.id;
    const sessionId = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      args: [SESSION_MARKER],
      func: (marker: string): string | null => {
        const prefix = `${marker}:`;
        try {
          const name = String(window.name || '');
          if (name.startsWith(prefix)) {
            const rest = name.slice(prefix.length);
            const bar = rest.indexOf('|');
            const id = bar === -1 ? rest : rest.slice(0, bar);
            if (id) return id;
          }
        } catch { /* some pages lock window.name */ }
        try { return sessionStorage.getItem(marker) || null; } catch { return null; }
      },
    }).then((r) => r[0]?.result ?? null).catch(() => null);
    if (typeof sessionId === 'string' && sessionId) found.push({ tabId, sessionId });
  }));
  return found;
}

/**
 * Bind again every unbound tab that carries a marker of a session that still exists, and
 * release those whose session is gone. Safe to run on every boot: a tab that already has
 * a binding is never touched (core/adopt.ts).
 *
 * Adopted tabs are RELOADED once their rule is confirmed. The page's old content scripts
 * died with the old extension context (the relay that carries its cookie writes, the
 * badge), so without a reload the tab would look adopted while its sign-ins went nowhere.
 * The carriers survive the reload, so the tab comes back as the same login.
 *
 * Returns how many tabs were adopted.
 */
export async function adoptOpenTabs(): Promise<number> {
  const found = await scanCarriedMarkers();
  if (found.length === 0) return 0;
  const lib = await loadLibrary();
  const known = new Set(lib.sessions.map((s) => s.id));

  const plan = await withLock(async () => {
    const bindings = { ...(await loadBindings()) };
    const decided = planAdoption(found, bindings, known);
    for (const { tabId, sessionId } of decided.adopt) bindings[String(tabId)] = sessionId;
    if (decided.adopt.length > 0) await saveBindings(bindings);
    return decided;
  });

  if (plan.adopt.length > 0) {
    await syncRules();
    for (const { tabId } of plan.adopt) {
      // Only reload under a confirmed rule: a reload that leaves rule-less would request
      // with the browser's own cookies, the exact leak this module exists to close.
      if (await awaitRuleForTab(tabId)) await chrome.tabs.reload(tabId).catch(() => undefined);
      await renderBadge(tabId);
    }
  }
  await closeMarkers(plan.release);
  return plan.adopt.length;
}

/** Close tabs of a session that no longer exists and has no binding to name them: clear
 *  the page carriers and the session's page data, then close the tab. Closed rather than
 *  released, so a dead login never lingers as a plain tab on the browser's own jar. */
export async function closeMarkers(markers: readonly CarriedMarker[]): Promise<void> {
  if (markers.length === 0) return;
  for (const { tabId, sessionId } of markers) await closeTab(tabId, sessionId);
}

/**
 * Close the open tabs that carry a forgotten login's marker although no binding named
 * them (the worker lost the bindings and has not re-adopted yet, or never will have a
 * chance). `alreadyClosed` are the tabs the bindings already covered.
 */
export async function closeStrandedTabs(
  forgotten: ReadonlySet<SessionId>,
  alreadyClosed: ReadonlySet<TabId>,
): Promise<void> {
  const found = await scanCarriedMarkers();
  await closeMarkers(strandedFor(found, forgotten, alreadyClosed));
}
