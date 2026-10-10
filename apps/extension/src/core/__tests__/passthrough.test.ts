import { describe, expect, it } from 'vitest';
import {
  buildPassThroughRules, entryForOrigin, googlePresetActive, isGoogleHostname, missingGoogleHosts, normalizeHostEntry,
  normalizePassThroughHosts, offerFor, passThroughMatchPattern, passThroughRegex, urlIsPassThrough,
  withPassThroughHosts, withoutPassThrough, withoutPassThroughHost,
} from '../passthrough';
import { buildSessionRules } from '../rules';
import { buildGateRules } from '../gate';
import {
  ALL_SITES_PATTERN, DOMAIN_RULE_TIER, GATE_ALLOW_PRIORITY, GATE_BLOCK_PRIORITY, GOOGLE_SIGN_IN_HOSTS, HOST_RULE_TIER,
  MAX_PASS_THROUGH_HOSTS, MAX_PATH_PRIORITY, PASS_THROUGH_ALLOW_PRIORITY, PRIORITY_LABEL_SPAN, PRIORITY_TIER_SPAN,
  STRIP_RULE_PRIORITY,
} from '../constants';
import type { CookieRecord, Session } from '@/domain/types';

const GOOGLE = [...GOOGLE_SIGN_IN_HOSTS];

describe('normalizeHostEntry — whatever the user typed, as a canonical host entry', () => {
  it('accepts a bare host, a url, a wildcard and a host with a port', () => {
    expect(normalizeHostEntry('accounts.google.com')).toBe('accounts.google.com');
    expect(normalizeHostEntry('  HTTPS://Accounts.Google.com/signin?x=1#f ')).toBe('accounts.google.com');
    expect(normalizeHostEntry('*.example.com')).toBe('*.example.com');
    expect(normalizeHostEntry('http://localhost:8790/auth')).toBe('localhost:8790');
  });

  it('rejects everything that is not a host, so nothing is exempted by accident', () => {
    for (const bad of ['', '   ', '*', '*.com', 'a b', 'user@evil.net', 'https://user:pw@host.com', 'host:0', 'host:99999', '-a.com', 'a..com', 42, null, undefined]) {
      expect(normalizeHostEntry(bad), String(bad)).toBeNull();
    }
  });
});

describe('normalizePassThroughHosts / withPassThroughHosts / withoutPassThroughHost', () => {
  it('de-duplicates, sorts and drops garbage; anything but an array is the empty list', () => {
    expect(normalizePassThroughHosts(['b.com', 'https://a.com/x', 'b.com', 'nope nope', 7])).toEqual(['a.com', 'b.com']);
    expect(normalizePassThroughHosts('accounts.google.com')).toEqual([]);
    expect(normalizePassThroughHosts(undefined)).toEqual([]);
  });

  it('caps the list, so a bad import cannot install thousands of rules', () => {
    const many = Array.from({ length: MAX_PASS_THROUGH_HOSTS + 10 }, (_, i) => `h${String(i).padStart(3, '0')}.example.com`);
    expect(normalizePassThroughHosts(many)).toHaveLength(MAX_PASS_THROUGH_HOSTS);
  });

  it('adds without mutating, ignores a duplicate, removes by normalised value', () => {
    const list = ['a.com'] as const;
    expect(withPassThroughHosts(list, ['https://B.com', 'a.com'])).toEqual(['a.com', 'b.com']);
    expect(list).toEqual(['a.com']);
    expect(withoutPassThroughHost(['a.com', 'b.com'], 'https://B.com/x')).toEqual(['a.com']);
    expect(withoutPassThroughHost(['a.com'], 'nope nope')).toEqual(['a.com']);
  });
});

