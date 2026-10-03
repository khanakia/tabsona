// Capture a login out of an ORDINARY, un-isolated tab.
//
// The one genuinely new capability in v2, and the one that removes most of the
// friction: v1 could only capture inside a tab it already controlled, so every persona
// had to start from a signed-out tab and a fresh login. Now you sign into each app
// once, normally, and file each login where it belongs.
//
// Two reads, both legitimate and both needing nothing exotic:
//   - chrome.cookies.getAll({ url }) returns that origin's cookies INCLUDING HttpOnly,
//     given host permission. This is the browser's own jar.
//   - localStorage is readable by executeScript because an unbound tab has NO shim
//     rewriting it, so the real store is what `window.localStorage` already is.
//
// The browser's jar is READ, never modified: importing must not disturb the login the
// user is sitting in.

import { COOKIE_PROBE_TIMEOUT_MS } from '@/core/constants';
import type { CookieRecord, Origin, Site, StorageSlice, TabId } from '@/domain/types';

export interface ImportedLogin {
  readonly site: Site;
  readonly origin: Origin;
  /** Seeded from the page title: real app titles usually already carry the user or
   *  tenant ("Dashboard · Sync"), which makes a session self-labelling. */
  readonly title: string;
  readonly cookies: readonly CookieRecord[];
  readonly local: StorageSlice;
  readonly session: StorageSlice;
  readonly domains: readonly string[];
}

/** Translate Chrome's cookie shape into ours, preserving full identity. */
function toRecord(c: chrome.cookies.Cookie): CookieRecord {
  return {
    name: c.name,
    value: c.value,
    // Chrome reports a leading dot for domain cookies; `hostOnly` already carries
    // that meaning, so the dot is normalised away to match our parser's output.
    domain: c.domain.replace(/^\./, '').toLowerCase(),
    hostOnly: c.hostOnly,
    path: c.path,
    expiresAt: c.expirationDate === undefined ? null : Math.round(c.expirationDate * 1000),
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite === 'strict' ? 'strict'
      : c.sameSite === 'lax' ? 'lax'
        : c.sameSite === 'no_restriction' ? 'none'
          : null,
    partitionKey: c.partitionKey?.topLevelSite ?? null,
  };
}

/**
 * Discover which cookies a tab is actually sending.
 *
 * WHY NOT just `chrome.cookies.getAll`: on Chrome 154 it returns an EMPTY array for
 * every filter shape tried — `{url}`, `{domain}`, `{name}`, `{}`, promise and callback
 * form alike — while `chrome.cookies.get({url, name})` returns the very same cookie
 * complete with its HttpOnly flag. Measured directly against a live login, with the
 * `cookies` permission and the host permission both granted, and cross-checked against
 * CDP `Network.getCookies` which did see it. So enumeration is unavailable and lookup
 * by name is not.
 *
 * The way out: read the names off the tab's own outgoing `Cookie` header via
 * observational `webRequest` — the same survived-MV3 capability the rest of this engine
 * rests on — then look each one up for its full identity. A request is provoked with a
 * same-origin `fetch`, which is cheap and leaves the page untouched.
 *
 * Falls back to `getAll` first, so this costs nothing on a Chrome where it works.
 */
async function cookieNamesForTab(tabId: TabId, url: string): Promise<string[]> {
  const direct = await chrome.cookies.getAll({ url }).catch(() => []);
  if (direct.length > 0) return direct.map((c) => c.name);

  let origin: string;
  try { origin = new URL(url).origin; } catch { return []; }

  const names = await new Promise<string[]>((resolve) => {
    let settled = false;
    const finish = (result: string[]) => {
      if (settled) return;
      settled = true;
      try { chrome.webRequest.onBeforeSendHeaders.removeListener(listener); } catch { /* gone */ }
      resolve(result);
    };

    function listener(details: chrome.webRequest.OnBeforeSendHeadersDetails): undefined {
      if (details.tabId !== tabId) return undefined;
      const header = (details.requestHeaders ?? [])
        .find((h) => h.name.toLowerCase() === 'cookie')?.value;
      if (header === undefined) return undefined;
      finish(header
        .split(';')
        .map((part) => part.split('=')[0]?.trim() ?? '')
        .filter((name) => name.length > 0));
      return undefined;
    }

    try {
      chrome.webRequest.onBeforeSendHeaders.addListener(
        listener,
        { urls: [`${origin}/*`], types: ['xmlhttprequest'], tabId },
        ['requestHeaders', 'extraHeaders'],
      );
    } catch {
      resolve([]);
      return;
    }

    // Provoke one same-origin request so the header can be observed. `credentials`
    // is explicit because a cookie-less request would teach us nothing.
    void chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        void fetch(location.href, { method: 'GET', cache: 'no-store', credentials: 'include' })
          .catch(() => undefined);
      },
    }).catch(() => undefined);

    setTimeout(() => finish([]), COOKIE_PROBE_TIMEOUT_MS);
  });

  return names;
}

/**
 * Read everything a tab is currently signed in with.
 *
 * Returns null for a page that cannot hold a login (chrome://, about:) rather than an
 * empty result, so the caller can say "nothing to save here" instead of silently
 * creating a hollow session.
 */
export async function importLoginFromTab(tabId: TabId): Promise<ImportedLogin | null> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return null;

  let origin: string;
  try {
    const u = new URL(tab.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    origin = u.origin;
  } catch { return null; }

  // Names first, then one lookup each for full identity — see cookieNamesForTab.
  const names = await cookieNamesForTab(tabId, tab.url);
  const found = await Promise.all(names.map((name) =>
    chrome.cookies.get({ url: tab.url as string, name }).catch(() => null)));
  const cookies = found
    .filter((c): c is chrome.cookies.Cookie => c !== null)
    .map(toRecord);

  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const grab = (area: Storage): Record<string, string> => {
        const out: Record<string, string> = {};
        try {
          for (let i = 0; i < area.length; i++) {
            const k = area.key(i);
            if (k !== null) out[k] = area.getItem(k) ?? '';
          }
        } catch { /* storage blocked */ }
        return out;
      };
      return {
        title: document.title,
        local: grab(window.localStorage),
        session: grab(window.sessionStorage),
      };
    },
  }).catch(() => [{ result: null }] as const);

  const page = res?.result as { title: string; local: Record<string, string>; session: Record<string, string> } | null | undefined;

  return {
    site: origin,
    origin,
    title: page?.title ?? '',
    cookies,
    local: page?.local ?? {},
    session: page?.session ?? {},
    domains: [...new Set(cookies.map((c) => c.domain))].sort(),
  };
}

/** True when there is actually something worth saving. An import that found nothing
 *  must be reported, not filed as an empty session the user will later distrust. */
export function hasCredentials(login: ImportedLogin): boolean {
  return login.cookies.length > 0
    || Object.keys(login.local).length > 0
    || Object.keys(login.session).length > 0;
}
