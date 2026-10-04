import { describe, expect, it } from 'vitest';
import {
  createPersona, createSession, duplicatePersona, filterPersonas, nameForAnotherLogin,
  flattenForKeyboard, makePersonaId, pickColor, sessionForSite, siteOf,
  isPaletteColor, paletteEntryFor, tabGroupColorFor, toPersonaViews, toSessionView,
} from '../personas';
import { PERSONA_COLORS, PERSONA_ID_PREFIX, PERSONA_PALETTE } from '../constants';
import type { CookieRecord, Session } from '@/domain/types';

const cookie = (over: Partial<CookieRecord> = {}): CookieRecord => ({
  name: 'sid', value: 'v', domain: 'sync.localhost', hostOnly: true, path: '/',
  expiresAt: null, secure: false, httpOnly: false, sameSite: null, partitionKey: null,
  ...over,
});

describe('siteOf', () => {
  it('canonicalises a url to its origin', () => {
    expect(siteOf('https://sync.localhost/login?a=1#x')).toBe('https://sync.localhost');
  });

  it('keeps the port, because a different port is a different site', () => {
    expect(siteOf('http://localhost:8787/x')).toBe('http://localhost:8787');
  });

  it('refuses anything that cannot hold a login', () => {
    // This is what stops a chrome:// or about: page becoming a session — and it is the
    // same check that keeps a blank new tab out of a persona.
    expect(siteOf('chrome://extensions')).toBeNull();
    expect(siteOf('about:blank')).toBeNull();
    expect(siteOf('not a url')).toBeNull();
  });
});

describe('createPersona', () => {
  it('is prefixed and trims its name', () => {
    const p = createPersona({ name: '  Acme admin  ', existingCount: 0 });
    expect(p.id).toMatch(new RegExp(`^${PERSONA_ID_PREFIX}`));
    expect(p.name).toBe('Acme admin');
  });

  it('falls back when the name is blank', () => {
    expect(createPersona({ name: '   ', existingCount: 0 }).name).toBe('Untitled persona');
  });
});

describe('pickColor', () => {
  it('gives consecutive personas different colours', () => {
    // The badge is the primary safety signal; two personas that look alike defeat it.
    expect(pickColor(0)).not.toBe(pickColor(1));
  });

  it('wraps rather than running out', () => {
    expect(pickColor(PERSONA_COLORS.length)).toBe(pickColor(0));
  });
});

describe('tabGroupColorFor', () => {
  it('maps every palette colour to its own Chrome tab-group colour', () => {
    for (const c of PERSONA_PALETTE) expect(tabGroupColorFor(c.hex)).toBe(c.id);
  });

  it('keeps colours stored by earlier versions on the same tab-group colour', () => {
    // Personas created before the palette stored these hex values; they must not move.
    expect(tabGroupColorFor('#3b82f6')).toBe('blue');
    expect(tabGroupColorFor('#10b981')).toBe('green');
    expect(tabGroupColorFor('#F97316')).toBe('orange');
  });

  it('falls back for a colour it does not know', () => {
    expect(tabGroupColorFor('#123456')).toBe('blue');
  });
});

describe('the persona palette', () => {
  it('has one entry per Chrome tab-group colour, each with its own hex and marker', () => {
    expect(PERSONA_PALETTE).toHaveLength(9);
    for (const key of ['id', 'hex', 'emoji'] as const) {
      expect(new Set(PERSONA_PALETTE.map((c) => c[key])).size).toBe(PERSONA_PALETTE.length);
    }
  });

  it('accepts only palette colours, ignoring case', () => {
    expect(isPaletteColor('#6B7280')).toBe(true);
    expect(isPaletteColor('#123456')).toBe(false);
  });

  it('never cycles new personas onto grey, which reads as disabled', () => {
    expect(PERSONA_COLORS).not.toContain(paletteEntryFor('#6b7280').hex);
  });
});

describe('createSession', () => {
  it('labels itself from the host when no title is given', () => {
    expect(createSession({ personaId: 'p_1', site: 'https://sync.localhost' }).label).toBe('sync.localhost');
  });

  it('seeds its domain set from the site', () => {
    expect(createSession({ personaId: 'p_1', site: 'http://localhost:8787' }).domains).toEqual(['localhost']);
  });

  it('starts empty, so its first tab is forced to sign in', () => {
    const s = createSession({ personaId: 'p_1', site: 'https://a.test' });
    expect(s.cookies).toEqual([]);
    expect(s.storage).toEqual({});
  });
});

describe('sessionForSite', () => {
  it('finds the one session a persona holds for a site', () => {
    const a = createSession({ personaId: 'p_1', site: 'https://a.test' });
    const b = createSession({ personaId: 'p_2', site: 'https://a.test' });
    expect(sessionForSite([a, b], 'p_2', 'https://a.test')?.id).toBe(b.id);
  });

  it('returns undefined when that persona has no session for the site', () => {
    const a = createSession({ personaId: 'p_1', site: 'https://a.test' });
    expect(sessionForSite([a], 'p_1', 'https://b.test')).toBeUndefined();
  });

  it('keeps two personas holding the same site apart', () => {
    // The whole point of personas: two roles on one app live in two personas.
    const a = createSession({ personaId: 'p_1', site: 'https://a.test' });
    const b = createSession({ personaId: 'p_2', site: 'https://a.test' });
    expect(sessionForSite([a, b], 'p_1', 'https://a.test')?.id).not
      .toBe(sessionForSite([a, b], 'p_2', 'https://a.test')?.id);
  });
});

