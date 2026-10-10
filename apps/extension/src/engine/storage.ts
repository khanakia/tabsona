// Reads and writes a session's page-storage slice, THROUGH THE SHIM'S HANDLE.

import {
  NAMESPACE_SEPARATOR, SESSION_MARKER, SHIM_WAIT_POLL_MS, SHIM_WAIT_TIMEOUT_MS,
} from '@/core/constants';
import { leakWindowFor } from '@/core/gate';
import { loadBindings, loadLeakWindows, loadLibrary, mutateSession } from './repo';
import type { Origin, SessionId, StorageSlice, TabId } from '@/domain/types';

interface PageSlice {
  readonly origin: Origin;
  readonly local: StorageSlice;
  readonly session: StorageSlice;
}

/**
 * MUST go through `window.__tabsonaSession`, never `window.localStorage`.
 *
 * Once the shim is installed, `window.localStorage` IS the proxy: its `key(i)` already
 * returns the un-prefixed key, so a prefix scan over it finds nothing and capture
 * silently saves an empty slice; and writing `prefix + key` through it produces
 * `prefix + prefix + key`. Both bugs were invisible for a while because localStorage
 * persists per origin, so restored tabs kept finding their old data and save/restore
 * appeared to work. The test only became honest once it wiped the origin in between.
 *
 * The handle's id is checked against the session we intend, so a tab that resolved a
 * DIFFERENT session can never have its storage filed under this one.
 */
async function readSlice(tabId: TabId, sessionId: SessionId): Promise<PageSlice | null> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [sessionId],
    func: (wanted: string) => {
      const handle = (window as {
        __tabsonaSession?: {
          id: string;
          dumpLocal: () => Record<string, string>;
          dumpSession: () => Record<string, string>;
        };
      }).__tabsonaSession;
      if (!handle || handle.id !== wanted) return null;
      try {
        return { origin: location.origin, local: handle.dumpLocal(), session: handle.dumpSession() };
      } catch { return null; }
    },
  }).catch(() => [{ result: null }] as const);

  return (result?.result as PageSlice | null) ?? null;
}

/** Capture a bound tab's storage into its session. Safe to call often. */
export async function captureTabStorage(tabId: TabId): Promise<boolean> {
  const bindings = await loadBindings();
  const sessionId = bindings[String(tabId)];
  if (!sessionId) return false;

  // Inside a leak window the page may hold the browser's user's tokens, carried back by
  // a provider Tabsona could not guard. Same rule as the cookies (engine/capture.ts).
  if (leakWindowFor(await loadLeakWindows(), tabId, Date.now()) !== null) return false;

  const slice = await readSlice(tabId, sessionId);
  if (!slice) return false;
  // Writing an empty slice would overwrite a good one with nothing.
  if (Object.keys(slice.local).length === 0 && Object.keys(slice.session).length === 0) return false;

  return mutateSession(sessionId, (session) => {
    session.storage[slice.origin] = { local: slice.local, session: slice.session };
    session.savedAt = Date.now();
    session.lastUsedAt = Date.now();
  });
}

/** Write a saved slice back into a tab, under this session's namespace. */
export async function restoreTabStorage(
  tabId: TabId, sessionId: SessionId, origin: Origin,
): Promise<boolean> {
  const lib = await loadLibrary();
  const saved = lib.sessions.find((s) => s.id === sessionId)?.storage[origin];
  const local = saved?.local ?? {};
  const sessionArea = saved?.session ?? {};
  if (Object.keys(local).length === 0 && Object.keys(sessionArea).length === 0) return false;

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [sessionId, local, sessionArea],
    func: (
      wanted: string,
      localSlice: Record<string, string>,
      sessionSlice: Record<string, string>,
    ) => {
      const handle = (window as {
        __tabsonaSession?: {
          id: string;
          loadLocal: (s: Record<string, string>) => void;
          loadSession: (s: Record<string, string>) => void;
        };
      }).__tabsonaSession;
      if (!handle || handle.id !== wanted) return false;
      try {
        handle.loadLocal(localSlice);
        handle.loadSession(sessionSlice);
        return true;
      } catch { return false; }
    },
  }).catch(() => [{ result: false }] as const);

  return result?.result === true;
}

