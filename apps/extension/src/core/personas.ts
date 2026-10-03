// Pure persona + session logic. Imports the domain model and constants only — no
// chrome.*, no storage — so every rule here is unit-tested in Node with zero mocks.

import { PERSONA_COLORS, PERSONA_ID_PREFIX, SESSION_ID_PREFIX, TAB_GROUP_COLORS } from './constants';
import { sessionStateOf, storageKeyNames } from './sessionState';
import type {
  Persona, PersonaId, PersonaView, Session, SessionId, SessionView, Site, TabBindings,
} from '@/domain/types';

/** Deterministic given its random source, so tests never stub Math.random. */
export function makeId(prefix: string, random: () => number = Math.random): string {
  return `${prefix}${random().toString(36).slice(2, 9)}`;
}
/** Id factories. The random source is injectable so tests are deterministic without
 *  stubbing globals. */
export const makePersonaId = (r?: () => number) => makeId(PERSONA_ID_PREFIX, r);
export const makeSessionId = (r?: () => number) => makeId(SESSION_ID_PREFIX, r);

/** Cycle accents so two personas created in a row never look alike. */
export function pickColor(existingCount: number): string {
  return PERSONA_COLORS[existingCount % PERSONA_COLORS.length] ?? PERSONA_COLORS[0];
}

/** Chrome's tab-group palette is a fixed set of names, so the persona's hex accent is
 *  mapped by position rather than matched by hue — same index, same slot, always. */
export function tabGroupColorFor(color: string): (typeof TAB_GROUP_COLORS)[number] {
  const index = PERSONA_COLORS.indexOf(color as (typeof PERSONA_COLORS)[number]);
  return TAB_GROUP_COLORS[index === -1 ? 0 : index] ?? 'blue';
}

export function createPersona(params: {
  name: string;
  description?: string;
  existingCount: number;
  now?: number;
  random?: () => number;
}): Persona {
  const now = params.now ?? Date.now();
  return {
    id: makePersonaId(params.random),
    name: params.name.trim() || 'Untitled persona',
    description: params.description?.trim() ?? '',
    color: pickColor(params.existingCount),
    createdAt: now,
    lastUsedAt: now,
  };
}

/**
 * Canonicalise a URL to the site key a session is filed under.
 *
 * Origin, not registrable domain: it is how the browser partitions storage, which is
 * the thing actually being isolated. Returns null for anything that is not an http(s)
 * page, so chrome:// and about: can never become a session.
 */
export function siteOf(url: string): Site | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

export function createSession(params: {
  personaId: PersonaId;
  site: Site;
  label?: string;
  now?: number;
  random?: () => number;
}): Session {
  const now = params.now ?? Date.now();
  let host = params.site;
  try { host = new URL(params.site).hostname; } catch { /* already a host */ }
  return {
    id: makeSessionId(params.random),
    personaId: params.personaId,
    site: params.site,
    label: params.label?.trim() || host,
    domains: [host],
    cookies: [],
    storage: {},
    engine: 'cookie+storage',
    bearerToken: null,
    savedAt: now,
    lastUsedAt: now,
  };
}

/**
 * The session a persona holds for a site, if any.
 *
 * `(personaId, site)` is unique by design — a persona is one coherent identity across
 * a stack — which is what makes "open this persona" unambiguous.
 */
export function sessionForSite(
  sessions: readonly Session[],
  personaId: PersonaId,
  site: Site,
): Session | undefined {
  return sessions.find((s) => s.personaId === personaId && s.site === site);
}

/**
 * Name a persona that will hold a second (or third) login for a site.
 *
 * Two logins for one site means two personas — that is the model, and it is what keeps
 * "open this persona" unambiguous. But the user is standing at a session row thinking
 * "another login for THIS site", so the name should be obvious rather than demanded:
 * `sync.localhost`, then `sync.localhost 2`, then `sync.localhost 3`.
 *
 * Counts personas that already hold the site, not personas whose NAME matches, so a
 * renamed persona still contributes to the numbering.
 */
export function nameForAnotherLogin(
  site: Site,
  personas: readonly Persona[],
  sessions: readonly Session[],
): string {
  let host = site;
  try { host = new URL(site).hostname; } catch { /* already a host */ }

  const holders = new Set(sessions.filter((s) => s.site === site).map((s) => s.personaId));
  const taken = new Set(personas.map((p) => p.name));

  // Start at the count already holding it, so the first sibling is "…2".
  let n = Math.max(2, holders.size + 1);
  while (taken.has(`${host} ${n}`)) n += 1;
  return `${host} ${n}`;
}