describe('matching — the same host rules as a Chrome grant, and never a lookalike', () => {
  it('a plain entry is that host only (any port), not its subdomains', () => {
    const list = ['accounts.google.com'];
    expect(urlIsPassThrough(list, 'https://accounts.google.com/v3/signin')).toBe(true);
    expect(urlIsPassThrough(list, 'https://accounts.google.com')).toBe(true);
    expect(urlIsPassThrough(list, 'https://accounts.google.com:8443/')).toBe(true);
    expect(urlIsPassThrough(list, 'https://mail.google.com/')).toBe(false);
    expect(urlIsPassThrough(list, 'https://x.accounts.google.com/')).toBe(false);
  });

  it('rejects look-alikes: a longer host, the host in the path, in userinfo, as a suffix', () => {
    const list = ['accounts.google.com'];
    expect(urlIsPassThrough(list, 'https://accounts.google.com.evil.net/')).toBe(false);
    expect(urlIsPassThrough(list, 'https://evil.net/accounts.google.com/')).toBe(false);
    expect(urlIsPassThrough(list, 'https://accounts.google.com@evil.net/')).toBe(false);
    expect(urlIsPassThrough(list, 'https://notaccounts.google.com/')).toBe(false);
  });

  it('a wildcard is the domain and every subdomain; a port is exact', () => {
    expect(urlIsPassThrough(['*.example.com'], 'https://a.b.example.com/')).toBe(true);
    expect(urlIsPassThrough(['*.example.com'], 'https://example.com/')).toBe(true);
    expect(urlIsPassThrough(['*.example.com'], 'https://badexample.com/')).toBe(false);
    expect(urlIsPassThrough(['localhost:8790'], 'http://localhost:8790/x')).toBe(true);
    expect(urlIsPassThrough(['localhost:8790'], 'http://localhost:8787/x')).toBe(false);
  });

  it('an empty list matches nothing', () => {
    expect(urlIsPassThrough([], 'https://accounts.google.com/')).toBe(false);
  });

  it('withoutPassThrough removes only the listed origins — what every leak check relies on', () => {
    expect(withoutPassThrough(['accounts.google.com'], ['https://accounts.google.com', 'https://auth.other.com']))
      .toEqual(['https://auth.other.com']);
  });

  it('the regex and the content-script pattern are derived from the same entry', () => {
    expect(passThroughRegex('accounts.google.com')).toContain('accounts\\.google\\.com');
    expect(passThroughMatchPattern('*.example.com')).toBe('*://*.example.com/*');
    // Chrome refuses a port in a content-script pattern ("Invalid port"), so it is dropped.
    expect(passThroughMatchPattern('localhost:8790')).toBe('*://localhost/*');
  });
});

describe('buildPassThroughRules', () => {
  const bindings = { 12: 's_a', 3: 's_b' };

  it('one allow per entry, scoped to every bound tab, ids from firstId', () => {
    const rules = buildPassThroughRules({ bindings, hosts: ['accounts.google.com', 'accounts.youtube.com'], firstId: 500 });
    expect(rules).toEqual([
      { id: 500, tabIds: [3, 12], urlRegex: passThroughRegex('accounts.google.com') },
      { id: 501, tabIds: [3, 12], urlRegex: passThroughRegex('accounts.youtube.com') },
    ]);
  });

  it('no rule for an empty list or when no tab is bound — an ordinary tab is never touched', () => {
    expect(buildPassThroughRules({ bindings, hosts: [], firstId: 1 })).toEqual([]);
    expect(buildPassThroughRules({ bindings: {}, hosts: GOOGLE, firstId: 1 })).toEqual([]);
    expect(buildPassThroughRules({ bindings: { '-1': 's', x: 's' }, hosts: GOOGLE, firstId: 1 })).toEqual([]);
  });
});

describe('priority layering — pinned', () => {
  const cookie = (over: Partial<CookieRecord>): CookieRecord => ({
    name: 'sid', value: 'v', domain: 'example.com', hostOnly: true, path: '/',
    expiresAt: null, secure: false, httpOnly: false, sameSite: null, partitionKey: null, ...over,
  });
  /** The most demanding session the engine could build: a deep host with a very long path
   *  (the label and path terms are at their ceilings) and a parent-domain cookie. */
  const deepest: Session = {
    id: 's_1', personaId: 'p_1', site: 'https://a.example.com', label: 'x', engine: 'cookie+storage',
    domains: [], bearerToken: null, savedAt: 0, lastUsedAt: 0, storage: {},
    cookies: [
      cookie({ domain: 'a.b.c.d.e.f.g.h.example.com', path: `/${'p'.repeat(5_000)}` }),
      cookie({ name: 'wide', domain: 'example.com', hostOnly: false }),
    ],
  };

  it('is strictly increasing: gate block < gate allow < strip < every cookie SET < pass-through allow', () => {
    const cookieRules = buildSessionRules({ bindings: { '5': 's_1' }, sessions: { s_1: deepest }, now: 0 });
    const setRules = cookieRules.filter((r) => r.priority !== STRIP_RULE_PRIORITY);
    expect(setRules.length).toBeGreaterThan(1);
    expect(GATE_BLOCK_PRIORITY).toBeLessThan(GATE_ALLOW_PRIORITY);
    expect(GATE_ALLOW_PRIORITY).toBeLessThan(STRIP_RULE_PRIORITY);
    expect(STRIP_RULE_PRIORITY).toBeLessThan(Math.min(...setRules.map((r) => r.priority)));
    expect(Math.max(...cookieRules.map((r) => r.priority))).toBeLessThan(PASS_THROUGH_ALLOW_PRIORITY);
  });

  it('the highest possible cookie rule is below the exemption, by construction', () => {
    const MAX_LABELS = 127;
    const ceiling = HOST_RULE_TIER * PRIORITY_TIER_SPAN + MAX_LABELS * PRIORITY_LABEL_SPAN + MAX_PATH_PRIORITY;
    expect(ceiling).toBeLessThan(PASS_THROUGH_ALLOW_PRIORITY);
    expect(DOMAIN_RULE_TIER).toBeLessThan(HOST_RULE_TIER);
    expect(PASS_THROUGH_ALLOW_PRIORITY).toBe(3 * PRIORITY_TIER_SPAN);
  });
});

