// Pure cookie logic. Imports the domain model and nothing else — no chrome.*, no
// storage — so every rule below is unit-testable in Node with zero mocks.

import { LOCALHOST_HOST, LOCALHOST_SUFFIX, SECURE_PROTOCOL } from './constants';
import type { CookieRecord } from '@/domain/types';

/** A cookie's identity, as a comparable string. Two records with the same key are
 *  the same cookie and must replace each other; different keys must coexist. */
export function cookieKey(c: Pick<CookieRecord, 'name' | 'domain' | 'path' | 'partitionKey'>): string {
  return `${c.name}\u0000${c.domain.toLowerCase()}\u0000${c.path}\u0000${c.partitionKey ?? ''}`;
}

/**
 * Parse one raw `Set-Cookie` header value into a record, preserving every
 * attribute that is part of identity or lifetime.
 *
 * `requestHost` supplies the default domain when the header omits `Domain=`, which
 * also makes the cookie host-only: it must NOT be sent to subdomains. Collapsing
 * that distinction is how a cookie set for `app.example.com` wrongly reaches
 * `other.example.com`.
 *
 * Returns null for a header that carries no `name=value` pair.
 */
export function parseSetCookie(
  raw: string,
  requestHost: string,
  partitionKey: string | null = null,
): CookieRecord | null {
  const parts = String(raw).split(';');
  const first = parts[0] ?? '';
  const eq = first.indexOf('=');
  if (eq <= 0) return null;

  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return null;

  let domain: string | null = null;
  let path = '/';
  let expiresAt: number | null = null;
  let maxAgeSeconds: number | null = null;
  let secure = false;
  let httpOnly = false;
  let sameSite: CookieRecord['sameSite'] = null;

  for (const attr of parts.slice(1)) {
    const i = attr.indexOf('=');
    const key = (i === -1 ? attr : attr.slice(0, i)).trim().toLowerCase();
    const val = i === -1 ? '' : attr.slice(i + 1).trim();
    switch (key) {
      case 'domain':
        // A leading dot is legacy syntax for "and subdomains"; normalise it away
        // and let hostOnly=false carry that meaning instead.
        domain = val.replace(/^\./, '').toLowerCase() || null;
        break;
      case 'path':
        if (val) path = val;
        break;
      case 'expires': {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) expiresAt = t;
        break;
      }
      case 'max-age': {
        const n = Number(val);
        if (Number.isFinite(n)) maxAgeSeconds = n;
        break;
      }
      case 'secure':
        secure = true;
        break;
      case 'httponly':
        httpOnly = true;
        break;
      case 'samesite': {
        const s = val.toLowerCase();
        if (s === 'strict' || s === 'lax' || s === 'none') sameSite = s;
        break;
      }
      default:
        break; // unknown attributes are not ours to interpret
    }
  }

  // Max-Age wins over Expires per RFC 6265 §5.3.
  if (maxAgeSeconds !== null) expiresAt = Date.now() + maxAgeSeconds * 1000;

  return {
    name,
    value,
    domain: domain ?? requestHost.toLowerCase(),
    hostOnly: domain === null,
    path,
    expiresAt,
    secure,
    httpOnly,
    sameSite,
    partitionKey,
  };
}

/** True when a cookie has been expired or explicitly deleted (empty value with a
 *  past expiry is the conventional delete, and servers also just send value=""). */
export function isExpired(c: CookieRecord, now: number = Date.now()): boolean {
  if (c.expiresAt !== null && c.expiresAt <= now) return true;
  return false;
}

/**
 * Apply freshly-observed cookies to a jar, replacing by identity and dropping
 * anything expired or deleted.
 *
 * Deletion rule: a `Set-Cookie` with an empty value is how servers clear a cookie
 * (the fixture's logout does exactly this), so an empty value removes the record
 * rather than storing an empty one that would then be replayed.
 */
export function applyCookies(
  jar: readonly CookieRecord[],
  incoming: readonly CookieRecord[],
  now: number = Date.now(),
): CookieRecord[] {
  const byKey = new Map(jar.map((c) => [cookieKey(c), c]));
  for (const c of incoming) {
    const key = cookieKey(c);
    if (c.value === '' || isExpired(c, now)) byKey.delete(key);
    else byKey.set(key, c);
  }
  return [...byKey.values()].filter((c) => !isExpired(c, now));
}

/** RFC 6265 §5.1.3 domain match, honouring host-only cookies. */
export function domainMatches(cookie: CookieRecord, host: string): boolean {
  const h = host.toLowerCase();
  const d = cookie.domain.toLowerCase();
  if (h === d) return true;
  if (cookie.hostOnly) return false;
  return h.endsWith(`.${d}`);
}

/** RFC 6265 §5.1.4 path match. */
export function pathMatches(cookie: CookieRecord, requestPath: string): boolean {
  const p = requestPath || '/';
  if (cookie.path === p) return true;
  if (!p.startsWith(cookie.path)) return false;
  return cookie.path.endsWith('/') || p[cookie.path.length] === '/';
}

/**
 * Select the cookies that may be sent to one URL and serialize them into a
 * `Cookie` request header.
 *
 * Ordering follows RFC 6265 §5.4: longer paths first, so a more specific cookie
 * shadows a general one the way a browser would. Secure cookies are withheld from
 * plain HTTP, except on localhost, which browsers treat as a secure context and
 * which is where this tool is used most.
 */
export function serializeCookieHeader(
  jar: readonly CookieRecord[],
  url: string,
  now: number = Date.now(),
): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  const host = parsed.hostname;
  const isSecureContext = parsed.protocol === SECURE_PROTOCOL
    || host === LOCALHOST_HOST
    || host.endsWith(LOCALHOST_SUFFIX);

  return jar
    .filter((c) => !isExpired(c, now))
    .filter((c) => domainMatches(c, host))
    .filter((c) => pathMatches(c, parsed.pathname))
    .filter((c) => !c.secure || isSecureContext)
    .sort((a, b) => b.path.length - a.path.length)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** Every distinct host a jar holds cookies for; feeds a session's domain set. */
export function domainsOf(jar: readonly CookieRecord[]): string[] {
  return [...new Set(jar.map((c) => c.domain.toLowerCase()))].sort();
}
