// The sign-in gate's chrome.* half: notice a navigation the gate rule stopped, put the
// gate page in its place, and act on the page's answer. Every decision is in core/gate.ts.
//
// Why a gate at all: see core/gate.ts. In one line, a persona tab that reaches a website
// Tabsona is not allowed on carries the browser's own login there, so it is stopped
// BEFORE it leaves, and the user is asked in that very tab.

import { GATE_PAGE_PATH, GATE_TAB_PARAM } from '@/core/constants';
import {
  blockedTarget, hostsToAsk, redirectOpensLeakWindow, withLeakWindow, withoutLeakWindow,
} from '@/core/gate';
import { FORM_METHOD_POST } from '@/core/constants';
import { siteOf } from '@/core/personas';
import {
  loadBindings, loadGatePending, loadLastPages, loadLibrary, loadSignInHops, recordFormHint, recordStop, setFormHint,
  setGatePending, setLastPage, updateLeakWindows,
} from './repo';
import { ungrantedOrigins } from './permissions';
import { syncRules, tabIsGated } from './rules-sync';
import { renderBadge } from './badge';
import { tabGroupsAvailable } from './tabgroups';
import type { GateInfo, GateReason } from '@/domain/messages';
import type { Origin, TabId } from '@/domain/types';

/** The gate page's url for one stopped tab. */
function gatePageUrl(tabId: TabId): string {
  return `${chrome.runtime.getURL(GATE_PAGE_PATH)}?${GATE_TAB_PARAM}=${tabId}`;
}

/**
 * A top-level navigation failed. When it is a persona tab that the gate stopped on its
 * way to a host Tabsona is not allowed on, record where it was going and show the gate
 * page in its place.
 *
 * The record is written BEFORE the page is shown, so the page never asks for a tab the
 * worker knows nothing about. The url travels only as the tab id; the page reads the rest
 * from the worker, so nothing a page could be handed in a link is trusted.
 */
async function onErrorOccurred(details: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails): Promise<void> {
  const target = blockedTarget(details);
  if (target === null) return;
  const sessionId = (await loadBindings())[String(details.tabId)];
  if (!sessionId) return; // an ordinary tab: never ours, whatever blocked it
  // Allowed by now (granted between the block and this event), or blocked by someone
  // else's rule: either way not a question for the gate page.
  if ((await ungrantedOrigins([target])).length === 0) return;

  // A form POST arrives here as a bare url: its body is gone and the event does not say it
  // was one. The page that held the form told the worker (noteFormSubmit), and recordStop
  // joins the two atomically whichever arrived first.
  await recordStop(details.tabId, { url: details.url, host: target, sessionId, at: Date.now() });
  await chrome.tabs.update(details.tabId, { url: gatePageUrl(details.tabId) }).catch(() => undefined);
}

/**
 * A form on a persona tab's page is being POSTed (content/relay.ts reports the submit).
 * Remembers it, and when the gate already stopped that very navigation (the notice lost
 * the race with the block event), marks the stop as a form POST after the fact.
 *
 * Validated, not trusted: the notice comes from page-adjacent code, so only a bound tab's
 * notice with a string url and the POST method is kept.
 */
export async function noteFormSubmit(tabId: TabId, action: unknown, method: unknown): Promise<void> {
  if (typeof action !== 'string' || method !== FORM_METHOD_POST) return;
  if (!(String(tabId) in await loadBindings())) return;
  await recordFormHint(tabId, { action, method, at: Date.now() });
}

/**
 * A frame of a persona tab committed a page. Two jobs:
 *
 * 1. Remember the tab's top-level page, so "Open in a normal tab" can put the persona tab
 *    back where it was rather than on the app's front page.
 * 2. Open a LEAK WINDOW when the page is on a host Tabsona is not allowed on: the tab is
 *    then carrying the browser's login there, and whatever it signs in as must not be
 *    saved (engine/capture.ts). A top-level commit there means the gate was missing; a
 *    sub-frame counts only when the host is in the site's known sign-in chain, because an
 *    app embedding a video or a map is not signing in through it, and refusing every
 *    later capture for that would break normal use.
 */
async function onCommitted(details: chrome.webNavigation.WebNavigationTransitionCallbackDetails): Promise<void> {
  const origin = siteOf(details.url);
  if (origin === null) return;
  const sessionId = (await loadBindings())[String(details.tabId)];
  if (!sessionId) return;

  if (details.frameId === 0) await setLastPage(details.tabId, details.url);
  if ((await ungrantedOrigins([origin])).length === 0) return;

  if (details.frameId !== 0) {
    const site = (await loadLibrary()).sessions.find((s) => s.id === sessionId)?.site;
    const chain = site ? (await loadSignInHops())[site] ?? [] : [];
    if (!chain.includes(origin)) return;
  }
  await openLeakWindow(details.tabId, origin);
}

/** Open (or extend) `tabId`'s leak window for `host`, and redraw its badge. */
export async function openLeakWindow(tabId: TabId, host: Origin): Promise<void> {
  const now = Date.now();
  await updateLeakWindows((windows) => withLeakWindow(windows, tabId, host, now));
  await renderBadge(tabId);
}

