// The ONLY module that touches chrome.storage, plus the lock every mutation runs
// under. Isolating both here means the pure core never learns about persistence, and
// there is exactly one place a lost update could be introduced.

import { normalizeSettings } from '@/core/settings';
import {
  type Settings, type SettingKey,
} from '@/domain/messages';
import {
  SCHEMA_VERSION, STORAGE_KEY_BINDINGS, STORAGE_KEY_PERSONAS,
  STORAGE_KEY_SCHEMA, STORAGE_KEY_SESSIONS, STORAGE_KEY_SETTINGS, STORAGE_KEY_BADGE_PLACEMENTS,
  STORAGE_KEY_SIGNIN_CHAINS, STORAGE_KEY_FORM_HINTS, STORAGE_KEY_GATE_PENDING, STORAGE_KEY_LAST_PAGES, STORAGE_KEY_LEAK_WINDOWS,
} from '@/core/constants';
import { withHop, type SignInHops } from '@/core/signin';
import { hintExplainsStop } from '@/core/gate';
import type { FormHint, FormHints, GatePending, GatePendings, LeakWindows } from '@/core/gate';
import { normalizePlacements, type BadgePlacement, type BadgePlacements } from '@/core/placement';
import { createPersona, createSession, siteOf } from '@/core/personas';
import type { Origin, Persona, Session, SessionId, TabBindings, TabId } from '@/domain/types';

/**
 * Serialize every read-modify-write.
 *
 * MV3 fires handlers concurrently, and two that each read-then-write the session map
 * will silently lose one write. The symptom is a session that randomly forgets a
 * cookie — indistinguishable from the flakiness this project exists to avoid.
 */
let queue: Promise<unknown> = Promise.resolve();
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run as Promise<T>;
}

export interface Library {
  personas: Persona[];
  sessions: Session[];
}

/**
 * Normalise a persona read from storage.
 *
 * A record written by an EARLIER build has no `description`, and the UI treats that
 * field as a string — `filterPersonas` lowercases it on every keystroke. Defaulting on
 * the way in means one place to fix instead of a guard at every read, and it covers
 * imported files too, which can be arbitrarily old.
 *
 * This is the same shape of bug as the v1 migration: a field only old data lacks.
 */
function normalisePersona(raw: Persona): Persona {
  return { ...raw, description: raw.description ?? '' };
}

export async function loadLibrary(): Promise<Library> {
  const got = await chrome.storage.local.get([STORAGE_KEY_PERSONAS, STORAGE_KEY_SESSIONS]);
  const personas = (got[STORAGE_KEY_PERSONAS] as Persona[] | undefined) ?? [];
  return {
    personas: personas.map(normalisePersona),
    sessions: (got[STORAGE_KEY_SESSIONS] as Session[] | undefined) ?? [],
  };
}

export async function saveLibrary(lib: Library): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY_PERSONAS]: lib.personas,
    [STORAGE_KEY_SESSIONS]: lib.sessions,
  });
}

/** Read-modify-write the whole library under the lock. */
export function mutateLibrary<T>(fn: (lib: Library) => Promise<T> | T): Promise<T> {
  return withLock(async () => {
    const lib = await loadLibrary();
    const result = await fn(lib);
    await saveLibrary(lib);
    return result;
  });
}

/** Mutate one session in place. Returns false if it has gone. */
export function mutateSession(
  sessionId: SessionId,
  fn: (session: Session) => void,
): Promise<boolean> {
  return mutateLibrary((lib) => {
    const session = lib.sessions.find((s) => s.id === sessionId);
    if (!session) return false;
    fn(session);
    return true;
  });
}

/**
 * Tab bindings are NOT durable — a tab id is meaningless after a restart — but they
 * must survive a service-worker teardown, which happens whenever Chrome likes.
 * `chrome.storage.session` is exactly that lifetime.
 */
export async function loadBindings(): Promise<TabBindings> {
  const got = await chrome.storage.session.get(STORAGE_KEY_BINDINGS);
  return (got[STORAGE_KEY_BINDINGS] as TabBindings | undefined) ?? {};
}

export async function saveBindings(bindings: TabBindings): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEY_BINDINGS]: bindings });
}

/** Sign-in hosts seen per site, kept across browser runs. See core/signin.ts. */
export async function loadSignInHops(): Promise<SignInHops> {
  const got = await chrome.storage.local.get(STORAGE_KEY_SIGNIN_CHAINS);
  return (got[STORAGE_KEY_SIGNIN_CHAINS] as SignInHops | undefined) ?? {};
}

/** Record that `site` sent a persona tab to `target`. Under the lock, so two redirects
 *  landing together cannot drop one. Returns whether anything new was recorded, so the
 *  caller redraws the badge only when there is something new to say. */
