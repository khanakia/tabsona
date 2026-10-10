import { describe, expect, it } from 'vitest';
import {
  GATE_BLOCK_URL_FILTER, blockedTarget, buildGateRules, grantRegex, hintExplainsStop, hostsToAsk, leakWindowFor,
  redirectOpensLeakWindow, withLeakWindow, withoutLeakWindow,
} from '../gate';
import {
  ALL_SITES_PATTERN, ALL_URLS_PATTERN, BLOCKED_BY_CLIENT_ERROR, DOMAIN_RULE_TIER, FORM_HINT_MAX_AGE_MS, GATE_ALLOW_PRIORITY,
  GATE_BLOCK_PRIORITY, LEAK_WINDOW_MS, PRIORITY_TIER_SPAN, STRIP_RULE_PRIORITY,
} from '../constants';

/** Does an RE2 pattern from grantRegex match this url? JS regex is a faithful stand-in
 *  for the subset grantRegex emits (no lookaround, no backreferences). */
const matches = (pattern: string | null, url: string) => pattern !== null && new RegExp(pattern).test(url);

describe('grantRegex — a Chrome match pattern as the urls it lets through', () => {
  it('an explicit port is exact, like the grant', () => {
    const r = grantRegex('http://localhost:8790/*');
    expect(matches(r, 'http://localhost:8790/sso/start')).toBe(true);
    expect(matches(r, 'http://localhost:8790')).toBe(true);
    expect(matches(r, 'http://localhost:8787/')).toBe(false);
    expect(matches(r, 'https://localhost:8790/')).toBe(false);
  });

  it('never lets a subdomain through on a plain-host grant — the hop the gate exists for', () => {
    // excludedRequestDomains would have exempted relay.localhost here; this is why the
    // gate uses a regex (see grantRegex's doc).
    const r = grantRegex('http://localhost:8790/*');
    expect(matches(r, 'http://relay.localhost:8790/relay/authorize')).toBe(false);
    expect(matches(grantRegex('https://example.com/*'), 'https://auth.example.com/')).toBe(false);
  });

  it('no port in the pattern means any port, as in Chrome', () => {
    const r = grantRegex('https://app.example.com/*');
    expect(matches(r, 'https://app.example.com/')).toBe(true);
    expect(matches(r, 'https://app.example.com:8443/x')).toBe(true);
  });

  it('*. covers the domain and every subdomain; * scheme covers http and https', () => {
    const r = grantRegex('*://*.example.com/*');
    expect(matches(r, 'https://example.com/')).toBe(true);
    expect(matches(r, 'http://a.b.example.com/x')).toBe(true);
    expect(matches(r, 'https://badexample.com/')).toBe(false);
    expect(matches(r, 'https://example.com.evil.net/')).toBe(false);
  });

  it('does not let a look-alike through: a longer host, or the host in the path or userinfo', () => {
    const r = grantRegex('https://app.example.com/*');
    expect(matches(r, 'https://app.example.community/')).toBe(false);
    expect(matches(r, 'https://evil.net/app.example.com/')).toBe(false);
    expect(matches(r, 'https://app.example.com@evil.net/')).toBe(false);
  });

  it('is null for every website, non-web schemes and garbage', () => {
    expect(grantRegex(ALL_SITES_PATTERN)).toBeNull();
    expect(grantRegex(ALL_URLS_PATTERN)).toBeNull();
    expect(grantRegex('file:///*')).toBeNull();
    expect(grantRegex('not a pattern')).toBeNull();
    expect(grantRegex('https://*/*')).toBeNull();
  });
});