/**
 * Called by the capture listener for a cross-origin redirect a persona tab received to a
 * host Tabsona is not allowed on. A top-level one in a gated tab is stopped by the gate,
 * so it opens no window; see core/gate.ts, redirectOpensLeakWindow.
 */
export async function noteUnguardedRedirect(tabId: TabId, host: Origin, resourceType: string): Promise<void> {
  if (redirectOpensLeakWindow(resourceType, await tabIsGated(tabId))) await openLeakWindow(tabId, host);
}

/** Wire the gate's listeners. Called once from the worker's module body, like every
 *  other listener, so a worker woken by a navigation event has them in place. */
export function registerGate(): void {
  chrome.webNavigation.onErrorOccurred.addListener((d) => void onErrorOccurred(d));
  chrome.webNavigation.onCommitted.addListener((d) => void onCommitted(d));
}

/** Everything the gate page shows for `tabId`, or null when nothing is pending there. */
export async function gateInfo(tabId: TabId): Promise<GateInfo | null> {
  const pending = (await loadGatePending())[String(tabId)];
  if (!pending) return null;
  const lib = await loadLibrary();
  const session = lib.sessions.find((s) => s.id === pending.sessionId);
  const persona = session ? lib.personas.find((p) => p.id === session.personaId) : undefined;
  if (!session || !persona) return null;

  const chain = (await loadSignInHops())[session.site] ?? [];
  const reason: GateReason = pending.host === session.site
    ? 'own-site'
    : chain.includes(pending.host) ? 'sign-in' : 'link';
  const wanted = reason === 'sign-in' ? hostsToAsk(chain, pending.host) : [pending.host];
  return {
    tabId,
    url: pending.url,
    host: pending.host,
    site: session.site,
    personaName: persona.name,
    color: persona.color,
    reason,
    hostsToAllow: await ungrantedOrigins(wanted),
    viaForm: pending.viaForm === true,
  };
}

/**
 * Resume the stopped navigation. The gate page has just asked Chrome for the hosts from
 * the user's click; this re-syncs the rules against the new grants and sends the tab to
 * the exact url it was going to.
 *
 * Refuses (false) while the stopped host is still not allowed: the user declined Chrome's
 * prompt, and navigating anyway would only be stopped again, or worse, leak.
 */
export async function gateContinue(tabId: TabId): Promise<boolean> {
  const pending = (await loadGatePending())[String(tabId)];
  if (!pending) return false;
  if ((await ungrantedOrigins([pending.host])).length > 0) return false;
  await syncRules();
  await setGatePending(tabId, null);
  if (pending.viaForm) {
    // Its body is gone: navigating to the url would send the provider a GET with no
    // parameters. Back to the page that held the form; the user presses its button again,
    // and this time the request is allowed and carries its fields.
    const back = (await loadLastPages())[String(tabId)];
    await chrome.tabs.goBack(tabId).catch(async () => {
      if (back) await chrome.tabs.update(tabId, { url: back });
    });
    return true;
  }
  await chrome.tabs.update(tabId, { url: pending.url });
  return true;
}

/**
 * Open the stopped url in an ORDINARY tab, and put the persona tab back on the page it
 * was on.
 *
 * Why both, rather than turning the persona tab itself into an ordinary one: the persona
 * tab belongs to the persona and may hold work; the destination is somewhere the user
 * wants to be as themselves (a link to GitHub, a docs page). A new tab beside it is what
 * a middle-click would have given them, and Tabsona never binds a tab it creates this way
 * (it is not opened from a link, so no inheritance applies).
 */
export async function gateOpenNormally(tabId: TabId): Promise<boolean> {
  const pending = (await loadGatePending())[String(tabId)];
  if (!pending) return false;
  if (pending.viaForm) return false; // a bare GET of a POST target is not the request that was stopped
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const opened = await chrome.tabs.create({
    url: pending.url,
    active: true,
    ...(tab?.index === undefined ? {} : { index: tab.index + 1 }),
    ...(tab?.windowId === undefined ? {} : { windowId: tab.windowId }),
  });
  // Inserted beside a grouped tab, Chrome can place it IN that persona's group, and a
  // tab in the group reads as the persona's while it holds the browser's own login.
  if (tabGroupsAvailable() && opened.id !== undefined && opened.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    await chrome.tabs.ungroup(opened.id).catch(() => undefined);
  }
  const lib = await loadLibrary();
  const site = lib.sessions.find((s) => s.id === pending.sessionId)?.site;
  const back = (await loadLastPages())[String(tabId)] ?? site;
  await setGatePending(tabId, null);
  if (back) await chrome.tabs.update(tabId, { url: back }).catch(() => undefined);
  return true;
}

/** Forget everything the gate holds for a tab that has closed. */
export async function forgetGateTab(tabId: TabId): Promise<void> {
  await setGatePending(tabId, null);
  await setFormHint(tabId, null);
  await setLastPage(tabId, null);
  const now = Date.now();
  await updateLeakWindows((windows) => withoutLeakWindow(windows, tabId, now));
}