export async function noteSignInHop(site: Origin, target: Origin): Promise<boolean> {
  return withLock(async () => {
    const before = await loadSignInHops();
    const after = withHop(before, site, target);
    if (after === before) return false;
    await chrome.storage.local.set({ [STORAGE_KEY_SIGNIN_CHAINS]: after });
    return true;
  });
}

/** Navigations the gate stopped, by tab id. See core/gate.ts. */
export async function loadGatePending(): Promise<GatePendings> {
  const got = await chrome.storage.session.get(STORAGE_KEY_GATE_PENDING);
  return (got[STORAGE_KEY_GATE_PENDING] as GatePendings | undefined) ?? {};
}

/** Record (pending) or clear (null) the navigation the gate stopped in `tabId`. */
export async function setGatePending(tabId: TabId, pending: GatePending | null): Promise<void> {
  await withLock(async () => {
    const next: Record<string, GatePending> = { ...(await loadGatePending()) };
    if (pending) next[String(tabId)] = pending; else delete next[String(tabId)];
    await chrome.storage.session.set({ [STORAGE_KEY_GATE_PENDING]: next });
  });
}

/**
 * Record a stopped navigation, and decide ATOMICALLY whether it was a form POST.
 *
 * The form notice (from the page) and the stop (from the network) arrive in either order.
 * Each used to read the other's record and then write its own in separate steps, so both
 * could read "nothing there" before either wrote, and the POST was resumed as a GET. Both
 * halves now run inside one lock: the later arrival always sees the earlier one.
 */
export async function recordStop(tabId: TabId, base: Omit<GatePending, 'viaForm'>): Promise<GatePending> {
  return withLock(async () => {
    const hints: Record<string, FormHint> = { ...(await loadFormHints()) };
    const viaForm = hintExplainsStop(hints[String(tabId)], base.url, base.at);
    const pending: GatePending = viaForm ? { ...base, viaForm } : base;
    const all: Record<string, GatePending> = { ...(await loadGatePending()), [String(tabId)]: pending };
    delete hints[String(tabId)];
    await chrome.storage.session.set({ [STORAGE_KEY_GATE_PENDING]: all, [STORAGE_KEY_FORM_HINTS]: hints });
    return pending;
  });
}

/** Record a form POST the page just submitted; when its stop was already recorded, mark
 *  that stop as the POST instead of keeping a hint nobody will read. See `recordStop`. */
export async function recordFormHint(tabId: TabId, hint: FormHint): Promise<void> {
  await withLock(async () => {
    const pendings: Record<string, GatePending> = { ...(await loadGatePending()) };
    const stopped = pendings[String(tabId)];
    if (stopped && !stopped.viaForm && hintExplainsStop(hint, stopped.url, hint.at)) {
      pendings[String(tabId)] = { ...stopped, viaForm: true };
      await chrome.storage.session.set({ [STORAGE_KEY_GATE_PENDING]: pendings });
      return;
    }
    const hints: Record<string, FormHint> = { ...(await loadFormHints()), [String(tabId)]: hint };
    await chrome.storage.session.set({ [STORAGE_KEY_FORM_HINTS]: hints });
  });
}

/** The last form POST each bound tab submitted, by tab id. See core/gate.ts, `FormHint`. */
export async function loadFormHints(): Promise<FormHints> {
  const got = await chrome.storage.session.get(STORAGE_KEY_FORM_HINTS);
  return (got[STORAGE_KEY_FORM_HINTS] as FormHints | undefined) ?? {};
}

/** Record (hint) or clear (null) the form POST `tabId` just submitted. */
export async function setFormHint(tabId: TabId, hint: FormHint | null): Promise<void> {
  await withLock(async () => {
    const next: Record<string, FormHint> = { ...(await loadFormHints()) };
    if (hint) next[String(tabId)] = hint; else delete next[String(tabId)];
    await chrome.storage.session.set({ [STORAGE_KEY_FORM_HINTS]: next });
  });
}

/** The last http(s) page each bound tab committed, by tab id. */
export async function loadLastPages(): Promise<Readonly<Record<string, string>>> {
  const got = await chrome.storage.session.get(STORAGE_KEY_LAST_PAGES);
  return (got[STORAGE_KEY_LAST_PAGES] as Record<string, string> | undefined) ?? {};
}

/** Remember (url) or forget (null) the page `tabId` is on. */
export async function setLastPage(tabId: TabId, url: string | null): Promise<void> {
  await withLock(async () => {
    const next: Record<string, string> = { ...(await loadLastPages()) };
    if (url) next[String(tabId)] = url; else delete next[String(tabId)];
    await chrome.storage.session.set({ [STORAGE_KEY_LAST_PAGES]: next });
  });
}

/** Open leak windows by tab id. See core/gate.ts. */
export async function loadLeakWindows(): Promise<LeakWindows> {
  const got = await chrome.storage.session.get(STORAGE_KEY_LEAK_WINDOWS);
  return (got[STORAGE_KEY_LEAK_WINDOWS] as LeakWindows | undefined) ?? {};
}