describe('buildGateRules', () => {
  const bindings = { 12: 's_a', 3: 's_b' };
  const granted = ['http://localhost:8790/*', 'https://api.example.com/*'];

  it('one block per bound tab and one allow per grant, scoped to the bound tabs', () => {
    const rules = buildGateRules({ bindings, granted, firstId: 1000 });
    expect(rules).toEqual([
      { kind: 'block', id: 1000, tabId: 3, urlFilter: GATE_BLOCK_URL_FILTER },
      { kind: 'block', id: 1001, tabId: 12, urlFilter: GATE_BLOCK_URL_FILTER },
      { kind: 'allow', id: 1002, tabIds: [3, 12], urlRegex: grantRegex('http://localhost:8790/*') },
      { kind: 'allow', id: 1003, tabIds: [3, 12], urlRegex: grantRegex('https://api.example.com/*') },
    ].sort((a, b) => a.id - b.id));
  });

  it('no rule at all once every website is allowed — there is nowhere to stop', () => {
    expect(buildGateRules({ bindings, granted: [...granted, ALL_SITES_PATTERN], firstId: 1 })).toEqual([]);
    expect(buildGateRules({ bindings, granted: [ALL_URLS_PATTERN], firstId: 1 })).toEqual([]);
  });

  it('no rule at all without a bound tab — an ordinary tab is never gated', () => {
    expect(buildGateRules({ bindings: {}, granted, firstId: 1 })).toEqual([]);
  });

  it('still blocks with nothing granted, so even the persona\'s own site asks first', () => {
    const rules = buildGateRules({ bindings: { 5: 's' }, granted: [], firstId: 1 });
    expect(rules).toEqual([{ kind: 'block', id: 1, tabId: 5, urlFilter: GATE_BLOCK_URL_FILTER }]);
  });

  it('ignores malformed tab ids and duplicate grants', () => {
    const rules = buildGateRules({
      bindings: { 'x': 's', '-1': 's', 4: 's' }, granted: ['https://a.com/*', 'https://a.com/*'], firstId: 1,
    });
    expect(rules.filter((r) => r.kind === 'block').map((r) => r.kind === 'block' && r.tabId)).toEqual([4]);
    expect(rules.filter((r) => r.kind === 'allow')).toHaveLength(1);
  });

  it('the block filter covers http and https and nothing that is not a web url', () => {
    // `|http` in DNR urlFilter syntax: anchored at the start of the url.
    const anchored = (url: string) => url.startsWith(GATE_BLOCK_URL_FILTER.slice(1));
    expect(anchored('https://github.com/')).toBe(true);
    expect(anchored('http://127.0.0.1:8790/')).toBe(true);
    expect(anchored('chrome-extension://abc/src/surfaces/gate/index.html')).toBe(false);
  });
});

describe('blockedTarget', () => {
  const ok = { frameId: 0, error: BLOCKED_BY_CLIENT_ERROR, url: 'http://relay.localhost:8790/relay/authorize?return=x' };

  it('is the origin of a top-level navigation a rule blocked', () => {
    expect(blockedTarget(ok)).toBe('http://relay.localhost:8790');
  });

  it('is null for a sub-frame, another error, or a non-web url', () => {
    expect(blockedTarget({ ...ok, frameId: 3 })).toBeNull();
    expect(blockedTarget({ ...ok, error: 'net::ERR_NAME_NOT_RESOLVED' })).toBeNull();
    expect(blockedTarget({ ...ok, url: 'chrome://newtab/' })).toBeNull();
    expect(blockedTarget({ ...ok, url: 'garbage' })).toBeNull();
  });
});

describe('hostsToAsk — one prompt for a known chain', () => {
  it('puts the stopped host first, then the rest of the chain, de-duplicated', () => {
    expect(hostsToAsk(['https://c.app', 'https://a.workos.com', 'https://c.app'], 'https://b.example.ai'))
      .toEqual(['https://b.example.ai', 'https://a.workos.com', 'https://c.app']);
  });

  it('includes the stopped host even when the chain has never seen it', () => {
    expect(hostsToAsk([], 'https://github.com')).toEqual(['https://github.com']);
    expect(hostsToAsk(['https://github.com'], 'https://github.com')).toEqual(['https://github.com']);
  });
});

