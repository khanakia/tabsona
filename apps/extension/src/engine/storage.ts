// Reads and writes a session's page-storage slice, THROUGH THE SHIM'S HANDLE.

import { SHIM_WAIT_POLL_MS, SHIM_WAIT_TIMEOUT_MS } from '@/core/constants';
import { loadBindings, loadLibrary, mutateSession } from './repo';
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
