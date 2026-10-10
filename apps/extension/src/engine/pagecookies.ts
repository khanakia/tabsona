// The chrome.* half of PAGE cookies: what `document.cookie` writes and reads in a bound
// tab. The decisions (what a write stores, what a read may see) are in core/cookies.ts.
//
// WHY it exists, from the user's Google sign-in inside a persona: Google writes a test
// cookie from page script, and from an XHR response, and shows "Cookies are disabled"
// unless both come straight back. In a bound tab the Cookie header is rebuilt from the
// SESSION's jar, but a `document.cookie` write went to the browser's SHARED jar (never
// sent, since the header is stripped, and visible to every plain tab), and a read returned
// the shared jar's cookies (the browser's own, not the persona's). So the session never
// heard of the page's cookie and the check failed. The shim now keeps a page-side jar
// (content/shim.ts); this file keeps the session's copy and the rules in step with it.

import { applyCookies, pageVisibleCookies, parseDocumentCookie } from '@/core/cookies';
import { leakWindowFor } from '@/core/gate';
import { loadBindings, loadLeakWindows, loadLibrary, mutateSession } from './repo';
import { syncRules } from './rules-sync';
import type { SessionId, TabId } from '@/domain/types';

/**
 * Store a cookie page script just wrote in `tabId`, and install its rule before returning.
 *
 * Validated, not trusted: the url must be the sender's own origin (a page cannot write
 * cookies for another site into the session), the tab must be bound, and nothing is saved
 * inside a leak window (the page may be holding the browser's user, see engine/capture.ts).
 * Returns once the rule is IN FORCE, because the shim holds the page's next request until
 * then.
 */
export async function pageWroteCookie(
  tabId: TabId, senderUrl: string | undefined, url: string, line: string,
): Promise<void> {
  const sessionId = (await loadBindings())[String(tabId)];
  if (!sessionId || typeof url !== 'string' || typeof line !== 'string') return;
  try {
    if (new URL(url).origin !== new URL(senderUrl ?? '').origin) return;
  } catch { return; }
  if (leakWindowFor(await loadLeakWindows(), tabId, Date.now()) !== null) return;

  const record = parseDocumentCookie(line, url);
  if (!record) return;
  const changed = await mutateSession(sessionId, (session) => {
    session.cookies = applyCookies(session.cookies, [record]);
    session.domains = [...new Set([...session.domains, record.domain.toLowerCase()])].sort();
    session.savedAt = Date.now();
    session.lastUsedAt = Date.now();
  });
  if (!changed) return;
  await syncRules();
  await pushCookiesToSessionTabs(sessionId, tabId);
}

/**
 * Hand a tab its session's page-visible cookies, through the shim's handle (which also
 * mirrors them for the next page load). False when the tab has no shim for this session.
 * HttpOnly cookies are filtered out HERE, so they never become readable by page script.
 */
export async function pushCookiesToTab(tabId: TabId, sessionId: SessionId): Promise<boolean> {
  const session = (await loadLibrary()).sessions.find((s) => s.id === sessionId);
  if (!session) return false;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [sessionId, pageVisibleCookies(session.cookies)],
    func: (wanted: string, cookies: unknown[]) => {
      const handle = (window as {
        __tabsonaSession?: { id: string; setCookies: (c: unknown[]) => boolean };
      }).__tabsonaSession;
      if (!handle || handle.id !== wanted) return false;
      try { return handle.setCookies(cookies); } catch { return false; }
    },
  }).catch(() => [{ result: false }] as const);
  return result?.result === true;
}

/** Push to every tab bound to `sessionId`, optionally skipping the one that wrote. */
export async function pushCookiesToSessionTabs(sessionId: SessionId, exceptTabId?: TabId): Promise<void> {
  const bindings = await loadBindings();
  const tabIds = Object.entries(bindings)
    .filter(([, sid]) => sid === sessionId)
    .map(([id]) => Number(id))
    .filter((id) => id !== exceptTabId);
  await Promise.all(tabIds.map((id) => pushCookiesToTab(id, sessionId).catch(() => false)));
}
