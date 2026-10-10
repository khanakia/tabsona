// Service worker entry. Wiring only — every decision lives in ../core (pure) or in a
// sibling engine module. Nothing here holds state: MV3 tears this worker down at will,
// so state lives in chrome.storage behind the lock in ./repo.

import { registerCapture, whenCapturesSettled } from './capture';
import { pageWroteCookie } from './pagecookies';
import { forgetGateTab, gateContinue, gateInfo, gateListStoppedHost, gateOpenNormally, noteFormSubmit, openLeakWindow, registerGate } from './gate';
import { addPassThroughHosts, removePassThroughHost } from './passthrough';
import { accessPatterns } from './permissions';
import { syncRules } from './rules-sync';
import { renderAllBadges, renderBadge, statusForTab } from './badge';
import { captureTabStorage } from './storage';
import { shimFactsFrom } from '@/core/coverage';
import { noteShimReady } from './observations';
import {
  clearBadgePlacements, loadBindings, loadLibrary, loadPassThroughHosts, migrateFromV1, saveBindings, setBadgePlacement, setGatePending, setSetting,
  updateSettings, withLock,
} from './repo';
import { placementFrom } from '@/core/placement';
import { passThroughMatchPattern } from '@/core/passthrough';
import { OPTIONS_PAGE_PATH } from '@/core/constants';
import { siteOf } from '@/core/personas';
import {
  addSite, anotherLoginForSite, coverageReport, deletePersona, deleteSession, duplicatePersona, exportData,
  getState, importData, moveSession, newPersona, openPersona, openSession,
  renameSession, saveCurrentTab, startOver, startPeriodicCapture, unbindTab, updatePersona, useTabIn, type PersonaPatch,
} from './service';
import type { Request, Response } from '@/domain/messages';

const SHIM_SCRIPT_ID = 'tabsona-shim';
const BADGE_SCRIPT_ID = 'tabsona-badge';
const RELAY_SCRIPT_ID = 'tabsona-relay';

/**
 * Register the content scripts for exactly the origins currently granted.
 *
 * IDEMPOTENT ON PURPOSE. `registerContentScripts` throws `Duplicate script ID` if an id
 * already exists and the WHOLE call fails — so one stale registration silently takes
 * the shim down with it, and tabs then load with no isolation and nothing saying so.
 *
 * Reported by a real install: reloading at chrome://extensions runs the worker module
 * AND fires onInstalled, so two boots race.
 */
let registering: Promise<void> = Promise.resolve();
function registerContentScripts(): Promise<void> {
  // Serialized: unregister-then-register is NOT atomic, so two callers can both see
  // "nothing registered" and both register. Coalescing boot alone is not enough — a
  // regression test calling this three times in parallel still reproduced the error.
  const run = registering.then(doRegisterContentScripts, doRegisterContentScripts);
  registering = run.catch(() => undefined);
  return run;
}

async function doRegisterContentScripts(): Promise<void> {
  const matches = await accessPatterns();
  // The shim and the relay replace localStorage, IndexedDB and document.cookie with the
  // persona's own. On a website the user chose to reach with their normal login that
  // would be wrong twice over: the page would see a persona jar the browser never sends,
  // and an identity provider's own script would fight it. So neither runs there. The badge
  // does, so the tab can still say "uses your normal login".
  const passThrough = (await loadPassThroughHosts()).map(passThroughMatchPattern);
  const excludeMatches = passThrough.length > 0 ? { excludeMatches: passThrough } : {};

  // Unregister by what is ACTUALLY registered, not by the ids we expect, so an id left
  // behind by an older build is cleaned up too.
  const existing = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
  const ours = existing.map((s) => s.id).filter((id) => id === SHIM_SCRIPT_ID || id === BADGE_SCRIPT_ID || id === RELAY_SCRIPT_ID);
  if (ours.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: ours }).catch(() => undefined);
  }
  if (matches.length === 0) return;

  const scripts: chrome.scripting.RegisteredContentScript[] = [
    {
      // MAIN world + document_start: the shim must replace localStorage BEFORE any app
      // script reads it. A content script in the isolated world cannot.
      id: SHIM_SCRIPT_ID, js: ['shim.js'], matches, ...excludeMatches,
      runAt: 'document_start', world: 'MAIN', allFrames: true,
    },
    {
      // Carries the shim's cookie writes and barrier questions to the worker. Its own
      // script, at document_start in every frame: see content/relay.ts for why the badge
      // (document_idle, top frame) cannot do it.
      id: RELAY_SCRIPT_ID, js: ['relay.js'], matches, ...excludeMatches,
      runAt: 'document_start', world: 'ISOLATED', allFrames: true,
    },
    {
      // The badge lives in the ISOLATED world: it needs chrome.runtime, and page code
      // must not be able to find or remove the chip that reports isolation.
      id: BADGE_SCRIPT_ID, js: ['badge.js'], matches,
      runAt: 'document_idle', world: 'ISOLATED', allFrames: false,
    },
  ];

  try {
    await chrome.scripting.registerContentScripts(scripts);
  } catch (e) {
    // A previous worker GENERATION can register between our read and our write, which
    // no in-process lock can prevent. Recover rather than leave the shim unregistered.
    if (!String(e).includes('Duplicate script ID')) throw e;
    await chrome.scripting
      .unregisterContentScripts({ ids: [SHIM_SCRIPT_ID, BADGE_SCRIPT_ID, RELAY_SCRIPT_ID] })
      .catch(() => undefined);
    await chrome.scripting.registerContentScripts(scripts);
  }
}

