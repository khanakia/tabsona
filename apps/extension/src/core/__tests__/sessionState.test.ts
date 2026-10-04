import { describe, expect, it } from 'vitest';
import { describeState, isEmpty, sessionStateOf, storageKeyNames } from '../sessionState';
import { createSession } from '../personas';
import { EXPIRY_GRACE_MS } from '../constants';
import type { CookieRecord, Session } from '@/domain/types';

const cookie = (over: Partial<CookieRecord> = {}): CookieRecord => ({
  name: 'sid', value: 'v', domain: 'a.test', hostOnly: true, path: '/',
  expiresAt: null, secure: false, httpOnly: false, sameSite: null, partitionKey: null,
  ...over,
});
const blank = (): Session => createSession({ personaId: 'p_1', site: 'https://a.test' });

describe('storageKeyNames', () => {
  it('collects keys across every origin and area, deduped and sorted', () => {
    const s = blank();
    s.storage = {
      'https://a.test': { local: { b: '1', a: '2' }, session: { a: '3' } },
      'https://b.test': { local: { c: '4' } },
    };
    expect(storageKeyNames(s)).toEqual(['a', 'b', 'c']);
  });

  it('is empty for a session that has stored nothing', () => {
    expect(storageKeyNames(blank())).toEqual([]);
  });
});

describe('isEmpty', () => {
  it('is true for a brand-new session', () => {
    // An empty session deliberately starts a tab SIGNED OUT, which reads as a broken
    // button unless every surface says so. This is the rule all of them derive from.
    expect(isEmpty(blank())).toBe(true);
  });

  it('is false once a cookie exists', () => {
    const s = blank(); s.cookies = [cookie()];
    expect(isEmpty(s)).toBe(false);
  });

  it('is false once page storage exists', () => {
    const s = blank(); s.storage = { 'https://a.test': { local: { 'authmgr.access': 'jwt' } } };
    expect(isEmpty(s)).toBe(false);
  });

  it('is false for a bearer token', () => {
    const s = blank(); s.bearerToken = 'T';
    expect(isEmpty(s)).toBe(false);
  });

  it('stays true when a captured slice exists but is EMPTY', () => {
    // A visited-but-never-signed-in origin must not look like a usable login.
    const s = blank(); s.storage = { 'https://a.test': { local: {} } };
    expect(isEmpty(s)).toBe(true);
  });
});

describe('sessionStateOf', () => {
  it('is empty when nothing is stored', () => {
    expect(sessionStateOf(blank())).toBe('empty');
  });

  it('is signed-in with a live cookie', () => {
    const s = blank(); s.cookies = [cookie()];
    expect(sessionStateOf(s)).toBe('signed-in');
  });

  it('is expired when every cookie has aged out', () => {
    const s = blank(); s.cookies = [cookie({ expiresAt: 1000 })];
    expect(sessionStateOf(s, 2000)).toBe('expired');
  });

  it('is still signed-in while ONE cookie survives', () => {
    const s = blank();
    s.cookies = [cookie({ name: 'dead', expiresAt: 1000 }), cookie({ name: 'live', expiresAt: null })];
    expect(sessionStateOf(s, 2000)).toBe('signed-in');
  });

  it('treats a cookie expiring within the grace window as already gone', () => {
    // So a session is not reported as usable seconds before it stops working.
    const s = blank(); s.cookies = [cookie({ expiresAt: 10_000 })];
    expect(sessionStateOf(s, 10_000 - EXPIRY_GRACE_MS + 1)).toBe('expired');
  });

  it('is unknown for a storage-only session, because a token carries no readable expiry', () => {
    // The sync.localhost shape: a JWT in localStorage and no cookie in sight. Claiming
    // "signed in" would be a guess, and being honest here is the point of the state.
    const s = blank(); s.storage = { 'https://a.test': { local: { 'authmgr.access': 'jwt' } } };
    expect(sessionStateOf(s)).toBe('unknown');
  });
});

describe('describeState', () => {
  it('tells an empty session what to do', () => {
    expect(describeState({ state: 'empty', cookieCount: 0, storageKeyCount: 0 }))
      .toBe('nothing saved yet — sign in once');
  });

  it('tells an expired session what to do', () => {
    expect(describeState({ state: 'expired', cookieCount: 2, storageKeyCount: 0 }))
      .toBe('login ended — sign in again');
  });

  it('states the real contents, which is what v1 never did', () => {
    expect(describeState({ state: 'signed-in', cookieCount: 4, storageKeyCount: 3 }))
      .toBe('4 cookies · 3 keys');
  });

  it('singularises', () => {
    expect(describeState({ state: 'signed-in', cookieCount: 1, storageKeyCount: 1 }))
      .toBe('1 cookie · 1 key');
  });

  it('omits a zero count rather than printing "0 cookies"', () => {
    expect(describeState({ state: 'unknown', cookieCount: 0, storageKeyCount: 2 })).toBe('2 keys');
  });
});
