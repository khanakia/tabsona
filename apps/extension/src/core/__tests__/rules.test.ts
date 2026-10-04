import { describe, expect, it } from 'vitest';
import {
  buildSessionRules, ruleSignature, rulePriority, tabRulesMatch, urlPattern,
} from '../rules';
import {
  DOMAIN_RULE_TIER, HOST_RULE_TIER, RULE_ID_BASE, RULE_RESOURCE_TYPES, STRIP_RULE_PRIORITY,
} from '../constants';
import type { TabRule } from '@/domain/types';
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

/** The rules for one tab bound to one session — the shape nearly every case needs. */
const rulesFor = (s: Session, now?: number): TabRule[] => buildSessionRules({
  bindings: { '5': s.id }, sessions: { [s.id]: s }, ...(now === undefined ? {} : { now }),
});

/**
 * Which rule Chrome would apply to a request: the highest-priority rule of this tab whose
 * url pattern matches. Mirrors DNR's precedence so the tests assert what a request would
 * actually CARRY, not what the rule list happens to look like.
 */
function winner(rules: readonly TabRule[], url: string): TabRule | undefined {
  return rules
    .filter((r) => r.urlRegex === null || new RegExp(r.urlRegex).test(url))
    .sort((a, b) => b.priority - a.priority)[0];
}
const cookieSent = (rules: readonly TabRule[], url: string): string | null => {
  const edit = winner(rules, url)?.requestHeaders.find((h) => h.header === 'cookie');
  return edit?.operation === 'set' ? edit.value ?? '' : null;
};

describe('buildSessionRules', () => {
  it('sends the session cookie to its own host on any port and path', () => {
    const rules = rulesFor(session({ cookies: [cookie({ domain: 'localhost', name: 'ifpg', value: 'x' })] }));
    expect(cookieSent(rules, 'http://localhost:2165/admin')).toBe('ifpg=x');
    expect(cookieSent(rules, 'http://localhost:8787/')).toBe('ifpg=x');
  });

  it('does not depend on the url the tab is on, so a tab bound on about:blank is right from its first request', () => {
    // THE BUG THIS SHAPE FIXES: rules were computed from the tab's url, which is
    // about:blank when it is bound, so the first real request left with no cookie and an
    // app that redirects signed-out users bounced the tab to its login page.
    const rules = rulesFor(session({ cookies: [cookie()] }));
    expect(cookieSent(rules, 'http://example.com/dashboard')).toBe('sid=v');
  });

  it('never sends one host\'s cookies to another host', () => {
    // A tab-wide `set` used to send the app's session cookie to every analytics, CDN
    // and SSO host the page loaded.
    const rules = rulesFor(session({ cookies: [cookie({ domain: 'localhost' })] }));
    expect(cookieSent(rules, 'https://independent-tea-80-staging.authkit.app/')).toBeNull();
    expect(cookieSent(rules, 'http://127.0.0.1:8787/')).toBeNull();
    expect(cookieSent(rules, 'http://evil.localhost/')).toBeNull();
  });

  it('strips the shared jar from hosts the session holds nothing for', () => {
    const rules = rulesFor(session());
    expect(winner(rules, 'http://example.com/')?.requestHeaders).toEqual([{ header: 'cookie', operation: 'remove' }]);
    expect(winner(rules, 'http://example.com/')?.priority).toBe(STRIP_RULE_PRIORITY);
  });

  it('gives every tab exactly one unscoped rule, and it only removes', () => {
    const rules = rulesFor(session({ cookies: [cookie()] }));
    const unscoped = rules.filter((r) => r.urlRegex === null);
    expect(unscoped).toHaveLength(1);
    expect(unscoped[0]?.requestHeaders.every((h) => h.operation === 'remove')).toBe(true);
  });

  it('sends a Domain cookie to subdomains, but a host-only cookie only to its host', () => {
    const rules = rulesFor(session({
      cookies: [
        cookie({ name: 'shared', domain: 'example.com', hostOnly: false }),
        cookie({ name: 'mine', domain: 'example.com', hostOnly: true }),
      ],
    }));
    expect(cookieSent(rules, 'https://example.com/')).toBe('shared=v; mine=v');
    expect(cookieSent(rules, 'https://api.example.com/')).toBe('shared=v');
    expect(cookieSent(rules, 'https://notexample.com/')).toBeNull();
  });

  it('honours cookie paths the way a browser does', () => {
    const rules = rulesFor(session({
      cookies: [cookie({ name: 'root' }), cookie({ name: 'api', path: '/api' })],
    }));
    expect(cookieSent(rules, 'http://example.com/')).toBe('root=v');
    expect(cookieSent(rules, 'http://example.com/api')).toBe('api=v; root=v');
    expect(cookieSent(rules, 'http://example.com/api/users?x=1')).toBe('api=v; root=v');
    expect(cookieSent(rules, 'http://example.com/apix')).toBe('root=v');
  });

  it('withholds a Secure cookie from plain http on a real host, but not on localhost', () => {
    const remote = rulesFor(session({ cookies: [cookie({ secure: true })] }));
    expect(cookieSent(remote, 'https://example.com/')).toBe('sid=v');
    expect(cookieSent(remote, 'http://example.com/')).toBeNull();
    const local = rulesFor(session({ cookies: [cookie({ domain: 'localhost', secure: true })] }));
    expect(cookieSent(local, 'http://localhost:2165/')).toBe('sid=v');
  });

  it('drops an expired cookie from the emitted header', () => {
    const rules = rulesFor(session({ cookies: [cookie({ expiresAt: 1000 })] }), 2000);
    expect(cookieSent(rules, 'http://example.com/')).toBeNull();
  });

  it('STRIPS Set-Cookie on every response, so a session never writes to the shared jar', () => {
    // Without this, signing into a session tab also signs the whole browser in: the
    // request rule controls what we SEND, but the response still writes to the browser's
    // own jar, and a plain tab silently becomes whoever the persona just signed in as.
    const rules = rulesFor(session({ cookies: [cookie()] }));
    for (const r of rules) expect(r.responseHeaders).toEqual([{ header: 'set-cookie', operation: 'remove' }]);
  });

  it('covers every resource type, so no channel leaks the shared jar', () => {
    for (const r of rulesFor(session({ cookies: [cookie()] }))) expect(r.resourceTypes).toEqual(RULE_RESOURCE_TYPES);
  });

  it('adds Authorization for a token-injection session, on its own host only', () => {
    const rules = rulesFor(session({ engine: 'token-injection', bearerToken: 'TOK', site: 'https://api.test' }));
    expect(winner(rules, 'https://api.test/v1')?.requestHeaders).toEqual([
      { header: 'cookie', operation: 'remove' },
      { header: 'authorization', operation: 'set', value: 'Bearer TOK' },
    ]);
    expect(winner(rules, 'https://analytics.test/')?.requestHeaders.some((h) => h.header === 'authorization')).toBe(false);
  });

  it('does not add Authorization when the engine is not token-injection', () => {
    const rules = rulesFor(session({ bearerToken: 'TOK', cookies: [cookie()] }));
    expect(rules.flatMap((r) => r.requestHeaders).some((h) => h.header === 'authorization')).toBe(false);
  });

  it('scopes each tab\'s rules to that tab, with ids unique across the set', () => {
    const rules = buildSessionRules({
      bindings: { '1': 's_1', '2': 's_2' },
      sessions: { s_1: session({ cookies: [cookie()] }), s_2: session({ id: 's_2' }) },
    });
    expect(new Set(rules.map((r) => r.tabId))).toEqual(new Set([1, 2]));
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    expect(Math.min(...rules.map((r) => r.id))).toBe(RULE_ID_BASE);
  });

  it('skips a binding whose session no longer exists', () => {
    expect(buildSessionRules({ bindings: { '1': 's_gone' }, sessions: {} })).toEqual([]);
  });

  it('skips a non-numeric or negative tab id', () => {
    expect(buildSessionRules({ bindings: { 'nope': 's_1', '-1': 's_1' }, sessions: { s_1: session() } })).toEqual([]);
  });

  it('is deterministic, so a resync installs the same set', () => {
    const s = session({ cookies: [cookie(), cookie({ name: 'b', path: '/x' })] });
    expect(rulesFor(s, 5)).toEqual(rulesFor(s, 5));
  });
});