/**
 * Every change to the "use my normal login" list has three effects, kept together so none
 * can be forgotten: the rules (inside add/remove), the content scripts (the shim and the
 * relay must not run on a listed website, see doRegisterContentScripts) and the badges.
 */
async function afterNormalLoginChange(): Promise<void> {
  await registerContentScripts();
  await renderAllBadges();
}

async function addNormalLogin(hosts: readonly string[]): Promise<void> {
  await addPassThroughHosts(hosts);
  await afterNormalLoginChange();
}

async function removeNormalLogin(host: string): Promise<void> {
  await removePassThroughHost(host);
  await afterNormalLoginChange();
}

/** The gate page's "Use my normal login here": list the stopped host, resume the tab. */
async function useNormalLoginAndResume(tabId: number): Promise<boolean> {
  if (!(await gateListStoppedHost(tabId))) return false;
  await afterNormalLoginChange(); // scripts first: the resumed page must not load the shim
  return gateContinue(tabId);
}

/**
 * Bring the worker up. SERIALIZED AND COALESCED: several events legitimately want to
 * boot, and on an extension reload at least two fire together.
 */
let booting: Promise<void> | null = null;
function boot(): Promise<void> {
  if (booting) return booting;
  booting = (async () => {
    try {
      await migrateFromV1();
      await registerCapture();
      await registerContentScripts();
      await syncRules();
    } catch (e) {
      // Log rather than throw: an unhandled rejection here leaves the worker
      // half-started with no sign of why.
      console.error('[tabsona] boot failed', e);
    } finally {
      booting = null;
    }
  })();
  return booting;
}

let captureTimerStarted = false;
function startCaptureTimerOnce(): void {
  if (captureTimerStarted) return;
  captureTimerStarted = true;
  startPeriodicCapture();
}

void boot();
startCaptureTimerOnce();
// In the module body, like every listener: a worker woken by a navigation event must
// already have it, or the stopped tab is left on Chrome's "blocked" page.
registerGate();

chrome.runtime.onInstalled.addListener((details) => {
  void boot();
  // First install only, never on an update or a reload: the library page opens on its
  // welcome card, which asks once whether to allow every website. An update must not
  // put a page in front of someone who already set Tabsona up.
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`${OPTIONS_PAGE_PATH}#personas`) });
  }
});
chrome.runtime.onStartup.addListener(() => void boot());
// Origins are granted at runtime, so BOTH the capture listener and the content scripts
// must be re-scoped the moment that happens — otherwise a site the user just allowed
// stays silently un-isolated until the next browser restart.
//
// The per-tab rules are not rebuilt here (boot() does re-sync them anyway): the strip
// rule names no host, and Chrome checks host access as it matches each request, so an
// open persona tab should be covered on its next request to a newly allowed host — from
// Chrome's documented behaviour; a runtime grant needs a human click, so no suite
// observes it. What certainly goes stale is what the badges say, so they are redrawn —
// otherwise a tab keeps showing "!" for a sign-in host the user has just allowed.
chrome.permissions.onAdded.addListener(() => void boot().then(renderAllBadges));
chrome.permissions.onRemoved.addListener(() => void boot().then(renderAllBadges));

chrome.tabs.onRemoved.addListener((tabId) => {
  void forgetGateTab(tabId);
  void (async () => {
    const bindings = await loadBindings();
    if (!(String(tabId) in bindings)) return;
    // No capture here: the page is already gone. Periodic capture plus capture on load
    // is what keeps a session fresh.
    await withLock(async () => {
      const next = { ...(await loadBindings()) };
      delete next[String(tabId)];
      await saveBindings(next);
    });
    await syncRules();
  })();
});

