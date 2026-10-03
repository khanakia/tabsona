// The ONLY module that touches chrome.storage, plus the lock every mutation runs
// under. Isolating both here means the pure core never learns about persistence, and
// there is exactly one place a lost update could be introduced.

import {
  DEFAULT_SETTINGS, type Settings, type SettingKey,
} from '@/domain/messages';
import {
  SCHEMA_VERSION, STORAGE_KEY_BINDINGS, STORAGE_KEY_PERSONAS,
  STORAGE_KEY_SCHEMA, STORAGE_KEY_SESSIONS, STORAGE_KEY_SETTINGS,
} from '@/core/constants';
import { createPersona, createSession, siteOf } from '@/core/personas';
import type { Persona, Session, SessionId, TabBindings } from '@/domain/types';

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

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(got[STORAGE_KEY_SETTINGS] as Partial<Settings> | undefined) };
}

export async function setSetting(key: SettingKey, value: boolean): Promise<void> {
  await withLock(async () => {
    const next = { ...(await loadSettings()), [key]: value };
    await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: next });
  });
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