describe('leak windows — the decision never to save a leaked login', () => {
  const t0 = 1_000_000;

  it('is open right after an unguarded hop, and lists the hosts', () => {
    const w = withLeakWindow({}, 9, 'https://idp.example', t0);
    expect(leakWindowFor(w, 9, t0 + 1)).toEqual(['https://idp.example']);
    expect(leakWindowFor(w, 10, t0 + 1)).toBeNull();
  });

  it('closes LEAK_WINDOW_MS after the LAST hop; a later hop extends it', () => {
    let w = withLeakWindow({}, 9, 'https://relay.example', t0);
    expect(leakWindowFor(w, 9, t0 + LEAK_WINDOW_MS)).toBeNull();
    w = withLeakWindow(w, 9, 'https://idp.example', t0 + LEAK_WINDOW_MS - 1);
    expect(leakWindowFor(w, 9, t0 + LEAK_WINDOW_MS + 10)).toEqual(['https://idp.example', 'https://relay.example']);
  });

  it('an expired window contributes no hosts to a new one', () => {
    let w = withLeakWindow({}, 9, 'https://old.example', t0);
    w = withLeakWindow(w, 9, 'https://new.example', t0 + LEAK_WINDOW_MS + 1);
    expect(leakWindowFor(w, 9, t0 + LEAK_WINDOW_MS + 2)).toEqual(['https://new.example']);
  });

  it('withoutLeakWindow drops that tab and every expired window, returning a new map', () => {
    const w = { ...withLeakWindow({}, 1, 'https://a', t0), ...withLeakWindow({}, 2, 'https://b', t0 + LEAK_WINDOW_MS) };
    const next = withoutLeakWindow(w, 2, t0 + LEAK_WINDOW_MS + 1);
    expect(next).toEqual({});
    expect(leakWindowFor(w, 2, t0 + LEAK_WINDOW_MS + 1)).toEqual(['https://b']);
  });
});

describe('redirectOpensLeakWindow', () => {
  it('a top-level redirect in a gated tab does not: the gate stops it before it leaves', () => {
    expect(redirectOpensLeakWindow('main_frame', true)).toBe(false);
  });

  it('every other case does: an ungated tab, or a fetch the gate does not cover', () => {
    expect(redirectOpensLeakWindow('main_frame', false)).toBe(true);
    expect(redirectOpensLeakWindow('xmlhttprequest', true)).toBe(true);
    expect(redirectOpensLeakWindow('xmlhttprequest', false)).toBe(true);
  });
});

describe('rule priority layering — an allow must never outrank a cookie rule', () => {
  it('block < allow < strip < every per-host cookie rule', () => {
    // Chrome cancels any modifyHeaders rule of the same or lower priority than a matching
    // `allow`, silently. If the allow ever reached the strip, a granted host would lose
    // its Cookie strip and the tab would ride the browser's jar.
    expect(GATE_BLOCK_PRIORITY).toBeLessThan(GATE_ALLOW_PRIORITY);
    expect(GATE_ALLOW_PRIORITY).toBeLessThan(STRIP_RULE_PRIORITY);
    expect(STRIP_RULE_PRIORITY).toBeLessThan(DOMAIN_RULE_TIER * PRIORITY_TIER_SPAN);
  });
});

describe('hintExplainsStop — was the stopped navigation a form POST?', () => {
  const action = 'https://accounts.example.com/o/oauth2/v2/auth';
  const hint = { action, method: 'post', at: 1_000 };

  it('yes: a fresh POST hint whose origin and path are the stopped url\'s', () => {
    expect(hintExplainsStop(hint, `${action}?client_id=x`, 1_500)).toBe(true);
    expect(hintExplainsStop(hint, action, 1_500)).toBe(true);
  });

  it('no hint, or a GET form, is a plain navigation', () => {
    expect(hintExplainsStop(undefined, action, 1_500)).toBe(false);
    expect(hintExplainsStop({ ...hint, method: 'get' }, action, 1_500)).toBe(false);
  });

  it('a different path or host is a different navigation (a redirect AFTER the POST)', () => {
    expect(hintExplainsStop(hint, 'https://accounts.example.com/other', 1_500)).toBe(false);
    expect(hintExplainsStop(hint, 'https://evil.example.net/o/oauth2/v2/auth', 1_500)).toBe(false);
  });

  it('an old hint no longer explains a later stop on the same path', () => {
    expect(hintExplainsStop(hint, action, 1_000 + FORM_HINT_MAX_AGE_MS)).toBe(false);
    expect(hintExplainsStop(hint, action, 1_000 + FORM_HINT_MAX_AGE_MS - 1)).toBe(true);
    expect(hintExplainsStop(hint, action, 500)).toBe(false); // a hint from the future is not one
  });

  it('a malformed action never matches', () => {
    expect(hintExplainsStop({ ...hint, action: 'not a url' }, 'not a url', 1_500)).toBe(false);
  });
});