/** Deep copy, including every session, under a new persona. JSON round-trip rather
 *  than structuredClone because the result must also be persistable, and this proves
 *  it is. */
export function duplicatePersona(
  source: Persona,
  sessions: readonly Session[],
  params: { name?: string; existingCount: number; now?: number; random?: () => number },
): { persona: Persona; sessions: Session[] } {
  const now = params.now ?? Date.now();
  const persona: Persona = {
    id: makePersonaId(params.random),
    name: params.name?.trim() || `${source.name} copy`,
    description: source.description,
    color: pickColor(params.existingCount),
    createdAt: now,
    lastUsedAt: now,
  };
  const copies = sessions
    .filter((s) => s.personaId === source.id)
    .map((s): Session => ({
      ...(JSON.parse(JSON.stringify(s)) as Session),
      id: makeSessionId(() => Math.random()),
      personaId: persona.id,
      savedAt: now,
      lastUsedAt: now,
    }));
  return { persona, sessions: copies };
}

/** Project one session for the UI. Never carries cookie or token VALUES. */
export function toSessionView(
  session: Session,
  bindings: TabBindings,
  now: number = Date.now(),
): SessionView {
  const storageKeys = storageKeyNames(session);
  const expiries = session.cookies
    .map((c) => c.expiresAt)
    .filter((e): e is number => e !== null);
  return {
    id: session.id,
    personaId: session.personaId,
    site: session.site,
    label: session.label,
    state: sessionStateOf(session, now),
    cookieCount: session.cookies.length,
    storageKeyCount: storageKeys.length,
    domains: session.domains,
    openTabCount: Object.values(bindings).filter((id) => id === session.id).length,
    savedAt: session.savedAt,
    lastUsedAt: session.lastUsedAt,
    cookieNames: [...new Set(session.cookies.map((c) => c.name))].sort(),
    storageKeys,
    expiresAt: expiries.length > 0 ? Math.min(...expiries) : null,
  };
}

/** Project the whole library, newest-used persona first — it is a working set, not
 *  an archive. Sessions inside a persona sort by site so the list is stable. */
export function toPersonaViews(
  personas: readonly Persona[],
  sessions: readonly Session[],
  bindings: TabBindings,
  now: number = Date.now(),
): PersonaView[] {
  return [...personas]
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .map((p) => {
      const views = sessions
        .filter((s) => s.personaId === p.id)
        .sort((a, b) => a.site.localeCompare(b.site))
        .map((s) => toSessionView(s, bindings, now));
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        color: p.color,
        sessions: views,
        openTabCount: views.reduce((n, v) => n + v.openTabCount, 0),
        lastUsedAt: p.lastUsedAt,
      };
    });
}

/**
 * Filter the library by a query, keeping a persona when it matches OR when any of its
 * sessions do — searching for a site must not hide the persona that holds it.
 */
export function filterPersonas(
  views: readonly PersonaView[],
  query: string,
): PersonaView[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...views];
  const matchesSession = (s: SessionView) =>
    s.site.toLowerCase().includes(q)
    || s.label.toLowerCase().includes(q)
    || s.domains.some((d) => d.toLowerCase().includes(q));
  const matchesPersona = (p: PersonaView) =>
    p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
  return views
    .map((p) => (matchesPersona(p) ? p : { ...p, sessions: p.sessions.filter(matchesSession) }))
    .filter((p) => matchesPersona(p) || p.sessions.length > 0);
}

/** Flatten for keyboard navigation: personas and their visible sessions in render
 *  order, so ↑/↓ moves through exactly what the eye sees. */
export function flattenForKeyboard(
  views: readonly PersonaView[],
  expanded: ReadonlySet<PersonaId>,
): Array<{ kind: 'persona'; id: PersonaId } | { kind: 'session'; id: SessionId; personaId: PersonaId }> {
  const out: Array<{ kind: 'persona'; id: PersonaId } | { kind: 'session'; id: SessionId; personaId: PersonaId }> = [];
  for (const p of views) {
    out.push({ kind: 'persona', id: p.id });
    if (expanded.has(p.id)) {
      for (const s of p.sessions) out.push({ kind: 'session', id: s.id, personaId: p.id });
    }
  }
  return out;
}
