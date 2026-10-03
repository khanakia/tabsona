// The READ half of cookie isolation.
//
// declarativeNetRequest can set or remove a header but can NEVER read one, so the only
// way to learn a session's cookies without attaching a debugger is here:
// chrome.webRequest.onHeadersReceived, registered NON-BLOCKING with 'extraHeaders'.
// MV3 removed *blocking* webRequest; observation survived, and it still delivers the
// raw Set-Cookie value including HttpOnly, tagged with the exact details.tabId.
// Verified by execution — docsi/SPIKE_RESULTS.md.

import { CAPTURE_RESOURCE_TYPES } from '@/core/constants';
import { applyCookies, parseSetCookie } from '@/core/cookies';
import { loadBindings, mutateSession } from './repo';
import { grantedOriginPatterns } from './permissions';
import { syncRules } from './rules-sync';
import { noteCookiesSeen } from './observations';
import type { CookieRecord } from '@/domain/types';

function extractSetCookies(
  headers: chrome.webRequest.HttpHeader[] | undefined,
  requestHost: string,
): CookieRecord[] {
  const out: CookieRecord[] = [];
  for (const h of headers ?? []) {
    if (h.name.toLowerCase() !== 'set-cookie' || !h.value) continue;
    // One header object can carry several cookies joined by newlines.
    for (const line of h.value.split('\n')) {
      const parsed = parseSetCookie(line, requestHost);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

function onHeadersReceived(
  details: chrome.webRequest.OnHeadersReceivedDetails,
): chrome.webRequest.BlockingResponse | undefined {
  // Non-blocking listener: it must ALWAYS return undefined. Returning a
  // BlockingResponse would need the blocking permission MV3 removed.
  if (details.tabId < 0) return undefined; // worker or prefetch: not attributable

  let host: string;
  let origin: string;
  try {
    const u = new URL(details.url);
    host = u.hostname;
    origin = u.origin;
  } catch { return undefined; }

  const incoming = extractSetCookies(details.responseHeaders, host);
  if (incoming.length === 0) return undefined;

  void (async () => {
    const bindings = await loadBindings();
    const sessionId = bindings[String(details.tabId)];
    if (!sessionId) return; // unbound tab: leave the shared jar alone

    const changed = await mutateSession(sessionId, (session) => {
      session.cookies = applyCookies(session.cookies, incoming);
      session.domains = [...new Set([...session.domains, host.toLowerCase()])].sort();
      session.savedAt = Date.now();
      session.lastUsedAt = Date.now();
    });
    if (!changed) return;
    noteCookiesSeen(origin);
    await syncRules();
  })();

  return undefined;
}

export async function registerCapture(): Promise<void> {
  try { chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived); }
  catch { /* not registered yet */ }

  const urls = await grantedOriginPatterns();
  if (urls.length === 0) return;

  chrome.webRequest.onHeadersReceived.addListener(
    onHeadersReceived,
    { urls, types: [...CAPTURE_RESOURCE_TYPES] },
    ['responseHeaders', 'extraHeaders'],
  );
}
