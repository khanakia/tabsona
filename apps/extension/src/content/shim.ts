// Runs in the PAGE's MAIN world at document_start, before any app script.
//
// JOB: make every storage read and write in this page resolve inside a namespace
// owned by the SESSION this tab is bound to, so two tabs on one origin can hold two
// different logins.
//
// Built as a self-contained IIFE (see vite.scripts.config.ts): a content script is
// injected as a classic script and cannot be an ES module, and this one in
// particular must be a single file with no imports because it runs before anything
// else on the page.

import { NAMESPACE_SEPARATOR, SESSION_MARKER } from '@/core/constants';

/**
 * `Storage.length` — the one property of the real API that is not a method.
 *
 * Named because the Proxy must special-case it in four traps, and a typo in any one of
 * them silently changes behaviour: `ownKeys` must report it or `Object.keys` throws on
 * the invariant check.
 */
const LENGTH_PROP = 'length';

(() => {
  // --- resolve the session, synchronously ------------------------------------
  // This script cannot await a message from the service worker and still beat the
  // app's first script, so the session id travels on carriers the page can read
  // instantly, in priority order:
  //   1. the url hash marker  — freshest, the extension just set it for this nav
  //   2. window.name          — survives a same-tab navigation, which loses the hash
  //   3. sessionStorage       — survives a reload
  //
  // NOTE on why sessionStorage is only a CARRIER: it is per-tab, so a namespace
  // STORED there dies with the tab. Keying the namespace to it is the defect that
  // makes save/restore impossible in every shipped extension examined. Here the
  // namespace is derived from the session id, so any tab bound to that session
  // resolves to the same storage.
  const NAME_PREFIX = `${SESSION_MARKER}:`;

  const fromHash = (): string | null => {
    try {
      const m = new RegExp(`(?:^#|&)${SESSION_MARKER}=([^&]+)`).exec(location.hash || '');
      return m?.[1] ? decodeURIComponent(m[1]) : null;
    } catch { return null; }
  };
  const fromWindowName = (): string | null => {
    try {
      const raw = String(window.name || '');
      if (!raw.startsWith(NAME_PREFIX)) return null;
      const rest = raw.slice(NAME_PREFIX.length);
      const bar = rest.indexOf('|');
      return bar === -1 ? rest : rest.slice(0, bar);
    } catch { return null; }
  };
  const fromSessionStorage = (): string | null => {
    try { return sessionStorage.getItem(SESSION_MARKER); } catch { return null; }
  };

  const sessionId = fromHash() ?? fromWindowName() ?? fromSessionStorage();
  // An unbound tab must behave EXACTLY like a normal tab. Changing anything here
  // would make the extension's presence observable on every page.
  if (!sessionId) return;

  // Re-seed the carriers so a later navigation in this tab still resolves.
  try { sessionStorage.setItem(SESSION_MARKER, sessionId); } catch { /* blocked */ }
  try {
    if (fromWindowName() !== sessionId) {
      const rest = String(window.name || '').replace(new RegExp(`^${NAME_PREFIX}[^|]*\\|?`), '');
      window.name = `${NAME_PREFIX}${sessionId}${rest ? `|${rest}` : ''}`;
    }
  } catch { /* some pages lock window.name */ }

  // Hide the marker: an app router must never see a fragment it does not understand.
  try {
    if (fromHash()) {
      const cleaned = (location.hash || '')
        .replace(new RegExp(`(?:^#|&)${SESSION_MARKER}=[^&]*`), '')
        .replace(/^&/, '#');
      history.replaceState(history.state, '', location.pathname + location.search + (cleaned === '#' ? '' : cleaned));
    }
  } catch { /* ignore */ }

  const prefix = `${sessionId}${NAMESPACE_SEPARATOR}`;

  // --- namespaced storage ----------------------------------------------------
  const wrap = (real: Storage): Storage => {
    const ownKeys = (): string[] => {
      const out: string[] = [];
      for (let i = 0; i < real.length; i++) {
        const raw = real.key(i);
        if (raw && raw.startsWith(prefix)) out.push(raw.slice(prefix.length));
      }
      return out;
    };

    const api: Record<string, unknown> = {
      getItem: (k: string) => real.getItem(prefix + k),
      setItem: (k: string, v: unknown) => real.setItem(prefix + k, String(v)),
      removeItem: (k: string) => real.removeItem(prefix + k),
      key: (i: number) => ownKeys()[i] ?? null,
      clear: () => { for (const k of ownKeys()) real.removeItem(prefix + k); },
    };

    // configurable:true is REQUIRED, not cosmetic. defineProperty defaults it to
    // false, and a Proxy's ownKeys trap must then report every non-configurable own
    // key of its target — 'length' would be missing and Object.keys(localStorage)
    // would throw a TypeError. That failure is silent in apps that never enumerate,
    // and it once made a spike assertion pass without observing anything.
    Object.defineProperty(api, 'length', { configurable: true, get: () => ownKeys().length });

    return new Proxy(api, {
      get: (t, p) => {
        if (p in t) {
          const v = (t as Record<string | symbol, unknown>)[p];
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
        }
        return real.getItem(prefix + String(p));
      },
      set: (_t, p, v) => {
        if (p === LENGTH_PROP) return true;
        real.setItem(prefix + String(p), String(v));
        return true;
      },
      has: (_t, p) => real.getItem(prefix + String(p)) !== null,
      deleteProperty: (_t, p) => { real.removeItem(prefix + String(p)); return true; },
      ownKeys: () => [...ownKeys(), LENGTH_PROP],
      getOwnPropertyDescriptor: (_t, p) => (p === LENGTH_PROP
        ? { value: ownKeys().length, writable: false, enumerable: false, configurable: true }
        : (() => {
          const v = real.getItem(prefix + String(p));
          return v === null ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
        })()),
      // BOUNDARY CAST, and the only kind this project allows: a Proxy cannot be typed
      // as Storage because `Storage` is an interface with an index signature the Proxy
      // target does not literally declare. Every trap above implements the real
      // contract — getItem/setItem/removeItem/key/clear/length — so the shape is
      // honoured even though the type system cannot see it.
    }) as unknown as Storage;
  };

  // Captured BEFORE wrapping: after the defineProperty below, `window.localStorage`
  // is the proxy and the real object is only reachable through these references.
  const realLocal = window.localStorage;
  const realSession = window.sessionStorage;

  let shimmedLocal = false;
  try {
    const proxy = wrap(realLocal);
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => proxy });
    shimmedLocal = true;
  } catch { /* storage unavailable: report no coverage rather than pretend */ }

  // sessionStorage is already per-tab, but it is namespaced too so a RESTORED
  // session can be given back its session-area values in a brand-new tab.
  try {
    const proxy = wrap(realSession);
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => proxy });
  } catch { /* ignore */ }

  // --- close the cross-tab sync channels -------------------------------------
  // Cookies and storage can both be isolated and an app will still re-sync its
  // login across tabs through any of these.
  try {
    window.addEventListener('storage', (e) => {
      if (e.key && !e.key.startsWith(prefix)) e.stopImmediatePropagation();
    }, true);
  } catch { /* ignore */ }

  let usesIndexedDb = false;
  try {
    const realOpen = indexedDB.open.bind(indexedDB);
    // Only OBSERVED, not namespaced yet: the badge must report IndexedDB as leaking
    // on an origin that uses it rather than quietly implying coverage.
    indexedDB.open = function patched(name: string, version?: number) {
      usesIndexedDb = true;
      return version === undefined ? realOpen(name) : realOpen(name, version);
    } as typeof indexedDB.open;
  } catch { /* ignore */ }

  try {
    const RealBC = window.BroadcastChannel;
    if (typeof RealBC === 'function') {
      const Wrapped = function (this: unknown, name: string) { return new RealBC(prefix + name); };
      Wrapped.prototype = RealBC.prototype;
      // BOUNDARY CAST: a plain function standing in for a class constructor. It
      // delegates to the real BroadcastChannel and inherits its prototype, so instances
      // are genuine BroadcastChannels; only the constructor's own type differs.
      window.BroadcastChannel = Wrapped as unknown as typeof BroadcastChannel;
    }
  } catch { /* ignore */ }

  // A SharedWorker is shared across same-origin tabs and re-syncs state behind every
  // other guard. Removing it makes an app fall back to a per-tab dedicated worker.
  // Blunt, and tracked as a task to make opt-in per origin.
  try { delete (window as { SharedWorker?: unknown }).SharedWorker; } catch { /* ignore */ }

  let hasServiceWorker = false;
  try {
    hasServiceWorker = Boolean(navigator.serviceWorker?.controller);
  } catch { /* ignore */ }

  // --- expose a narrow handle for the extension ------------------------------
  //
  // capture/restore MUST go through this, not through `window.localStorage`.
  //
  // The bug this exists to prevent, found by testing "use here": once the shim is
  // installed, `window.localStorage` IS the proxy — its `key(i)` already returns the
  // un-prefixed key. So a capture that iterates it looking for the prefix finds
  // NOTHING, and a restore that writes `prefix + key` through it produces
  // `prefix + prefix + key`. Both failures were invisible because localStorage
  // persists per origin, so a restored tab kept finding its old data regardless.
  //
  // These helpers close over the REAL storage objects captured before wrapping, so
  // they see the true namespaced keys.
  const dump = (real: Storage): Record<string, string> => {
    const out: Record<string, string> = {};
    try {
      for (let i = 0; i < real.length; i++) {
        const raw = real.key(i);
        if (raw && raw.startsWith(prefix)) out[raw.slice(prefix.length)] = real.getItem(raw) ?? '';
      }
    } catch { /* storage blocked */ }
    return out;
  };
  const load = (real: Storage, slice: Record<string, string>): void => {
    try {
      for (const [k, v] of Object.entries(slice)) real.setItem(prefix + k, v);
    } catch { /* storage blocked */ }
  };

  try {
    Object.defineProperty(window, '__tabsonaSession', {
      configurable: true,
      get: () => ({
        id: sessionId,
        shimmedLocal,
        usesIndexedDb,
        hasServiceWorker,
        dumpLocal: () => dump(realLocal),
        dumpSession: () => dump(realSession),
        loadLocal: (slice: Record<string, string>) => load(realLocal, slice),
        loadSession: (slice: Record<string, string>) => load(realSession, slice),
      }),
    });
  } catch { /* ignore */ }

  // Tell the background what was actually achieved here. This message is the ONLY
  // evidence the badge accepts for claiming localStorage coverage, which is why it
  // reports facts rather than intentions.
  try {
    window.postMessage({ __tabsonaReady: { origin: location.origin, shimmedLocal, usesIndexedDb, hasServiceWorker } }, location.origin);
  } catch { /* ignore */ }
})();