describe('urlPattern', () => {
  it('escapes the host, so a dot cannot match any character', () => {
    const re = new RegExp(urlPattern(['http'], 'a.com', '/', false));
    expect(re.test('http://a.com/')).toBe(true);
    expect(re.test('http://abcom/')).toBe(false);
  });

  it('matches subdomains only when asked, never the bare domain', () => {
    const re = new RegExp(urlPattern(['https'], 'a.com', '/', true));
    expect(re.test('https://x.a.com/')).toBe(true);
    expect(re.test('https://a.com/')).toBe(false);
    expect(re.test('https://xa.com/')).toBe(false);
  });
});

describe('rulePriority', () => {
  it('ranks an exact host above any parent-domain rule, however long its path', () => {
    expect(rulePriority(HOST_RULE_TIER, 'a.com', '/'))
      .toBeGreaterThan(rulePriority(DOMAIN_RULE_TIER, 'x.y.z.a.com', '/'.repeat(5000)));
  });

  it('ranks a longer path above a shorter one on the same host', () => {
    expect(rulePriority(HOST_RULE_TIER, 'a.com', '/api')).toBeGreaterThan(rulePriority(HOST_RULE_TIER, 'a.com', '/'));
  });

  it('never ties with the strip rule', () => {
    expect(rulePriority(DOMAIN_RULE_TIER, 'localhost', '/')).toBeGreaterThan(STRIP_RULE_PRIORITY);
  });
});

describe('tabRulesMatch', () => {
  const s = session({ cookies: [cookie()] });
  const rules = rulesFor(s);

  it('accepts the same rules read back in a different order', () => {
    const shuffled = [...rules].reverse().map((r) => ({
      ...r, resourceTypes: [...r.resourceTypes].reverse(), requestHeaders: [...r.requestHeaders].reverse(),
    }));
    expect(tabRulesMatch(rules, shuffled, 5)).toBe(true);
  });

  it('rejects a strip-only rule set for a session that holds cookies', () => {
    // The exact false confirmation behind the bug: a rule existed for the tab, so the
    // old check passed, but it removed every cookie.
    const stripOnly = rulesFor(session());
    expect(tabRulesMatch(rules, stripOnly, 5)).toBe(false);
  });

  it('rejects a leftover rule from the tab\'s previous session', () => {
    const extra = [...rules, ...rulesFor(session({ cookies: [cookie({ name: 'old' })] }))];
    expect(tabRulesMatch(rules, extra, 5)).toBe(false);
  });

  it('never confirms a tab nothing is expected for', () => {
    expect(tabRulesMatch(rules, rules, 99)).toBe(false);
  });

  it('ignores ids, because they are reassigned on every sync', () => {
    const [first] = rules;
    if (!first) throw new Error('expected at least one rule');
    const renumbered: TabRule = { ...first, id: first.id + 1 };
    expect(ruleSignature(first)).toBe(ruleSignature(renumbered));
  });
});
