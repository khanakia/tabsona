import { describe, expect, it } from 'vitest';
import {
  applyCookies, cookieKey, defaultCookiePath, domainMatches, domainsOf, isExpired, pageCookieString, pageVisibleCookies, parseDocumentCookie,
  parseSetCookie, pathMatches, serializeCookieHeader,
} from '../cookies';
import type { CookieRecord } from '@/domain/types';

const base = (over: Partial<CookieRecord> = {}): CookieRecord => ({
  name: 'sid', value: 'abc', domain: 'example.com', hostOnly: true, path: '/',
  expiresAt: null, secure: false, httpOnly: false, sameSite: null, partitionKey: null,
  ...over,
});

describe('parseSetCookie', () => {
  it('reads name, value and every identity attribute', () => {
    const c = parseSetCookie(
      'sid=xyz; Domain=.example.com; Path=/app; Secure; HttpOnly; SameSite=Lax',
      'api.example.com',
    );
    expect(c).toMatchObject({
      name: 'sid', value: 'xyz', domain: 'example.com', hostOnly: false,
      path: '/app', secure: true, httpOnly: true, sameSite: 'lax',
    });
  });

  it('defaults domain to the request host and marks the cookie host-only', () => {
    // This distinction is what stops a cookie set for one host reaching its siblings.
    const c = parseSetCookie('sid=1', 'app.example.com');
    expect(c?.domain).toBe('app.example.com');
    expect(c?.hostOnly).toBe(true);
  });

  it('lets Max-Age win over Expires, per RFC 6265', () => {
    const c = parseSetCookie('a=b; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=60', 'h');
    expect(c?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('returns null when there is no name=value pair at all', () => {
    expect(parseSetCookie('HttpOnly; Secure', 'h')).toBeNull();
    expect(parseSetCookie('=novalue', 'h')).toBeNull();
    expect(parseSetCookie('', 'h')).toBeNull();
  });

  it('treats the FIRST pair as the cookie even when it is spelled like an attribute', () => {
    // Per RFC 6265 the leading attribute-value pair IS the cookie, so a header
    // beginning `Path=/` really does define a cookie named `Path`. A server would
    // never send that, but guessing otherwise would silently drop a real cookie
    // whose name happens to collide with an attribute name.
    expect(parseSetCookie('Path=/; HttpOnly', 'h')).toMatchObject({ name: 'Path', value: '/' });
  });

  it('accepts a cookie with an empty value, which is how servers delete one', () => {
    expect(parseSetCookie('sid=; Max-Age=0', 'h')).toMatchObject({ name: 'sid', value: '' });
  });

  it('keeps a partition key as part of the record', () => {
    expect(parseSetCookie('a=b', 'h', 'https://top.example')?.partitionKey)
      .toBe('https://top.example');
  });
});

describe('cookieKey', () => {
  it('treats same-name cookies on different paths as different cookies', () => {
    expect(cookieKey(base({ path: '/' }))).not.toBe(cookieKey(base({ path: '/admin' })));
  });

  it('treats same-name cookies in different partitions as different cookies', () => {
    // Under CHIPS one logical cookie exists per partition. Collapsing them is the
    // defect that presents to a user as random logouts.
    expect(cookieKey(base({ partitionKey: null })))
      .not.toBe(cookieKey(base({ partitionKey: 'https://a.test' })));
  });

  it('ignores domain case', () => {
    expect(cookieKey(base({ domain: 'EXAMPLE.com' }))).toBe(cookieKey(base({ domain: 'example.com' })));
  });
});

describe('applyCookies', () => {
  it('replaces a cookie with the same identity', () => {
    const jar = applyCookies([base({ value: 'old' })], [base({ value: 'new' })]);
    expect(jar).toHaveLength(1);
    expect(jar[0]?.value).toBe('new');
  });

  it('keeps cookies that differ only by path', () => {
    const jar = applyCookies([base({ path: '/' })], [base({ path: '/admin' })]);
    expect(jar).toHaveLength(2);
  });

  it('removes a cookie when the server sends an empty value (the logout shape)', () => {
    const jar = applyCookies([base({ value: 'live' })], [base({ value: '' })]);
    expect(jar).toEqual([]);
  });

  it('drops cookies that are already expired', () => {
    const jar = applyCookies([], [base({ expiresAt: Date.now() - 1 })]);
    expect(jar).toEqual([]);
  });

  it('evicts cookies that expired while sitting in the jar', () => {
    const stale = base({ name: 'stale', expiresAt: 1000 });
    const jar = applyCookies([stale], [], 2000);
    expect(jar).toEqual([]);
  });
});

describe('isExpired', () => {
  it('treats a null expiry as a session cookie that never expires on its own', () => {
    expect(isExpired(base({ expiresAt: null }), 9e12)).toBe(false);
  });
});

describe('domainMatches', () => {
  it('matches the exact host', () => {
    expect(domainMatches(base({ domain: 'example.com' }), 'example.com')).toBe(true);
  });

  it('refuses subdomains for a host-only cookie', () => {
    expect(domainMatches(base({ domain: 'example.com', hostOnly: true }), 'api.example.com')).toBe(false);
  });

  it('allows subdomains when Domain= was set', () => {
    expect(domainMatches(base({ domain: 'example.com', hostOnly: false }), 'api.example.com')).toBe(true);
  });

  it('does not match a suffix that is not a dot boundary', () => {
    expect(domainMatches(base({ domain: 'example.com', hostOnly: false }), 'notexample.com')).toBe(false);
  });
});

describe('pathMatches', () => {
  it.each([
    ['/', '/anything', true],
    ['/app', '/app', true],
    ['/app', '/app/sub', true],
    ['/app', '/application', false],
    ['/app/', '/app/sub', true],
  ])('path %s vs request %s -> %s', (cookiePath, requestPath, expected) => {
    expect(pathMatches(base({ path: cookiePath }), requestPath)).toBe(expected);
  });
});

describe('serializeCookieHeader', () => {
  it('emits only the cookies that may be sent to the url', () => {
    const jar = [
      base({ name: 'root', path: '/' }),
      base({ name: 'admin', path: '/admin' }),
      base({ name: 'other', domain: 'elsewhere.test' }),
    ];
    expect(serializeCookieHeader(jar, 'http://example.com/admin/x'))
      .toBe('admin=abc; root=abc');
  });

  it('orders longer paths first, so a specific cookie shadows a general one', () => {
    const jar = [base({ name: 'a', path: '/' }), base({ name: 'b', path: '/deep/er' })];
    expect(serializeCookieHeader(jar, 'http://example.com/deep/er')).toBe('b=abc; a=abc');
  });

  it('withholds Secure cookies from plain http', () => {
    const jar = [base({ name: 's', secure: true })];
    expect(serializeCookieHeader(jar, 'http://example.com/')).toBe('');
  });

  it('sends Secure cookies to localhost, which browsers treat as secure', () => {
    // This project is used mostly against localhost; getting it wrong would make
    // the tool useless exactly where it matters most.
    const jar = [base({ name: 's', secure: true, domain: 'localhost' })];
    expect(serializeCookieHeader(jar, 'http://localhost:8787/')).toBe('s=abc');
  });

  it('sends Secure cookies to a .localhost subdomain too', () => {
    const jar = [base({ name: 's', secure: true, domain: 'sync.localhost' })];
    expect(serializeCookieHeader(jar, 'https://sync.localhost/')).toBe('s=abc');
  });

  it('returns empty for a malformed url rather than throwing', () => {
    expect(serializeCookieHeader([base()], 'not a url')).toBe('');
  });

  it('returns empty for an empty jar, which is what forces a STRIP rule', () => {
    expect(serializeCookieHeader([], 'http://example.com/')).toBe('');
  });
});

describe('domainsOf', () => {
  it('lists each distinct domain once, sorted', () => {
    expect(domainsOf([base({ domain: 'b.test' }), base({ domain: 'a.test' }), base({ domain: 'A.test' })]))
      .toEqual(['a.test', 'b.test']);
  });
});

describe('document.cookie writes', () => {
  const url = 'https://accounts.example.com/signin/v3/identifier?x=1';

  it('defaults the path to the page directory, never to "/" unless the page is at the root', () => {
    expect(defaultCookiePath('/signin/v3/identifier')).toBe('/signin/v3');
    expect(defaultCookiePath('/page')).toBe('/');
    expect(defaultCookiePath('/')).toBe('/');
    expect(parseDocumentCookie('t=1', url)?.path).toBe('/signin/v3');
    expect(parseDocumentCookie('t=1; Path=/', url)?.path).toBe('/');
  });

  it('can never set HttpOnly from script', () => {
    expect(parseDocumentCookie('t=1; HttpOnly', url)?.httpOnly).toBe(false);
  });

  it('rejects a Domain that is not the page\'s own host or a parent of it', () => {
    expect(parseDocumentCookie('t=1; Domain=example.com', url)?.domain).toBe('example.com');
    expect(parseDocumentCookie('t=1; Domain=other.com', url)).toBeNull();
    expect(parseDocumentCookie('t=1; Domain=ample.com', url)).toBeNull();
  });

  it('rejects Secure from an insecure page, but accepts it on localhost', () => {
    expect(parseDocumentCookie('t=1; Secure', 'http://app.example.com/')).toBeNull();
    expect(parseDocumentCookie('t=1; Secure', 'http://localhost:8790/')?.secure).toBe(true);
  });

  it('an expiry in the past is a delete (empty value) that applyCookies then drops', () => {
    const jar = [base({ name: 't', value: '1', domain: 'accounts.example.com', path: '/' })];
    const del = parseDocumentCookie('t=1; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT', url);
    expect(del?.value).toBe('');
    expect(applyCookies(jar, del ? [del] : [])).toEqual([]);
  });

  it('withholds HttpOnly cookies from the page and honours path and host like a request would', () => {
    const jar = [
      base({ name: 'sid', value: 's', domain: 'accounts.example.com', httpOnly: true }),
      base({ name: 'js', value: '1', domain: 'accounts.example.com' }),
      base({ name: 'deep', value: '2', domain: 'accounts.example.com', path: '/nope' }),
    ];
    expect(pageCookieString(jar, url)).toBe('js=1');
    expect(pageVisibleCookies(jar).map((c) => c.name)).toEqual(['js', 'deep']);
  });
});
