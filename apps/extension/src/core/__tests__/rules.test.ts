import { describe, expect, it } from 'vitest';
import { buildSessionRules, ruleIdForTab } from '../rules';
import { RULE_ID_BASE, RULE_RESOURCE_TYPES } from '../constants';
import type { CookieRecord, Session } from '@/domain/types';

const cookie = (over: Partial<CookieRecord> = {}): CookieRecord => ({
  name: 'sid', value: 'v', domain: 'example.com', hostOnly: true, path: '/',
  expiresAt: null, secure: false, httpOnly: false, sameSite: null, partitionKey: null,
  ...over,
});

const session = (over: Partial<Session> = {}): Session => ({
  id: 's_1', personaId: 'p_1', site: 'https://example.com', label: 'one',
  engine: 'cookie+storage', domains: [], cookies: [], storage: {}, bearerToken: null,
  savedAt: 0, lastUsedAt: 0, ...over,
});

describe('ruleIdForTab', () => {
  it('offsets into a reserved band so ids cannot collide with other rules', () => {
    expect(ruleIdForTab(7)).toBe(RULE_ID_BASE + 7);
  });

  it('is unique per tab', () => {
    expect(ruleIdForTab(1)).not.toBe(ruleIdForTab(2));
  });
});

describe('buildSessionRules', () => {
  it('SETS the cookie header when the session has a matching cookie', () => {
    const rules = buildSessionRules({
      bindings: { '5': 's_1' },
      sessions: { s_1: session({ cookies: [cookie()] }) },
      tabUrls: { '5': 'http://example.com/' },
    });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.requestHeaders[0]).toEqual({
      header: 'cookie', operation: 'set', value: 'sid=v',
    });
    expect(rules[0]?.tabId).toBe(5);
  });

  it('REMOVES the cookie header when the session has no cookies yet', () => {
    // The non-obvious half: without a strip rule the tab rides the shared jar's
    // existing login and arrives already signed in, so a second session is
    // impossible. This is the behaviour that makes isolation work at all.
    const rules = buildSessionRules({
      bindings: { '5': 's_1' },
      sessions: { s_1: session() },
      tabUrls: { '5': 'http://example.com/' },
    });
    expect(rules[0]?.requestHeaders[0]).toEqual({ header: 'cookie', operation: 'remove' });
  });

  it('STRIPS rather than leaks when the tab url is unknown', () => {
    // Safe default: send nothing, never "send the shared jar".
    const rules = buildSessionRules({
      bindings: { '5': 's_1' },
      sessions: { s_1: session({ cookies: [cookie()] }) },
      tabUrls: {},
    });
    expect(rules[0]?.requestHeaders[0]?.operation).toBe('remove');
  });

  it('STRIPS when the jar has cookies but none match this url', () => {
    const rules = buildSessionRules({
      bindings: { '5': 's_1' },
      sessions: { s_1: session({ cookies: [cookie({ domain: 'elsewhere.test' })] }) },
      tabUrls: { '5': 'http://example.com/' },
    });
    expect(rules[0]?.requestHeaders[0]?.operation).toBe('remove');
  });

  it('STRIPS Set-Cookie on the response, so a session never writes to the shared jar', () => {
    // Without this, signing into a session tab also signs the whole browser in: the
    // request rule controls what we SEND, but the response still writes to the browser's
    // own jar, and a plain tab silently becomes whoever the persona just signed in as.
    const rules = buildSessionRules({
      bindings: { '5': 's_1' }, sessions: { s_1: session() }, tabUrls: { '5': 'http://e.test/' },
    });
    expect(rules[0]?.responseHeaders).toEqual([{ header: 'set-cookie', operation: 'remove' }]);
  });

  it('covers every resource type, so no channel leaks the shared jar', () => {
    const rules = buildSessionRules({
      bindings: { '5': 's_1' }, sessions: { s_1: session() }, tabUrls: { '5': 'http://e.test/' },
    });
    expect(rules[0]?.resourceTypes).toEqual(RULE_RESOURCE_TYPES);
  });

  it('adds Authorization for a token-injection session', () => {
    const rules = buildSessionRules({
      bindings: { '9': 's_t' },
      sessions: { s_t: session({ id: 's_t', engine: 'token-injection', bearerToken: 'TOK' }) },
      tabUrls: { '9': 'https://api.test/' },
    });
    expect(rules[0]?.requestHeaders).toEqual([
      { header: 'cookie', operation: 'remove' },
      { header: 'authorization', operation: 'set', value: 'Bearer TOK' },
    ]);
  });

  it('does not add Authorization when the engine is not token-injection', () => {
    const rules = buildSessionRules({
      bindings: { '9': 's_1' },
      sessions: { s_1: session({ bearerToken: 'TOK' }) },
      tabUrls: { '9': 'https://api.test/' },
    });
    expect(rules[0]?.requestHeaders).toHaveLength(1);
  });

  it('emits one rule per bound tab', () => {
    const rules = buildSessionRules({
      bindings: { '1': 's_1', '2': 's_2' },
      sessions: { s_1: session(), s_2: session({ id: 's_2' }) },
      tabUrls: { '1': 'http://e.test/', '2': 'http://e.test/' },
    });
    expect(rules.map((r) => r.id)).toEqual([ruleIdForTab(1), ruleIdForTab(2)]);
  });

  it('skips a binding whose session no longer exists', () => {
    const rules = buildSessionRules({
      bindings: { '1': 's_gone' }, sessions: {}, tabUrls: { '1': 'http://e.test/' },
    });
    expect(rules).toEqual([]);
  });

  it('skips a non-numeric or negative tab id', () => {
    const rules = buildSessionRules({
      bindings: { 'nope': 's_1', '-1': 's_1' },
      sessions: { s_1: session() },
      tabUrls: {},
    });
    expect(rules).toEqual([]);
  });

  it('drops an expired cookie from the emitted header', () => {
    const rules = buildSessionRules({
      bindings: { '5': 's_1' },
      sessions: { s_1: session({ cookies: [cookie({ expiresAt: 1000 })] }) },
      tabUrls: { '5': 'http://example.com/' },
      now: 2000,
    });
    expect(rules[0]?.requestHeaders[0]?.operation).toBe('remove');
  });
});
