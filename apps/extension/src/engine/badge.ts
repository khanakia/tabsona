// The badge: a toolbar marker plus an in-page chip — and the honest part, it reports
// COVERAGE, not just a name.

import { computeCoverage, coverageSummary, worstStatus } from '@/core/coverage';
import { isEmpty } from '@/core/sessionState';
import { loadBindings, loadLibrary } from './repo';
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
      const h = (window as {
        __mstabsSession?: { shimmedLocal: boolean; usesIndexedDb: boolean; hasServiceWorker: boolean };
      }).__mstabsSession;
      return h
        ? { origin: location.origin, shimmedLocal: h.shimmedLocal, usesIndexedDb: h.usesIndexedDb, hasServiceWorker: h.hasServiceWorker }
        : null;
    },
  }).catch(() => [{ result: null }] as const);

  const report = res?.result as
    | { origin: string; shimmedLocal: boolean; usesIndexedDb: boolean; hasServiceWorker: boolean }
    | null | undefined;

  // Only a shim that reports it actually replaced localStorage counts as evidence.
  if (report?.shimmedLocal) {
    noteShimReady(report.origin, {
      usesIndexedDb: report.usesIndexedDb,
      hasServiceWorker: report.hasServiceWorker,
    });
  }
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
        : 'MultiSession Tabs — this tab is not isolated',
    });
  } catch { /* tab closed mid-flight */ }

  if (!status.sessionId) {
    await chrome.tabs.sendMessage(tabId, { kind: 'badge:clear' }).catch(() => undefined);
    return;
  }

  await chrome.tabs.sendMessage(tabId, {
    kind: 'badge:render',
    name: status.personaName,
    color: status.color,
    severity: worstStatus(status.coverage),
    summary: status.summary,
    isEmpty: status.isEmpty,
  }).catch(() => undefined); // no content script here: nothing to draw on
}
