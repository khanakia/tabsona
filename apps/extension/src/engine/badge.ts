// The badge: a toolbar marker plus an in-page chip — and the honest part, it reports
// COVERAGE, not just a name.

import { computeCoverage, coverageSummary, shimFactsFrom, worstStatus } from '@/core/coverage';
import { isEmpty } from '@/core/sessionState';
import { loadBadgePlacements, loadBindings, loadLibrary, loadSettings } from './repo';
import { paletteEntryFor } from '@/core/personas';
import { noteShimReady, observationsFor } from './observations';
import type { TabStatus } from '@/domain/messages';
import type { TabId } from '@/domain/types';
import { isOriginAllowed } from './permissions';

const NEUTRAL_BADGE = '#52525b';

/**
 * Ask the PAGE what the shim actually achieved, right now.
 *
 * A pull, not a push, and that is the point. The shim reports itself at document_start
 * via postMessage, but the relay content script only attaches at document_idle — so
 * that message is routinely already gone, and the badge then claimed
 * `leaking: localStorage` on a tab whose localStorage was provably isolated. A badge
 * that cries wolf is as harmful as one that stays silent: both teach the user to
 * ignore it.
 */
async function pullShimReport(tabId: TabId): Promise<void> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      // Serialised by executeScript, so only plain data crosses back: copy the fields
      // rather than the handle, whose methods would not survive the trip.
      const h: unknown = (window as { __tabsonaSession?: unknown }).__tabsonaSession;
      if (typeof h !== 'object' || h === null) return null;
      const r = h as Record<string, unknown>;
      return {
        origin: location.origin,
        shimmedLocal: r.shimmedLocal === true,
        usesIndexedDb: r.usesIndexedDb, idbNamespaced: r.idbNamespaced,
        usesWorker: r.usesWorker, hasServiceWorker: r.hasServiceWorker,
      };
    },
  }).catch(() => [{ result: null }] as const);

  const report: unknown = res?.result;
  if (typeof report !== 'object' || report === null) return;
  const { origin, shimmedLocal } = report as { origin?: unknown; shimmedLocal?: unknown };

  // Only a shim that reports it actually replaced localStorage counts as evidence.
  if (shimmedLocal === true && typeof origin === 'string') noteShimReady(origin, shimFactsFrom(report));
}

export async function statusForTab(tabId: TabId | null): Promise<TabStatus> {
  const blank: TabStatus = {
    tabId, url: null, site: null, isWebPage: false, siteAllowed: false,
    sessionId: null, personaId: null, personaName: null, color: null,
    isEmpty: false, coverage: [], summary: 'not isolated',
  };
  if (tabId === null) return blank;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = tab?.url ?? null;
  let origin: string | null = null;
  try {
    const u = new URL(url ?? '');
    if (u.protocol === 'http:' || u.protocol === 'https:') origin = u.origin;
  } catch { /* not a web page */ }

  if (origin === null) return { ...blank, url };

  const siteAllowed = await isOriginAllowed(origin);
  const [bindings, lib] = await Promise.all([loadBindings(), loadLibrary()]);
  const sessionId = bindings[String(tabId)];
  const session = sessionId ? lib.sessions.find((s) => s.id === sessionId) : undefined;
  const persona = session ? lib.personas.find((p) => p.id === session.personaId) : undefined;

  if (!session || !persona) {
    return { ...blank, url, site: origin, isWebPage: true, siteAllowed };
  }

  // Refresh the evidence before judging, so coverage reflects this tab as it is.
  await pullShimReport(tabId).catch(() => undefined);
  const coverage = computeCoverage(session.engine, observationsFor(origin));

  return {
    tabId, url, site: origin, isWebPage: true, siteAllowed,
    sessionId: session.id,
    personaId: persona.id,
    personaName: persona.name,
    color: persona.color,
    isEmpty: isEmpty(session),
    coverage,
    summary: coverageSummary(coverage),
  };
}

export async function renderBadge(tabId: TabId): Promise<void> {
  const status = await statusForTab(tabId);

  try {
    await chrome.action.setBadgeText({ tabId, text: status.personaName?.slice(0, 3) ?? '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: status.color ?? NEUTRAL_BADGE });
    await chrome.action.setTitle({
      tabId,
      title: status.sessionId
        ? `${status.personaName} — ${status.site} — ${status.summary}`
        : 'Tabsona — this tab is not isolated',
    });
  } catch { /* tab closed mid-flight */ }

  if (!status.sessionId) {
    await chrome.tabs.sendMessage(tabId, { kind: 'badge:clear' }).catch(() => undefined);
    return;
  }

  const [settings, placements] = await Promise.all([loadSettings(), loadBadgePlacements()]);
  // The toolbar badge above stays either way: it is the one indicator that cannot sit
  // on top of the page. The in-page badge and the title marker are each the user's to
  // switch off, independently — one can be wanted without the other.
  await chrome.tabs.sendMessage(tabId, {
    kind: 'badge:render',
    showBadge: settings.showPageBadge,
    name: status.personaName,
    color: status.color,
    severity: worstStatus(status.coverage),
    summary: status.summary,
    isEmpty: status.isEmpty,
    position: settings.badgePosition,
    placement: status.site ? placements[status.site] ?? null : null,
    titleMark: settings.markPageTitles && status.color ? paletteEntryFor(status.color).emoji : null,
  }).catch(() => undefined); // no content script here: nothing to draw on
}

/** Redraw the badge in every tab bound to a persona — after a badge setting changes,
 *  so the user sees the new corner or the badge disappear without reloading tabs. */
export async function renderAllBadges(): Promise<void> {
  const bindings = await loadBindings();
  await Promise.all(Object.keys(bindings).map((id) => renderBadge(Number(id))));
}