/** Read-modify-write the leak windows under the lock. */
export async function updateLeakWindows(fn: (windows: LeakWindows) => LeakWindows): Promise<void> {
  await withLock(async () => {
    const next = fn(await loadLeakWindows());
    await chrome.storage.session.set({ [STORAGE_KEY_LEAK_WINDOWS]: next });
  });
}

/** Settings with every field validated — see core/settings.ts for why per field. */
export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
  return normalizeSettings(got[STORAGE_KEY_SETTINGS]);
}

/** Change settings under the lock, so two quick toggles cannot lose one write. The merged
 *  result is validated like a read, so an out-of-range or unknown value is never stored. */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await withLock(async () => {
    const next: Settings = normalizeSettings({ ...(await loadSettings()), ...patch });
    await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: next });
  });
}

/** Flip one on/off setting. Goes through updateSettings, so it shares its lock. */
export async function setSetting(key: SettingKey, value: boolean): Promise<void> {
  await updateSettings({ [key]: value });
}

/** Dragged badge positions by site, validated entry by entry. */
export async function loadBadgePlacements(): Promise<BadgePlacements> {
  const got = await chrome.storage.local.get(STORAGE_KEY_BADGE_PLACEMENTS);
  return normalizePlacements(got[STORAGE_KEY_BADGE_PLACEMENTS]);
}

/** Remember (placement) or forget (null) where the badge sits on one site. */
export async function setBadgePlacement(origin: string, placement: BadgePlacement | null): Promise<void> {
  await withLock(async () => {
    const next: Record<string, BadgePlacement> = { ...(await loadBadgePlacements()) };
    if (placement) next[origin] = placement; else delete next[origin];
    await chrome.storage.local.set({ [STORAGE_KEY_BADGE_PLACEMENTS]: next });
  });
}

/** Forget every dragged position, so every site falls back to the Settings corner. */
export async function clearBadgePlacements(): Promise<void> {
  await withLock(async () => { await chrome.storage.local.remove(STORAGE_KEY_BADGE_PLACEMENTS); });
}

/**
 * Migrate v1 data (a flat map of named sessions) into v2 (personas holding sessions).
 *
 * Each old session becomes a persona of the same name holding one session. Done once,
 * guarded by a schema marker, and reported rather than silent: a user who finds their
 * list reshaped with no explanation has lost trust in a tool that holds credentials.
 *
 * Returns how many personas were created, so the caller can say so.
 */
export async function migrateFromV1(): Promise<number> {
  return withLock(async () => {
    const got = await chrome.storage.local.get([STORAGE_KEY_SCHEMA, STORAGE_KEY_SESSIONS]);
    if ((got[STORAGE_KEY_SCHEMA] as number | undefined) === SCHEMA_VERSION) return 0;

    const raw = got[STORAGE_KEY_SESSIONS];
    // v1 stored a Record<id, {name, cookies, storage, ...}>; v2 stores an array.
    const isV1 = raw !== undefined && !Array.isArray(raw);
    if (!isV1) {
      await chrome.storage.local.set({ [STORAGE_KEY_SCHEMA]: SCHEMA_VERSION });
      return 0;
    }

    // NOT a dynamic import. Vite wraps `await import()` in a preload helper that calls
    // `window.dispatchEvent` on error — and a service worker has no `window`, so the
    // whole boot died with "ReferenceError: window is not defined" the moment there was
    // actually v1 data to migrate. A fresh profile never reaches this branch, which is
    // why every automated run missed it and a real upgrade did not.
    const personas: Persona[] = [];
    const sessions: Session[] = [];
    const old = Object.values(raw as Record<string, {
      name?: string; cookies?: unknown[]; storage?: Record<string, unknown>; domains?: string[];
    }>);

    for (const entry of old) {
      const persona = createPersona({
        name: entry.name ?? 'Imported',
        description: 'Migrated from v1',
        existingCount: personas.length,
      });
      personas.push(persona);
      // v1 had no site key; recover one from the first captured storage origin, or
      // from the first domain. A session with neither is dropped: it held nothing.
      const origin = Object.keys(entry.storage ?? {})[0]
        ?? (entry.domains?.[0] ? `https://${entry.domains[0]}` : null);
      const site = origin ? siteOf(origin) : null;
      if (!site) continue;
      const session = createSession({ personaId: persona.id, site, label: entry.name ?? site });
      session.cookies = (entry.cookies as Session['cookies']) ?? [];
      session.storage = (entry.storage as Session['storage']) ?? {};
      session.domains = entry.domains ?? session.domains;
      sessions.push(session);
    }

    await chrome.storage.local.set({
      [STORAGE_KEY_PERSONAS]: personas,
      [STORAGE_KEY_SESSIONS]: sessions,
      [STORAGE_KEY_SCHEMA]: SCHEMA_VERSION,
    });
    return personas.length;
  });
}
