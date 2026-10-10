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
import { crossOriginRedirect, locationHeader } from '@/core/signin';
import { leakWindowFor } from '@/core/gate';
import { loadBindings, loadLeakWindows, loadLibrary, loadPassThroughHosts, mutateSession, noteSignInHop } from './repo';
import { noteUnguardedRedirect } from './gate';
import { accessPatterns, ungrantedOrigins } from './permissions';
import { renderBadge } from './badge';
import { syncRules } from './rules-sync';
import { pushCookiesToSessionTabs } from './pagecookies';
import { noteCookiesSeen } from './observations';
import { dropPassThrough } from './passthrough';
import { urlIsPassThrough } from '@/core/passthrough';
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

/**
 * Captures started and not yet finished. The page-side request barrier (content/shim.ts)
 * asks the worker to answer only when this is empty, so a request the page sends right
 * after a response that set a cookie waits until that cookie's rule is in force. Worker
 * memory on purpose: it describes work in flight in THIS worker, and is empty by
 * construction after a teardown, which is exactly when nothing is in flight.
 */
const inflight = new Set<Promise<void>>();

/** Resolves once every capture in flight, and any that start meanwhile, has finished. */
export async function whenCapturesSettled(): Promise<void> {
  while (inflight.size > 0) await Promise.allSettled([...inflight]);
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
  const hop = crossOriginRedirect(details.url, details.statusCode, locationHeader(details.responseHeaders));
  if (incoming.length === 0 && hop === null) return undefined;

  const work = (async () => {
    // One round of reads, not two in sequence: the time between a response and its cookie
    // rule being in force is the engine's known race, so this path adds no extra step.
    const [bindings, passThroughHosts] = await Promise.all([loadBindings(), loadPassThroughHosts()]);
    const sessionId = bindings[String(details.tabId)];
    if (!sessionId) return; // unbound tab: leave the shared jar alone

    // Watched HERE because this is the last response we are allowed to see: the next one
    // comes from a host with no permission, which no listener of ours receives and no
    // header rule of ours touches. See core/signin.ts for the leak this surfaces.
    //
    // Filed under the SESSION's site, not under `origin`: in a chain the responding host
    // is often a provider (api.workos.com → auth.franchiseatlas.ai), and a hop filed
    // under it was never read, so the warning disappeared after the first Allow.
    if (hop !== null && (await dropPassThrough(await ungrantedOrigins([hop]))).length > 0) {
      const site = (await loadLibrary()).sessions.find((s) => s.id === sessionId)?.site;
      if (site && await noteSignInHop(site, hop)) await renderBadge(details.tabId);
      await noteUnguardedRedirect(details.tabId, hop, details.type);
    }
    if (incoming.length === 0) return;

    // A website the user chose to reach with their normal login: the strip rule does not
    // apply there, so its cookies belong to the browser's jar and none is the persona's to
    // save. (A redirect it sends elsewhere was still noted above.)
    if (urlIsPassThrough(passThroughHosts, details.url)) return;

    // NEVER SAVE A LEAKED LOGIN. While the tab is inside a leak window it has just passed
    // through a website Tabsona may not touch, carrying the browser's own login there, so
    // what comes back may be the browser's user. Saving it would make the persona that
    // user from then on, silently. Instead the session is MARKED and the cookies dropped;
    // the strip rule has already kept them out of the browser's jar, so they go nowhere.
    const leak = leakWindowFor(await loadLeakWindows(), details.tabId, Date.now());
    if (leak !== null) {
      await mutateSession(sessionId, (session) => {
        session.leakedThrough = { hosts: [...leak], at: Date.now() };
      });
      await renderBadge(details.tabId);
      return;
    }

    const changed = await mutateSession(sessionId, (session) => {
      session.cookies = applyCookies(session.cookies, incoming);
      session.domains = [...new Set([...session.domains, host.toLowerCase()])].sort();
      session.savedAt = Date.now();
      session.lastUsedAt = Date.now();
    });
    if (!changed) return;
    noteCookiesSeen(origin);
    await syncRules();
    await pushCookiesToSessionTabs(sessionId);
  })();
  const tracked = work.catch((err: unknown) => console.error('[tabsona] capture failed:', err));
  inflight.add(tracked);
  void tracked.finally(() => inflight.delete(tracked));

  return undefined;
}

export async function registerCapture(): Promise<void> {
  try { chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived); }
  catch { /* not registered yet */ }

  const urls = await accessPatterns();
  if (urls.length === 0) return;

  chrome.webRequest.onHeadersReceived.addListener(
    onHeadersReceived,
    { urls, types: [...CAPTURE_RESOURCE_TYPES] },
    ['responseHeaders', 'extraHeaders'],
  );
}