/**
 * A tab opened FROM a session tab inherits it — but only a tab opened from a LINK, and
 * only when it is going somewhere inside that session.
 *
 * Uses `webNavigation.onCreatedNavigationTarget` rather than `tabs.onCreated`, for two
 * reasons, both learned the hard way:
 *
 *  1. `tabs.onCreated` fires for EVERY new tab, including a blank ⌘T. Such a tab has an
 *     opener too, so it inherited and an empty new tab silently joined a persona —
 *     reported with a screenshot, and a violation of this project's own rule that an
 *     unbound tab must behave exactly like an ordinary tab.
 *  2. At `tabs.onCreated` the tab has no url yet, so there is nothing to check the
 *     destination against. This event carries the destination url up front, and fires
 *     only for target=_blank / window.open / "open in new tab" — exactly the case the
 *     inheritance exists for.
 */
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  void (async () => {
    const site = siteOf(details.url);
    if (!site) return; // not an http(s) destination

    const bindings = await loadBindings();
    const parentSessionId = bindings[String(details.sourceTabId)];
    if (!parentSessionId) return;

    const lib = await loadLibrary();
    const parent = lib.sessions.find((s) => s.id === parentSessionId);
    if (!parent) return;

    // Only inherit when the destination really belongs to the parent session; a link
    // out to an unrelated site should behave like an ordinary tab.
    let host: string;
    try { host = new URL(details.url).hostname.toLowerCase(); } catch { return; }
    if (parent.site !== site && !parent.domains.includes(host)) return;

    await withLock(async () => {
      const next = { ...(await loadBindings()) };
      next[String(details.tabId)] = parentSessionId;
      await saveBindings(next);
    });
    await syncRules();
  })();
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  void (async () => {
    // No rule sync on navigation: rules are scoped by request url, not by the url the
    // tab is on, so where a tab navigates never changes them. Re-syncing here once hid
    // a race where the rule followed the tab one request too late.
    if (info.status === 'complete') {
      await captureTabStorage(tabId).catch(() => false);
      await renderBadge(tabId);
    }
  })();
});

chrome.tabs.onActivated.addListener(({ tabId }) => void renderBadge(tabId));

/** One-way notices from content scripts. Handled by their own listener below, so the
 *  request/response listener must not answer them with an "unknown op" error. */
const NOTICE_OPS: ReadonlySet<string> = new Set(['shimReady', 'badgeMoved', 'badgeReset', 'formSubmit']);

