// Service worker entry. Wiring only — every decision lives in ../core (pure) or in a
// sibling engine module. Nothing here holds state: MV3 tears this worker down at will,
// so state lives in chrome.storage behind the lock in ./repo.

import { registerCapture } from './capture';
import { grantedOriginPatterns } from './permissions';
import { syncRules } from './rules-sync';
import { renderBadge, statusForTab } from './badge';
import { captureTabStorage } from './storage';
import { noteShimReady } from './observations';
import { loadBindings, loadLibrary, migrateFromV1, saveBindings, setSetting, withLock } from './repo';
import { siteOf } from '@/core/personas';
import {
  addSite, anotherLoginForSite, coverageReport, deletePersona, deleteSession, duplicatePersona, exportData,
  getState, importData, moveSession, newPersona, openPersona, openSession,
  renameSession, saveCurrentTab, startPeriodicCapture, unbindTab, updatePersona, useTabIn,
} from './service';
import type { Request, Response } from '@/domain/messages';

const SHIM_SCRIPT_ID = 'tabsona-shim';
const BADGE_SCRIPT_ID = 'tabsona-badge';

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
  const matches = await grantedOriginPatterns();

  // Unregister by what is ACTUALLY registered, not by the ids we expect, so an id left
  // behind by an older build is cleaned up too.
  const existing = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
  const ours = existing.map((s) => s.id).filter((id) => id === SHIM_SCRIPT_ID || id === BADGE_SCRIPT_ID);
  if (ours.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: ours }).catch(() => undefined);
  }
  if (matches.length === 0) return;

  const scripts: chrome.scripting.RegisteredContentScript[] = [
    {
      // MAIN world + document_start: the shim must replace localStorage BEFORE any app
      // script reads it. A content script in the isolated world cannot.
      id: SHIM_SCRIPT_ID, js: ['shim.js'], matches,
      runAt: 'document_start', world: 'MAIN', allFrames: true,
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
      .unregisterContentScripts({ ids: [SHIM_SCRIPT_ID, BADGE_SCRIPT_ID] })
      .catch(() => undefined);
    await chrome.scripting.registerContentScripts(scripts);
  }
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

chrome.runtime.onInstalled.addListener(() => void boot());
chrome.runtime.onStartup.addListener(() => void boot());
// Origins are granted at runtime, so BOTH the capture listener and the content scripts
// must be re-scoped the moment that happens — otherwise a site the user just allowed
// stays silently un-isolated until the next browser restart.
chrome.permissions.onAdded.addListener(() => void boot());
chrome.permissions.onRemoved.addListener(() => void boot());

chrome.tabs.onRemoved.addListener((tabId) => {
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
    // A navigation changes which cookies apply, so rules must follow the url.
    if (info.url) await syncRules();
    if (info.status === 'complete') {
      await captureTabStorage(tabId).catch(() => false);
      await renderBadge(tabId);
    }
  })();
});

chrome.tabs.onActivated.addListener(({ tabId }) => void renderBadge(tabId));

chrome.runtime.onMessage.addListener((raw, sender, respond: (r: Response) => void) => {
  void (async () => {
    const msg = raw as Request;
    try {
      switch (msg.op) {
        case 'getState': respond({ ok: true, state: await getState() }); break;
        case 'createPersona': respond({ ok: true, personaId: await newPersona(msg.name) }); break;
        case 'updatePersona': {
          const patch: { name?: string; description?: string } = {};
          if (msg.name !== undefined) patch.name = msg.name;
          if (msg.description !== undefined) patch.description = msg.description;
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
        case 'setSetting': await setSetting(msg.key, msg.value); respond({ ok: true }); break;
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

// Relayed by the ISOLATED-world badge script: the shim's self-report.
chrome.runtime.onMessage.addListener((raw, sender) => {
  const msg = raw as { op?: string; origin?: string; usesIndexedDb?: boolean; hasServiceWorker?: boolean };
  if (msg?.op !== 'shimReady' || !msg.origin) return;
  noteShimReady(msg.origin, {
    usesIndexedDb: msg.usesIndexedDb ?? false,
    hasServiceWorker: msg.hasServiceWorker ?? false,
  });
  if (sender.tab?.id !== undefined) void renderBadge(sender.tab.id);
});

// Exposed for the end-to-end drivers, which talk to this worker over CDP and cannot use
// sendMessage (Chrome does not deliver a message to its own sender).
Object.assign(globalThis, {
  __tabsona: {
    getState, newPersona, updatePersona, deletePersona, duplicatePersona,
    openPersona, saveCurrentTab, addSite, openSession, renameSession, deleteSession,
    moveSession, unbindTab, statusForTab, captureTabStorage, syncRules, anotherLoginForSite, useTabIn,
    coverageReport, exportData, importData,
    boot, registerContentScripts,
  },
});
