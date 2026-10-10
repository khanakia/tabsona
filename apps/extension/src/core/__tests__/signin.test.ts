import { describe, expect, it } from 'vitest';
import { MAX_SIGNIN_CHAIN_HOSTS } from '../constants';
import {
  allSignInHosts, crossOriginRedirect, locationHeader, signInAlertsFor, withHop, withLandingHost,
  type SignInHops,
} from '../signin';

describe('crossOriginRedirect', () => {
  const APP = 'https://staging-app.example.com/auth/login';

  it('returns the provider origin for a redirect to another website', () => {
    // The AuthKit shape that leaked: the app's own login route 307s to the provider.
    expect(crossOriginRedirect(APP, 307, 'https://api.workos.com/user_management/authorize?x=1'))
      .toBe('https://api.workos.com');
  });

  it('ignores a same-origin hop, which the site permission already covers', () => {
    expect(crossOriginRedirect('https://staging-app.example.com/', 307, '/auth/login')).toBeNull();
    expect(crossOriginRedirect(APP, 302, 'https://staging-app.example.com/home')).toBeNull();
  });

  it('resolves a relative Location against the request the way the browser does', () => {
    expect(crossOriginRedirect(APP, 302, '//idp.example.net/authorize')).toBe('https://idp.example.net');
  });

  it('treats a different port as a different website', () => {
    expect(crossOriginRedirect('http://localhost:8790/sso/start', 302, 'http://127.0.0.1:8790/idp/authorize'))
      .toBe('http://127.0.0.1:8790');
  });

  it('ignores non-redirects, a missing Location, non-web schemes and garbage', () => {
    expect(crossOriginRedirect(APP, 200, 'https://api.workos.com/')).toBeNull();
    expect(crossOriginRedirect(APP, 404, 'https://api.workos.com/')).toBeNull();
    expect(crossOriginRedirect(APP, 302, undefined)).toBeNull();
    expect(crossOriginRedirect(APP, 302, '')).toBeNull();
    expect(crossOriginRedirect(APP, 302, 'myapp://callback')).toBeNull();
    expect(crossOriginRedirect('not a url', 302, 'https://x.example/')).toBeNull();
  });
});

describe('locationHeader', () => {
  it('finds Location whatever its case', () => {
    expect(locationHeader([{ name: 'Set-Cookie', value: 'a=1' }, { name: 'location', value: '/x' }])).toBe('/x');
    expect(locationHeader([{ name: 'LOCATION', value: '/y' }])).toBe('/y');
  });

  it('returns undefined when there is none', () => {
    expect(locationHeader(undefined)).toBeUndefined();
    expect(locationHeader([{ name: 'Content-Type', value: 'text/html' }])).toBeUndefined();
  });
});

describe('withHop', () => {
  it('adds a hop under its site, sorted', () => {
    const a = withHop({}, 'https://app.example', 'https://b.example');
    const b = withHop(a, 'https://app.example', 'https://a.example');
    expect(b).toEqual({ 'https://app.example': ['https://a.example', 'https://b.example'] });
  });

  it('returns the SAME map for a hop it already holds, so callers can tell nothing changed', () => {
    const a = withHop({}, 'https://app.example', 'https://b.example');
    expect(withHop(a, 'https://app.example', 'https://b.example')).toBe(a);
  });

  it('never mutates its input', () => {
    const a = withHop({}, 'https://app.example', 'https://b.example');
    withHop(a, 'https://app.example', 'https://c.example');
    expect(a).toEqual({ 'https://app.example': ['https://b.example'] });
  });
});

describe('signInAlertsFor — a sign-in CHAIN, filed under the app', () => {
  // The measured chain: app → api.workos.com → auth.franchiseatlas.ai → *.authkit.app.
  // Every hop is recorded under the app's site, so all of them reach the app's alert.
  const APP = 'https://staging-app.example.com';
  const hops = {
    [APP]: ['https://api.workos.com', 'https://auth.example.ai', 'https://tea.authkit.app'],
    'https://other.example.com': ['https://login.other.example'],
  };

  it('lists every host of an open app, and nothing for an app with no open tab', () => {
    expect(signInAlertsFor(hops, [APP])).toEqual([
      { site: APP, hosts: ['https://api.workos.com', 'https://auth.example.ai', 'https://tea.authkit.app'] },
    ]);
  });

  it('gives one alert per app however many of its tabs are open, in a stable order', () => {
    const alerts = signInAlertsFor(hops, ['https://other.example.com', APP, APP]);
    expect(alerts.map((a) => a.site)).toEqual(['https://other.example.com', APP]);
  });

  it('drops an app whose sign-in never left it', () => {
    expect(signInAlertsFor(hops, ['https://quiet.example.com'])).toEqual([]);
  });
});

describe('allSignInHosts', () => {
  it('is every distinct host once, sorted — one permission prompt for the lot', () => {
    expect(allSignInHosts([
      { site: 'https://a.example', hosts: ['https://idp.example', 'https://api.workos.com'] },
      { site: 'https://b.example', hosts: ['https://api.workos.com'] },
    ])).toEqual(['https://api.workos.com', 'https://idp.example']);
    expect(allSignInHosts([])).toEqual([]);
  });
});

describe('withLandingHost — the provider page a signed-out tab ends on', () => {
  const APP = 'https://staging-app.example.com';

  it('adds the page the tab sits on, under the app', () => {
    expect(withLandingHost({ [APP]: ['https://api.workos.com'] }, APP, 'https://tea.authkit.app'))
      .toEqual({ [APP]: ['https://api.workos.com', 'https://tea.authkit.app'] });
  });

  it('adds nothing for a tab on its own site or on no website', () => {
    const hops = { [APP]: ['https://api.workos.com'] };
    expect(withLandingHost(hops, APP, APP)).toBe(hops);
    expect(withLandingHost(hops, APP, null)).toBe(hops);
  });
});

describe('withHop — the persistent chain is bounded', () => {
  it('stops growing at MAX_SIGNIN_CHAIN_HOSTS for one site, and leaves other sites alone', () => {
    let hops: SignInHops = {};
    for (let i = 0; i < MAX_SIGNIN_CHAIN_HOSTS + 5; i++) hops = withHop(hops, 'https://app', `https://h${i}.example`);
    expect(hops['https://app']).toHaveLength(MAX_SIGNIN_CHAIN_HOSTS);
    const more = withHop(hops, 'https://other', 'https://x.example');
    expect(more['https://other']).toEqual(['https://x.example']);
  });
});