/** Wait for the shim to exist before trying to write through it. */
export async function awaitShim(tabId: TabId): Promise<boolean> {
  const deadline = Date.now() + SHIM_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const present = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: () => '__tabsonaSession' in window,
    }).then((r) => r[0]?.result === true).catch(() => false);
    if (present) return true;
    await new Promise((r) => setTimeout(r, SHIM_WAIT_POLL_MS));
  }
  return false;
}

/**
 * Take a tab OUT of its session on the page side, then reload it as a plain tab.
 *
 * Unbinding alone only drops the cookie rules. The page shim resolves its session from
 * carriers the PAGE holds (`window.name`, a `sessionStorage` marker — see shim.ts), so a
 * tab whose session was forgotten kept namespacing storage under a session that no longer
 * existed, while its requests now carried the browser's own cookies: two identities in one
 * tab, and a badge that said nothing. Clearing the carriers and reloading makes the tab
 * honestly what it now is, a normal tab on the browser's login.
 *
 * Runs in the ISOLATED world on purpose: there `sessionStorage` is the real object, not the
 * shim's proxy, and `window.name` is the same browsing-context value the shim reads.
 *
 * `dropPageData` also removes the session's own namespaced keys from this origin's
 * localStorage — right when the login is being FORGOTTEN (nothing will ever read them
 * again, and they hold its tokens), wrong when a tab merely leaves a persona that keeps it.
 */
export async function releaseTab(tabId: TabId, sessionId: SessionId, dropPageData: boolean): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    args: [SESSION_MARKER, sessionId, NAMESPACE_SEPARATOR, dropPageData],
    func: (marker: string, id: string, separator: string, drop: boolean) => {
      try { sessionStorage.removeItem(marker); } catch { /* blocked */ }
      try {
        const prefix = `${marker}:`;
        const name = String(window.name || '');
        if (name.startsWith(prefix)) {
          const bar = name.indexOf('|');
          window.name = bar === -1 ? '' : name.slice(bar + 1);
        }
      } catch { /* some pages lock window.name */ }
      if (!drop) return;
      const own = `${id}${separator}`;
      for (const store of [localStorage, sessionStorage]) {
        try {
          const doomed: string[] = [];
          for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (key?.startsWith(own)) doomed.push(key);
          }
          for (const key of doomed) store.removeItem(key);
        } catch { /* blocked */ }
      }
    },
  }).catch(() => undefined); // a page we may not script holds no shim either
  await chrome.tabs.reload(tabId).catch(() => undefined);
}

/**
 * Remove ONE session's page data from the origin a tab is on, keeping the tab in the
 * session: its namespaced localStorage and sessionStorage keys and its namespaced
 * IndexedDB databases (core/idb.ts names them `<session>::<name>`). The caller then
 * navigates the tab, so the app boots with nothing.
 *
 * For "Start over signed out" after a leaked sign-in: the page may hold the tokens of
 * whoever the provider signed the tab in as, and the session is about to sign in again
 * through the gate. Unlike releaseTab, the session carriers stay: the tab is still the
 * persona's.
 */
export async function clearTabPageData(tabId: TabId, sessionId: SessionId): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    args: [sessionId, NAMESPACE_SEPARATOR],
    func: async (id: string, separator: string) => {
      const own = `${id}${separator}`;
      for (const store of [localStorage, sessionStorage]) {
        try {
          const doomed: string[] = [];
          for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (key?.startsWith(own)) doomed.push(key);
          }
          for (const key of doomed) store.removeItem(key);
        } catch { /* blocked */ }
      }
      try {
        const dbs = await indexedDB.databases();
        for (const db of dbs) if (db.name?.startsWith(own)) indexedDB.deleteDatabase(db.name);
      } catch { /* no IndexedDB here */ }
    },
  }).catch(() => undefined); // a page we may not script (the gate page) holds no data
}