chrome.runtime.onMessage.addListener((raw, sender, respond: (r: Response) => void) => {
  const op = typeof raw === 'object' && raw !== null ? (raw as { op?: unknown }).op : undefined;
  if (typeof op === 'string' && NOTICE_OPS.has(op)) return false;
  void (async () => {
    const msg = raw as Request;
    try {
      switch (msg.op) {
        case 'getState': respond({ ok: true, state: await getState() }); break;
        case 'createPersona': respond({ ok: true, personaId: await newPersona(msg.name) }); break;
        case 'updatePersona': {
          const patch: PersonaPatch = {};
          if (msg.name !== undefined) patch.name = msg.name;
          if (msg.description !== undefined) patch.description = msg.description;
          if (msg.color !== undefined) patch.color = msg.color;
          await updatePersona(msg.personaId, patch);
          respond({ ok: true });
          break;
        }
        case 'deletePersona': await deletePersona(msg.personaId); respond({ ok: true }); break;
        case 'duplicatePersona': {
          const id = await duplicatePersona(msg.personaId, msg.name);
          respond(id ? { ok: true, personaId: id } : { ok: false, error: 'no such persona' });
          break;
        }
        case 'openPersona': respond({ ok: true, opened: await openPersona(msg.personaId) }); break;
        case 'saveCurrentTab':
          respond(await saveCurrentTab(msg.personaId, msg.mode, msg.replace ?? false));
          break;
        case 'useTabIn': respond({ ok: true, tabId: await useTabIn(msg.personaId) }); break;
        case 'addSite': respond({ ok: true, tabId: await addSite(msg.personaId, msg.url) }); break;
        case 'anotherLogin': respond({ ok: true, tabId: await anotherLoginForSite(msg.url, msg.name) }); break;
        case 'openSession': respond({ ok: true, tabId: await openSession(msg.sessionId, msg.where) }); break;
        case 'renameSession': await renameSession(msg.sessionId, msg.label); respond({ ok: true }); break;
        case 'deleteSession': await deleteSession(msg.sessionId); respond({ ok: true }); break;
        case 'moveSession': respond(await moveSession(msg.sessionId, msg.toPersonaId)); break;
        case 'saveNow': await captureTabStorage(msg.tabId); respond({ ok: true }); break;
        case 'unbindTab': await unbindTab(msg.tabId); respond({ ok: true }); break;
        case 'tabStatus': respond({ ok: true, status: await statusForTab(msg.tabId) }); break;
        case 'coverageReport': respond({ ok: true, report: coverageReport() }); break;
        case 'exportData': respond({ ok: true, json: await exportData() }); break;
        case 'importData': respond(await importData(msg.json)); break;
        case 'setSetting': await setSetting(msg.key, msg.value); await renderAllBadges(); respond({ ok: true }); break;
        case 'setBadgePosition': await updateSettings({ badgePosition: msg.position }); await renderAllBadges(); respond({ ok: true }); break;
        case 'resetBadgePlacements': await clearBadgePlacements(); await renderAllBadges(); respond({ ok: true }); break;
        case 'updateSettings': await updateSettings(msg.patch); await renderAllBadges(); respond({ ok: true }); break;
        case 'gateInfo': respond({ ok: true, gate: await gateInfo(msg.tabId) }); break;
        case 'gateContinue':
          respond(await gateContinue(msg.tabId)
            ? { ok: true }
            : { ok: false, error: 'Tabsona is still not allowed on that website, so the tab stayed here.' });
          break;
        case 'cookieWrite':
          await pageWroteCookie(sender.tab?.id ?? -1, sender.url, msg.url, msg.line);
          respond({ ok: true });
          break;
        case 'cookieSettle': await whenCapturesSettled(); respond({ ok: true }); break;
        case 'gateOpenNormally':
          respond(await gateOpenNormally(msg.tabId) ? { ok: true } : { ok: false, error: 'nothing is waiting in that tab' });
          break;
        case 'gateUsePassThrough':
          respond(await useNormalLoginAndResume(msg.tabId) ? { ok: true } : { ok: false, error: 'nothing is waiting in that tab' });
          break;
        case 'passThroughAdd': await addNormalLogin(msg.hosts); respond({ ok: true }); break;
        case 'passThroughRemove': await removeNormalLogin(msg.host); respond({ ok: true }); break;
        case 'startOver': await startOver(msg.sessionId); respond({ ok: true }); break;
        default: {
          // Exhaustiveness: an op added without a handler fails to compile.
          const never: never = msg;
          respond({ ok: false, error: `unknown op ${JSON.stringify(never)}` });
        }
      }
    } catch (e) {
      respond({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return true; // keep the channel open for the async respond
});

// One-way notices from the ISOLATED-world badge script: the shim's self-report, and the
// user dragging or resetting the in-page badge.
chrome.runtime.onMessage.addListener((raw, sender) => {
  const msg = typeof raw === 'object' && raw !== null ? (raw as { op?: unknown; origin?: unknown }) : null;
  if (typeof msg?.origin !== 'string' || !msg.origin) return;
  const origin = msg.origin;
  if (msg.op === 'formSubmit') {
    const form = raw as { action?: unknown; method?: unknown };
    if (sender.tab?.id !== undefined) void noteFormSubmit(sender.tab.id, form.action, form.method);
  } else if (msg.op === 'shimReady') {
    noteShimReady(origin, shimFactsFrom(raw));
    if (sender.tab?.id !== undefined) void renderBadge(sender.tab.id);
  } else if (msg.op === 'badgeMoved') {
    // Validated, not trusted: a page could post anything through the badge script.
    const placement = placementFrom(raw);
    if (placement) void setBadgePlacement(origin, placement).then(renderAllBadges);
  } else if (msg.op === 'badgeReset') {
    void setBadgePlacement(origin, null).then(renderAllBadges);
  }
});

// Exposed for the end-to-end drivers, which talk to this worker over CDP and cannot use
// sendMessage (Chrome does not deliver a message to its own sender).
Object.assign(globalThis, {
  __tabsona: {
    getState, newPersona, updatePersona, deletePersona, duplicatePersona,
    openPersona, saveCurrentTab, addSite, openSession, renameSession, deleteSession,
    moveSession, unbindTab, statusForTab, captureTabStorage, syncRules, anotherLoginForSite, useTabIn,
    coverageReport, exportData, importData,
    boot, registerContentScripts, updateSettings, renderAllBadges,
    gateInfo, gateContinue, gateOpenNormally, startOver,
    addNormalLogin, removeNormalLogin, useNormalLoginAndResume,
    // E2E seams for states a headless run cannot reach honestly: a stopped tab whose host
    // Chrome's permission dialog (a human click) would then allow, and a leak window.
    setGatePending, openLeakWindow,
  },
});