describe('duplicatePersona', () => {
  const build = () => {
    const persona = createPersona({ name: 'Acme', existingCount: 0 });
    const session = createSession({ personaId: persona.id, site: 'https://a.test' });
    session.cookies = [cookie()];
    session.storage = { 'https://a.test': { local: { token: 'abc' } } };
    return { persona, session };
  };

  it('copies every session, logins included', () => {
    const { persona, session } = build();
    const out = duplicatePersona(persona, [session], { existingCount: 1 });
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0]?.cookies).toEqual(session.cookies);
    expect(out.sessions[0]?.storage).toEqual(session.storage);
  });

  it('re-parents the copies and gives them new ids', () => {
    const { persona, session } = build();
    const out = duplicatePersona(persona, [session], { existingCount: 1 });
    expect(out.sessions[0]?.personaId).toBe(out.persona.id);
    expect(out.sessions[0]?.id).not.toBe(session.id);
  });

  it('deep-copies, so the two personas cannot corrupt each other', () => {
    const { persona, session } = build();
    const out = duplicatePersona(persona, [session], { existingCount: 1 });
    const copy = out.sessions[0] as Session;
    copy.cookies[0] = cookie({ value: 'mutated' });
    (copy.storage['https://a.test'] as Record<string, unknown>).local = { token: 'mutated' };
    expect(session.cookies[0]?.value).toBe('v');
    expect(session.storage['https://a.test']?.local).toEqual({ token: 'abc' });
  });

  it('ignores sessions belonging to other personas', () => {
    const { persona, session } = build();
    const other = createSession({ personaId: 'p_other', site: 'https://b.test' });
    expect(duplicatePersona(persona, [session, other], { existingCount: 1 }).sessions).toHaveLength(1);
  });
});

describe('toSessionView', () => {
  it('never exposes cookie or token values', () => {
    const s = createSession({ personaId: 'p_1', site: 'https://a.test' });
    s.cookies = [cookie({ value: 'SECRET' })];
    s.storage = { 'https://a.test': { local: { token: 'ALSO_SECRET' } } };
    const view = toSessionView(s, {});
    const json = JSON.stringify(view);
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('ALSO_SECRET');
    expect(view.cookieNames).toEqual(['sid']);
    expect(view.storageKeys).toEqual(['token']);
  });

  it('counts only the tabs bound to this session', () => {
    const s = createSession({ personaId: 'p_1', site: 'https://a.test' });
    expect(toSessionView(s, { '1': s.id, '2': s.id, '3': 'other' }).openTabCount).toBe(2);
  });

  it('reports the soonest cookie expiry, for the expired explanation', () => {
    const s = createSession({ personaId: 'p_1', site: 'https://a.test' });
    s.cookies = [cookie({ name: 'a', expiresAt: 5000 }), cookie({ name: 'b', expiresAt: 1000 })];
    expect(toSessionView(s, {}, 0).expiresAt).toBe(1000);
  });
});

describe('createPersona descriptions', () => {
  it('starts with an empty description rather than undefined', () => {
    // Personas written by an earlier build lack the field entirely, and the UI
    // lowercases it on every keystroke — so '' is the only safe default.
    expect(createPersona({ name: 'a', existingCount: 0 }).description).toBe('');
  });

  it('trims a supplied description', () => {
    expect(createPersona({ name: 'a', description: '  staging  ', existingCount: 0 }).description)
      .toBe('staging');
  });

  it('carries the description through a duplicate', () => {
    const source = createPersona({ name: 'a', description: 'staging stack', existingCount: 0 });
    expect(duplicatePersona(source, [], { existingCount: 1 }).persona.description)
      .toBe('staging stack');
  });
});

