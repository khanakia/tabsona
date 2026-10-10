// The badge: a toolbar marker plus an in-page chip — and the honest part, it reports
// COVERAGE, not just a name.

import { computeCoverage, coverageSummary, shimFactsFrom, worstStatus } from '@/core/coverage';
import { isEmpty } from '@/core/sessionState';
import { actionBadgeText } from '@/core/badgeLook';
import { loadBadgePlacements, loadBindings, loadLibrary, loadSettings, loadSignInHops } from './repo';
import { paletteEntryFor, siteOf } from '@/core/personas';
import { noteShimReady, observationsFor } from './observations';
import type { SignInAlert, TabStatus } from '@/domain/messages';
import { signInAlertsFor, withLandingHost } from '@/core/signin';
import type { TabId } from '@/domain/types';
import { isOriginAllowed, ungrantedOrigins } from './permissions';

const NEUTRAL_BADGE = '#52525b';
/** Toolbar badge colour while a sign-in host is un-allowed: the leaking red, as a hex
 *  because `action.setBadgeBackgroundColor` documents hex, not rgba. */
const SIGN_IN_ALERT_BADGE = '#dc2626';

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
    isEmpty: false, coverage: [], summary: 'not isolated', unguardedSignInSites: [], leakedSignInSites: [],
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
  // Re-checked against the LIVE permission set every time, so allowing a sign-in site
  // clears the warning without anything having to remember to forget it.
  // By the SESSION's site, not the tab's current origin: a signed-out tab ends on the
  // provider's login page (*.authkit.app), and hops are filed under the app that started
  // the chain (engine/capture.ts).
  //
  // Plus the page the tab is ON, when that is another website Tabsona may not touch: a
  // signed-out chain ends on the provider's own login page, and no response from there
  // ever reaches the capture listener, so this is the only way to see that last host.
  const hops = withLandingHost(await loadSignInHops(), session.site, origin)[session.site] ?? [];
  const unguardedSignInSites = await ungrantedOrigins(hops);
  // A sign-in that already went through an unguarded website (its login was refused, see
  // engine/capture.ts) is reported on the same layer, whether or not the host has been
  // allowed since: the session is not signed in as itself until it starts over.
  const leakedSignInSites = session.leakedThrough?.hosts ?? [];
  const coverage = computeCoverage(session.engine, {
    ...observationsFor(origin),
    unguardedSignInSites: [...new Set([...unguardedSignInSites, ...leakedSignInSites])].sort(),
  });

  return {
    tabId, url, site: origin, isWebPage: true, siteAllowed,
    sessionId: session.id,
    personaId: persona.id,
    personaName: persona.name,
    color: persona.color,
    isEmpty: isEmpty(session),
    coverage,
    summary: coverageSummary(coverage),
    unguardedSignInSites,
    leakedSignInSites,
  };
}

export async function renderBadge(tabId: TabId): Promise<void> {
  const status = await statusForTab(tabId);

  try {
    const signInLeak = status.unguardedSignInSites.length > 0 || status.leakedSignInSites.length > 0;
    await chrome.action.setBadgeText({ tabId, text: actionBadgeText(status.personaName, signInLeak) });
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: signInLeak ? SIGN_IN_ALERT_BADGE : status.color ?? NEUTRAL_BADGE,
    });
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
    style: settings.badgeStyle,
    // 0 = never hide. Seconds, not ms, so the page script cannot be handed a value the
    // settings validation never saw.
    hideAfterSeconds: settings.autoHideBadge ? settings.badgeHideSeconds : 0,
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

/**
 * Sign-in chains leaking through un-allowed hosts, for EVERY persona tab that is open —
 * what the popup's alert and its "Sign-in sites to allow" section show.
 *
 * Across all bound tabs rather than the active one: the user missed a warning that only
 * appeared while the right tab happened to be in front. Filtered against the LIVE
 * permission set, so allowing a host clears it with nothing having to forget anything.
 */
export async function openSignInAlerts(): Promise<SignInAlert[]> {
  const [bindings, lib, hops] = await Promise.all([loadBindings(), loadLibrary(), loadSignInHops()]);
  const siteOfSession = new Map(lib.sessions.map((s) => [s.id, s.site]));
  const sites: string[] = [];
  let withLanding = hops;
  for (const [tabId, sessionId] of Object.entries(bindings)) {
    const site = siteOfSession.get(sessionId);
    if (!site) continue;
    sites.push(site);
    // The host a tab is sitting on counts too (see statusForTab).
    const tab = await chrome.tabs.get(Number(tabId)).catch(() => null);
    withLanding = withLandingHost(withLanding, site, siteOf(tab?.url ?? ''));
  }
  const alerts = await Promise.all(signInAlertsFor(withLanding, sites).map(async (alert) => ({
    site: alert.site,
    hosts: await ungrantedOrigins(alert.hosts),
  })));
  return alerts.filter((alert) => alert.hosts.length > 0);
}