describe('interplay with "Allow on all sites"', () => {
  const bindings = { 4: 's_a' };

  it('the gate vanishes under all-sites but the exemption stays: it outranks the strip that now covers every host', () => {
    expect(buildGateRules({ bindings, granted: [ALL_SITES_PATTERN], firstId: 1 })).toEqual([]);
    expect(buildPassThroughRules({ bindings, hosts: GOOGLE, firstId: 1 })).toHaveLength(GOOGLE.length);
  });

  it('without all-sites the exemption needs no grant: it is independent of the granted set', () => {
    // buildPassThroughRules does not take the granted set at all — that is the point: an
    // allow edits nothing, so it works on a host Tabsona holds no permission for.
    expect(buildPassThroughRules({ bindings, hosts: ['accounts.google.com'], firstId: 1 })).toHaveLength(1);
  });
});

describe('the Google preset and offers', () => {
  it('covers the whole known chain, and is not *.google.com', () => {
    expect(GOOGLE).toEqual(['accounts.google.com', 'accounts.youtube.com']);
    expect(urlIsPassThrough(GOOGLE, 'https://mail.google.com/')).toBe(false);
  });

  it('knows a Google hostname, including subdomains, and not a look-alike', () => {
    expect(isGoogleHostname('accounts.google.com')).toBe(true);
    expect(isGoogleHostname('consent.google.com')).toBe(true);
    expect(isGoogleHostname('www.youtube.com')).toBe(true);
    expect(isGoogleHostname('notgoogle.com')).toBe(false);
    expect(isGoogleHostname('google.com.evil.net')).toBe(false);
  });

  it('a Google stop offers the whole preset in one click, plus the stopped host when it is another Google domain', () => {
    expect(offerFor(['https://accounts.google.com'], [])).toEqual({ kind: 'google', hosts: GOOGLE });
    expect(offerFor(['https://consent.google.com'], [])).toEqual({
      kind: 'google', hosts: ['accounts.google.com', 'accounts.youtube.com', 'consent.google.com'],
    });
  });

  it('offers only what is missing, and nothing once everything is on the list', () => {
    expect(offerFor(['https://accounts.youtube.com'], ['accounts.google.com'])).toEqual({ kind: 'google', hosts: ['accounts.youtube.com'] });
    expect(offerFor(['https://accounts.google.com'], GOOGLE)).toBeNull();
    expect(offerFor([], [])).toBeNull();
    expect(offerFor(['not a url'], [])).toBeNull();
  });

  it('any other website is offered on its own, port included', () => {
    expect(offerFor(['https://auth.example.com'], [])).toEqual({ kind: 'host', hosts: ['auth.example.com'] });
    expect(offerFor(['http://localhost:8790'], [])).toEqual({ kind: 'host', hosts: ['localhost:8790'] });
    expect(entryForOrigin('http://localhost:8790')).toBe('localhost:8790');
    expect(entryForOrigin('nope')).toBeNull();
  });

  it('tells whether the preset is fully on the list', () => {
    expect(googlePresetActive([])).toBe(false);
    expect(googlePresetActive(['accounts.google.com'])).toBe(false);
    expect(googlePresetActive(GOOGLE)).toBe(true);
    expect(googlePresetActive(['*.google.com', '*.youtube.com'])).toBe(true);
  });
});

describe('missingGoogleHosts', () => {
  it('lists every default on an empty list, and none once all are present', () => {
    expect(missingGoogleHosts([])).toEqual(GOOGLE);
    expect(missingGoogleHosts(GOOGLE)).toEqual([]);
  });

  it('lists only the defaults the user removed', () => {
    expect(missingGoogleHosts(['accounts.google.com', 'example.com'])).toEqual(['accounts.youtube.com']);
  });

  it('counts a wildcard entry as covering its hosts', () => {
    expect(missingGoogleHosts(['*.google.com'])).toEqual(['accounts.youtube.com']);
  });
});