describe('nameForAnotherLogin', () => {
  const site = 'https://sync.localhost';
  const build = (count: number) => {
    const personas = Array.from({ length: count }, (_, i) =>
      createPersona({ name: `p${i}`, existingCount: i, random: () => (i + 1) / 10 }));
    const sessions = personas.map((p) => createSession({ personaId: p.id, site, random: () => Math.random() }));
    return { personas, sessions };
  };

  it('names the first sibling after the host, numbered from 2', () => {
    // The user already has one login for the site; the next is "…2", not "…1".
    const { personas, sessions } = build(1);
    expect(nameForAnotherLogin(site, personas, sessions)).toBe('sync.localhost 2');
  });

  it('counts how many personas already hold the site', () => {
    const { personas, sessions } = build(3);
    expect(nameForAnotherLogin(site, personas, sessions)).toBe('sync.localhost 4');
  });

  it('skips a name a renamed persona already took', () => {
    const { personas, sessions } = build(1);
    const clash = { ...createPersona({ name: 'sync.localhost 2', existingCount: 9 }) };
    expect(nameForAnotherLogin(site, [...personas, clash], sessions)).toBe('sync.localhost 3');
  });

  it('counts personas holding the site, not personas named after it', () => {
    // A persona renamed to "Acme admin" still holds the site, so it still counts.
    const { personas, sessions } = build(2);
    const renamed = personas.map((p) => ({ ...p, name: `Acme ${p.id}` }));
    expect(nameForAnotherLogin(site, renamed, sessions)).toBe('sync.localhost 3');
  });

  it('ignores sessions for other sites', () => {
    const { personas, sessions } = build(1);
    const other = createSession({ personaId: 'p_other', site: 'https://elsewhere.test' });
    expect(nameForAnotherLogin(site, personas, [...sessions, other])).toBe('sync.localhost 2');
  });

  it('starts at 2 even when nothing holds the site yet', () => {
    expect(nameForAnotherLogin(site, [], [])).toBe('sync.localhost 2');
  });

  it('keeps the port, because a different port is a different site', () => {
    expect(nameForAnotherLogin('http://localhost:8787', [], [])).toBe('localhost 2');
  });
});

describe('toPersonaViews', () => {
  it('puts the most recently used persona first', () => {
    const a = { ...createPersona({ name: 'a', existingCount: 0 }), lastUsedAt: 1 };
    const b = { ...createPersona({ name: 'b', existingCount: 1 }), lastUsedAt: 9 };
    expect(toPersonaViews([a, b], [], {}).map((p) => p.name)).toEqual(['b', 'a']);
  });

  it('sorts a persona’s sessions by site, so the list is stable', () => {
    const p = createPersona({ name: 'p', existingCount: 0 });
    const z = createSession({ personaId: p.id, site: 'https://z.test' });
    const a = createSession({ personaId: p.id, site: 'https://a.test' });
    expect(toPersonaViews([p], [z, a], {}).at(0)?.sessions.map((s) => s.site))
      .toEqual(['https://a.test', 'https://z.test']);
  });

  it('sums open tabs across a persona', () => {
    const p = createPersona({ name: 'p', existingCount: 0 });
    const s1 = createSession({ personaId: p.id, site: 'https://a.test' });
    const s2 = createSession({ personaId: p.id, site: 'https://b.test' });
    expect(toPersonaViews([p], [s1, s2], { '1': s1.id, '2': s2.id }).at(0)?.openTabCount).toBe(2);
  });
});

describe('filterPersonas', () => {
  const persona = createPersona({ name: 'Acme admin', existingCount: 0 });
  const other = createPersona({ name: 'Client X', existingCount: 1 });
  const s1 = createSession({ personaId: persona.id, site: 'https://sync.localhost', label: 'admin' });
  const s2 = createSession({ personaId: other.id, site: 'https://shop.test', label: 'buyer' });
  const views = toPersonaViews([persona, other], [s1, s2], {});

  it('returns everything for a blank query', () => {
    expect(filterPersonas(views, '   ')).toHaveLength(2);
  });

  it('keeps a whole persona when its NAME matches', () => {
    const out = filterPersonas(views, 'acme');
    expect(out).toHaveLength(1);
    expect(out[0]?.sessions).toHaveLength(1);
  });

  it('keeps a persona when one of its SITES matches, hiding the others', () => {
    // Searching for a site must not hide the persona that holds it.
    const out = filterPersonas(views, 'shop');
    expect(out.map((p) => p.name)).toEqual(['Client X']);
    expect(out[0]?.sessions.map((s) => s.label)).toEqual(['buyer']);
  });

  it('matches a session label', () => {
    expect(filterPersonas(views, 'buyer').map((p) => p.name)).toEqual(['Client X']);
  });

  it('matches a persona DESCRIPTION, so writing one does not make it harder to find', () => {
    const described = { ...persona, description: 'staging stack' };
    const describedViews = toPersonaViews([described, other], [s1, s2], {});
    expect(filterPersonas(describedViews, 'staging').map((p) => p.name)).toEqual(['Acme admin']);
  });

  it('returns nothing when there is no match', () => {
    expect(filterPersonas(views, 'zzz')).toEqual([]);
  });
});

describe('flattenForKeyboard', () => {
  const persona = createPersona({ name: 'p', existingCount: 0 });
  const s1 = createSession({ personaId: persona.id, site: 'https://a.test' });
  const views = toPersonaViews([persona], [s1], {});

  it('lists only the persona when collapsed', () => {
    expect(flattenForKeyboard(views, new Set())).toEqual([{ kind: 'persona', id: persona.id }]);
  });

  it('includes its sessions when expanded, in render order', () => {
    expect(flattenForKeyboard(views, new Set([persona.id]))).toEqual([
      { kind: 'persona', id: persona.id },
      { kind: 'session', id: s1.id, personaId: persona.id },
    ]);
  });
});

describe('makePersonaId', () => {
  it('is deterministic given its random source, so tests need no stubbing', () => {
    expect(makePersonaId(() => 0.5)).toBe(makePersonaId(() => 0.5));
  });
});
