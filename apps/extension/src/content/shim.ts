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

import {
  COOKIE_BARRIER_RECENT_MS, COOKIE_BARRIER_TIMEOUT_MS, COOKIE_MIRROR_KEY_PREFIX, MSG_COOKIE_ACK,
  MSG_COOKIE_SETTLE, MSG_COOKIE_WRITE, NAMESPACE_SEPARATOR, SESSION_MARKER,
} from '@/core/constants';
import { applyCookies, pageCookieString, parseDocumentCookie } from '@/core/cookies';
import type { CookieRecord } from '@/domain/types';
import { installIdbNamespace } from '@/core/idb';

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

  // --- document.cookie: the SESSION's cookies, not the browser's ------------------------
  //
  // Without this, a write goes to the browser's shared jar (visible to every plain tab,
  // never sent from this tab because its Cookie header is rebuilt from the session) and a
  // read returns the shared jar. A provider that writes a test cookie from script and
  // expects it back ("Cookies are disabled") then fails inside every persona.
  //
  // The page keeps its own copy of the session's page-visible cookies, mirrored in the
  // REAL localStorage under a key outside this session's namespace (so the app never sees
  // it) because a read is synchronous and the worker cannot answer in time. A write also
  // goes to the worker, which stores it in the session and installs the rule.
  const mirrorKey = `${COOKIE_MIRROR_KEY_PREFIX}${sessionId}`;
  let jar: CookieRecord[] = [];
  try {
    const raw = realLocal.getItem(mirrorKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) jar = parsed as CookieRecord[]; // BOUNDARY: our own JSON, written below
  } catch { /* unreadable mirror: start empty, the worker repopulates it */ }
  const saveMirror = (): void => {
    try { realLocal.setItem(mirrorKey, JSON.stringify(jar)); } catch { /* blocked */ }
  };

  /** Acknowledgements still awaited, by id. A request waits for all of them. */
  const waiting = new Map<number, () => void>();
  let nextId = 1;
  const askWorker = (kind: string, payload: Record<string, unknown>): Promise<void> => new Promise((resolve) => {
    const id = nextId++;
    const done = () => { waiting.delete(id); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, COOKIE_BARRIER_TIMEOUT_MS);
    waiting.set(id, done);
    try { window.postMessage({ [kind]: { id, ...payload } }, location.origin); } catch { done(); }
  });
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const ack = (e.data as { [MSG_COOKIE_ACK]?: { id?: unknown } } | null)?.[MSG_COOKIE_ACK];
    if (typeof ack?.id === 'number') waiting.get(ack.id)?.();
  });

  const writes = new Set<Promise<void>>();
  let lastResponseAt = 0;
  let settling: Promise<void> | null = null;
  /** What a request must wait for before it leaves, or null to send at once. Only fetch
   *  and asynchronous XHR can be held (they are ours to delay); a navigation and a
   *  synchronous XHR cannot, and a redirect's follow-up is issued by the network stack with
   *  no step of ours in between (docs/limits.md). */
  const barrier = (): Promise<void> | null => {
    if (writes.size > 0) return Promise.all([...writes]).then(() => undefined);
    if (Date.now() - lastResponseAt >= COOKIE_BARRIER_RECENT_MS) return null;
    settling ??= askWorker(MSG_COOKIE_SETTLE, {}).finally(() => { settling = null; });
    return settling;
  };

  try {
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    if (desc?.configurable) {
      Object.defineProperty(Document.prototype, 'cookie', {
        configurable: true,
        enumerable: desc.enumerable ?? true,
        get(this: Document) { return pageCookieString(jar, location.href); },
        set(this: Document, line: string) {
          const text = String(line);
          const record = parseDocumentCookie(text, location.href);
          if (!record) return;
          jar = applyCookies(jar, [record]);
          saveMirror();
          const pending = askWorker(MSG_COOKIE_WRITE, { url: location.href, line: text });
          writes.add(pending);
          void pending.finally(() => writes.delete(pending));
        },
      });
    }
  } catch { /* locked down: report nothing rather than pretend */ }

  // Hold a request back until the cookie the page just wrote, or the response it just
  // received set, is in force. Sync XHR cannot wait and goes out as it is; a navigation
  // cannot be held and is listed in docs/limits.md.
  try {
    const realFetch = window.fetch;
    window.fetch = function fetchAfterCookies(this: unknown, ...args: Parameters<typeof fetch>) {
      const hold = barrier();
      const sent = hold ? hold.then(() => realFetch.apply(window, args)) : realFetch.apply(window, args);
      const noteDone = () => { lastResponseAt = Date.now(); };
      sent.then(noteDone, noteDone);
      return sent;
    };
  } catch { /* ignore */ }
  try {
    const proto = XMLHttpRequest.prototype;
    const realOpen = proto.open;
    const realSend = proto.send;
    const asyncFlag = new WeakMap<XMLHttpRequest, boolean>();
    proto.open = function open(this: XMLHttpRequest, ...args: unknown[]) {
      asyncFlag.set(this, args[2] !== false);
      return (realOpen as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.open;
    proto.send = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      this.addEventListener('loadend', () => { lastResponseAt = Date.now(); }, { once: true });
      const hold = asyncFlag.get(this) === false ? null : barrier();
      if (hold) { void hold.then(() => realSend.call(this, body)); return; }
      realSend.call(this, body);
    };
  } catch { /* ignore */ }

  // --- close the cross-tab sync channels -------------------------------------
  // Cookies and storage can both be isolated and an app will still re-sync its
  // login across tabs through any of these.
  try {
    window.addEventListener('storage', (e) => {
      if (e.key && !e.key.startsWith(prefix)) e.stopImmediatePropagation();
    }, true);
  } catch { /* ignore */ }

  // --- IndexedDB: one set of databases per session --------------------------
  //
  // Database NAMES are translated (`app-db` → `<session>::app-db`) on the real
  // prototypes, so every reference to indexedDB in this page is covered; what happens
  // inside an open database is untouched. The installer is pure and unit-tested in
  // core/idb.ts — this only hands it the page's prototypes. See docsi/SPEC_INDEXEDDB.md.
  let usesIndexedDb = false;
  let idbNamespaced = false;
  try {
    idbNamespaced = installIdbNamespace(IDBFactory.prototype, IDBDatabase.prototype, sessionId).installed;
    // Observe use on top of the translation, so the report says whether the layer
    // mattered on this page at all.
    const translatedOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function open(this: IDBFactory, name: string, version?: number) {
      usesIndexedDb = true;
      return version === undefined ? translatedOpen.call(this, name) : translatedOpen.call(this, name, version);
    };
  } catch { /* indexedDB unavailable: report not namespaced rather than pretend */ }

  // A dedicated Worker has its OWN indexedDB, which this script never runs in, so the
  // badge must know when a page starts one. Observed, never blocked: blocking would
  // break the app to hide a gap this project's rule is to surface.
  let usesWorker = false;
  try {
    const RealWorker = window.Worker;
    if (typeof RealWorker === 'function') {
      const Observed = function (this: unknown, url: string | URL, options?: WorkerOptions) {
        usesWorker = true;
        return new RealWorker(url, options);
      };
      Observed.prototype = RealWorker.prototype;
      // BOUNDARY CAST: a plain function standing in for a class constructor. It
      // delegates to the real Worker and shares its prototype, so instances are genuine
      // Workers; only the constructor's own type differs.
      window.Worker = Observed as unknown as typeof Worker;
    }
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
        idbNamespaced,
        usesWorker,
        hasServiceWorker,
        dumpLocal: () => dump(realLocal),
        dumpSession: () => dump(realSession),
        loadLocal: (slice: Record<string, string>) => load(realLocal, slice),
        loadSession: (slice: Record<string, string>) => load(realSession, slice),
        /** Replace the page-visible cookies with the session's own (the worker's copy
         *  wins: it is the one the rules are built from). */
        setCookies: (list: CookieRecord[]) => {
          if (!Array.isArray(list)) return false;
          jar = list;
          saveMirror();
          return true;
        },
      }),
    });
  } catch { /* ignore */ }

  // Tell the background what was actually achieved here. This message is the ONLY
  // evidence the badge accepts for claiming localStorage coverage, which is why it
  // reports facts rather than intentions.
  try {
    window.postMessage({
      __tabsonaReady: { origin: location.origin, shimmedLocal, usesIndexedDb, idbNamespaced, usesWorker, hasServiceWorker },
    }, location.origin);
  } catch { /* ignore */ }
})();
