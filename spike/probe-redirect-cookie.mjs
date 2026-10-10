// Probe: can a cookie set on a 302 reach the follow-up request inside an isolated tab?
//
// WHY: Google's sign-in fails in a persona tab with "Cookies are disabled". The working
// theory is that a Set-Cookie on a redirect cannot reach the very next request, because
// the DNR engine learns the cookie by observation and installs the rule after Chrome has
// already issued the follow-up. This probe compares the engines below on the same
// Google-shaped redirect chain, each as a minimal throwaway extension (not the product).
// What it proves (Chrome 154): the DNR model and the DNR-plus-debugger barrier both pass
// 0/10, because Chrome applies DNR header changes before a DevTools Fetch pause; only an
// engine that writes the Cookie header itself through the debugger passes (10/10), and
// cookie swapping passes but leaks both ways. Run it again after a Chrome upgrade.
//
//   dnr      the product's model: strip Cookie/Set-Cookie per tab, learn Set-Cookie from
//            non-blocking webRequest, then updateSessionRules with a `set Cookie` rule
//   debugger chrome.debugger + Fetch domain: pause each request, write Cookie from a jar
//            learned through Network.responseReceivedExtraInfo
//   hybrid   debugger as above + the DNR rule that strips Set-Cookie (shared jar stays clean)
//   barrier  DNR as above, debugger only to HOLD the follow-up until the rule is in
//   dbgprobe one-off questions (createBrowserContext, Cookie replace-or-merge)
//   swap     cookie swapping: the persona's cookies live in the REAL jar while its tab
//            works (chrome.cookies.set in, chrome.cookies.remove out); measures the race
//            with a plain tab polling the same site
//
// The chain (/c1 -> /c2 -> /c3) sets a cookie on each 302 and requires every earlier one
// on the next hop, like accounts.google.com's CheckCookie hop. A control run with no
// extension shows the chain passes in a plain browser.
//
// Headless, throwaway profile, its own ports. Run: node spike/probe-redirect-cookie.mjs

import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, openPage, sleep } from './lib/cdp.mjs';

const PORT = 8795;
const ORIGIN = `http://localhost:${PORT}`;
const DEBUG_PORT = 9531;

// ---------------------------------------------------------------- fixture server
const seen = []; // every request: { path, cookie, t }
const outcome = new Map(); // n -> { host, ok } recorded at /c2 (fail) or /c3
const server = http.createServer((req, res) => {
  const u = new URL(req.url, ORIGIN);
  const cookie = req.headers.cookie ?? '';
  seen.push({ path: u.pathname, cookie, t: Date.now() });
  const jar = Object.fromEntries(cookie.split(/;\s*/).filter(Boolean).map((p) => p.split('=')));
  const n = u.searchParams.get('n') ?? 'x';
  const hop = (status, loc, setCookies) => {
    res.writeHead(status, { Location: loc, 'Set-Cookie': setCookies, 'Cache-Control': 'no-store' });
    res.end();
  };
  const page = (obj) => {
    outcome.set(n, { host: req.headers.host, ...obj });
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><title>${obj.ok ? 'OK' : 'REJECTED'}</title><pre id=r>${JSON.stringify(obj)}</pre>`);
  };
  switch (u.pathname) {
    // Each hop sets a cookie on the 302 and requires the previous one.
    case '/c1': return hop(302, `/c2?n=${n}`, [`a=${n}; Path=/; HttpOnly; SameSite=Lax`]);
    case '/c2':
      if (jar.a !== n) return page({ ok: false, at: 'c2', missing: 'a', cookie });
      return hop(302, `/c3?n=${n}`, [`b=${n}; Path=/; HttpOnly; SameSite=Lax`]);
    case '/c3':
      if (jar.a !== n || jar.b !== n) return page({ ok: false, at: 'c3', cookie });
      return page({ ok: true, at: 'c3', cookie });
    case '/frame': // cross-site iframe (localhost -> 127.0.0.1 is an out-of-process frame) running the chain
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      return res.end(`<!doctype html><title>frame</title><iframe src="http://127.0.0.1:${PORT}/c1?n=${n}"></iframe>`);
    case '/plant': // a "browser login" in the shared jar
      res.writeHead(200, { 'Set-Cookie': 'browser=me; Path=/', 'Content-Type': 'text/plain' });
      return res.end('planted');
    case '/echo':
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ cookie }));
    default:
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<!doctype html><title>home</title>home');
  }
});
await new Promise((r) => server.listen(PORT, r));

// ---------------------------------------------------------------- probe extensions
const MANIFEST = (perms) => JSON.stringify({
  manifest_version: 3, name: 'probe', version: '0.0.1',
  background: { service_worker: 'background.js' },
  permissions: perms,
  host_permissions: [`${ORIGIN}/*`, `http://127.0.0.1:${PORT}/*`],
});

const COMMON = `
const ORIGIN = ${JSON.stringify(ORIGIN)};
const jar = new Map(); // tabId -> Map(name -> value); in memory: a probe, not the product
const parse = (sc) => { const [nv] = sc.split(';'); const i = nv.indexOf('='); return [nv.slice(0, i).trim(), nv.slice(i + 1).trim()]; };
const cookieHeader = (tabId) => [...(jar.get(tabId) ?? new Map())].map(([k, v]) => k + '=' + v).join('; ');
globalThis.log = [];
`;

const DNR_BG = `${COMMON}
// Without resourceTypes a DNR rule skips main_frame, which is the whole redirect chain here.
const RT = ['main_frame','sub_frame','xmlhttprequest','other','script','image','stylesheet','font','media','ping','websocket'];
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));
async function writeRule(tabId) {
  const h = cookieHeader(tabId);
  await serial(() => chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [2],
    addRules: h ? [{ id: 2, priority: 2,
      condition: { tabIds: [tabId], urlFilter: '|' + ORIGIN, resourceTypes: RT },
      action: { type: 'modifyHeaders',
        requestHeaders: [{ header: 'cookie', operation: 'set', value: h }],
        responseHeaders: [{ header: 'set-cookie', operation: 'remove' }] } }] : [],
  }));
}
globalThis.bind = async (tabId) => {
  jar.set(tabId, new Map());
  await serial(() => chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{ id: 1, priority: 1,
      condition: { tabIds: [tabId], urlFilter: '|http', resourceTypes: RT },
      action: { type: 'modifyHeaders',
        requestHeaders: [{ header: 'cookie', operation: 'remove' }],
        responseHeaders: [{ header: 'set-cookie', operation: 'remove' }] } }],
  }));
  return 'bound';
};
chrome.webRequest.onHeadersReceived.addListener((d) => {
  globalThis.seenWR = (globalThis.seenWR ?? 0) + 1; globalThis.lastTab = d.tabId;
  if (!jar.has(d.tabId)) return;
  const sc = (d.responseHeaders ?? []).filter((h) => h.name.toLowerCase() === 'set-cookie');
  if (!sc.length) return;
  for (const h of sc) for (const line of h.value.split('\\n')) { const [k, v] = parse(line); jar.get(d.tabId).set(k, v); }
  const t0 = performance.now();
  writeRule(d.tabId).then(() => log.push({ url: d.url, ruleMs: +(performance.now() - t0).toFixed(1) }));
}, { urls: [ORIGIN + '/*'] }, ['responseHeaders', 'extraHeaders']);
`;

// Debugger engines. Findings that shaped them (earlier runs of this probe):
//  - Fetch.requestPaused at the Response stage NEVER lists Set-Cookie in responseHeaders,
//    so the cookie must come from Network.responseReceivedExtraInfo (raw, HttpOnly
//    included).
//  - Fetch.continueResponse with headers only is refused ("both should be provided"), and
//    answering the response with Fetch.fulfillRequest minus Set-Cookie does NOT keep the
//    cookie out of the shared jar: the network stack has stored it before the pause.
//  - Fetch.continueRequest with NO Cookie header lets Chrome attach the shared jar's
//    cookies; WITH a Cookie header, that header replaces the jar's entirely.
//  - For a redirect, extraInfo can arrive after the redirect's own response pause; what is
//    guaranteed is that the FOLLOW-UP request is paused, so the follow-up waits there for
//    the previous hop's extraInfo (same networkId across a redirect chain).
// So only the Request stage is intercepted. `withDnrStrip` adds the product's priority-1
// DNR rule that removes Set-Cookie from responses, which is what keeps the shared jar clean.
const debuggerBg = (withDnrStrip) => `${COMMON}
const stats = { requestStage: 0, waitedForExtra: 0, waitTimeouts: 0, errors: [], pauseMs: [] };
globalThis.stats = stats;
const extraCount = new Map(); // networkId -> extraInfo events seen (one per response in the chain)
const extraWaiters = new Map();
const RT = ['main_frame','sub_frame','xmlhttprequest','other','script','image','stylesheet','font','media','ping','websocket'];
globalThis.bind = async (tabId) => {
  jar.set(tabId, new Map());
  if (${withDnrStrip}) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1], addRules: [{ id: 1, priority: 1,
    condition: { tabIds: [tabId], urlFilter: '|http', resourceTypes: RT },
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'cookie', operation: 'remove' }],
      responseHeaders: [{ header: 'set-cookie', operation: 'remove' }] } }] });
  await chrome.debugger.attach({ tabId }, '1.3');
  await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {});
  await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', { patterns: PATTERNS });
  // Cross-site iframes are separate targets; without auto-attach Fetch never sees them.
  await chrome.debugger.sendCommand({ tabId }, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  return 'bound';
};
const PATTERNS = [{ urlPattern: 'http://localhost:${PORT}/*', requestStage: 'Request' }, { urlPattern: 'http://127.0.0.1:${PORT}/*', requestStage: 'Request' }];
globalThis.attached = [];
chrome.debugger.onEvent.addListener(async (src, method, p) => {
  const tabId = src.tabId;
  const t = src.sessionId ? { tabId, sessionId: src.sessionId } : { tabId };
  if (method === 'Target.attachedToTarget') {
    const child = { tabId, sessionId: p.sessionId };
    attached.push(p.targetInfo.type + ' ' + p.targetInfo.url);
    try {
      await chrome.debugger.sendCommand(child, 'Network.enable', {});
      await chrome.debugger.sendCommand(child, 'Fetch.enable', { patterns: PATTERNS });
      await chrome.debugger.sendCommand(child, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    } catch (e) { stats.errors.push('child: ' + (e.message ?? e)); }
    try { await chrome.debugger.sendCommand(child, 'Runtime.runIfWaitingForDebugger', {}); } catch { /* not waiting */ }
    return;
  }
  if (method === 'Network.responseReceivedExtraInfo') {
    for (const [k, v] of Object.entries(p.headers)) if (k.toLowerCase() === 'set-cookie')
      for (const line of v.split('\\n')) { const [n, val] = parse(line); jar.get(tabId)?.set(n, val); }
    extraCount.set(p.requestId, (extraCount.get(p.requestId) ?? 0) + 1);
    for (const r of extraWaiters.get(p.requestId) ?? []) r();
    extraWaiters.delete(p.requestId);
    return;
  }
  if (method !== 'Fetch.requestPaused') return;
  const t0 = performance.now();
  try {
    stats.requestStage++;
    if (p.redirectedRequestId) {
      // n-th request in the chain needs n-1 extraInfo events (one per redirect response).
      const hops = (globalThis.hops ??= new Map());
      const need = (hops.get(p.networkId) ?? 0) + 1;
      hops.set(p.networkId, need);
      if ((extraCount.get(p.networkId) ?? 0) < need) {
        stats.waitedForExtra++;
        const ok = await new Promise((res) => {
          const to = setTimeout(() => res(false), 500);
          extraWaiters.set(p.networkId, [...(extraWaiters.get(p.networkId) ?? []), () => { clearTimeout(to); res(true); }]);
        });
        if (!ok) stats.waitTimeouts++;
      }
    }
    const headers = Object.entries(p.request.headers)
      .filter(([k]) => k.toLowerCase() !== 'cookie')
      .map(([name, value]) => ({ name, value }));
    const c = cookieHeader(tabId);
    headers.push({ name: 'Cookie', value: c }); // explicit, even when empty
    log.push({ url: p.request.url, sentCookie: c, pageCookie: p.request.headers.Cookie ?? null });
    await chrome.debugger.sendCommand(t, 'Fetch.continueRequest', { requestId: p.requestId, headers });
  } catch (e) {
    stats.errors.push(String(e.message ?? e));
    try { await chrome.debugger.sendCommand(t, 'Fetch.continueRequest', { requestId: p.requestId }); } catch { /* gone */ }
  } finally {
    stats.pauseMs.push(+(performance.now() - t0).toFixed(1));
  }
});
`;
const DEBUGGER_BG = debuggerBg(false);
const HYBRID_BG = debuggerBg(true);

// The hybrid: keep the DNR engine exactly as it is, and use chrome.debugger ONLY as a
// barrier. Fetch pauses each request of the bound tab at the Request stage; a redirect's
// follow-up is held until webRequest has reported the redirect (onBeforeRedirect) and the
// rule write it caused has landed. Headers are not touched by the debugger at all, so the
// question is whether DNR evaluates the follow-up AFTER the pause is released.
const BARRIER_BG = DNR_BG + `
const redirectsSeen = new Map(); // redirectUrl -> resolve[]
const waiters = new Map();
chrome.webRequest.onBeforeRedirect.addListener((d) => {
  redirectsSeen.set(d.redirectUrl, true);
  for (const r of waiters.get(d.redirectUrl) ?? []) r();
  waiters.delete(d.redirectUrl);
}, { urls: [ORIGIN + '/*'] });
const waitRedirect = (url, ms) => redirectsSeen.has(url) ? Promise.resolve('seen') : new Promise((res) => {
  const t = setTimeout(() => res('timeout'), ms);
  waiters.set(url, [...(waiters.get(url) ?? []), () => { clearTimeout(t); res('waited'); }]);
});
globalThis.held = [];
const bindDnr = globalThis.bind;
globalThis.bind = async (tabId) => {
  await bindDnr(tabId);
  await chrome.debugger.attach({ tabId }, '1.3');
  await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', { patterns: [{ urlPattern: ORIGIN + '/*', requestStage: 'Request' }] });
  return 'bound+barrier';
};
chrome.debugger.onEvent.addListener(async (src, method, p) => {
  if (method !== 'Fetch.requestPaused') return;
  const t0 = performance.now();
  let how = 'first';
  if (p.redirectedRequestId) how = await waitRedirect(p.request.url, 1000);
  await chain; // every rule write queued so far has landed
  held.push({ url: p.request.url, how, heldMs: +(performance.now() - t0).toFixed(1) });
  await chrome.debugger.sendCommand({ tabId: src.tabId }, 'Fetch.continueRequest', { requestId: p.requestId });
});
`;

// Questions about the full debugger engine that decide whether it can be built at all.
const DBGPROBE_BG = `${COMMON}
globalThis.bind = async (tabId) => {
  const t = { tabId };
  await chrome.debugger.attach(t, '1.3');
  const out = {};
  try { out.createBrowserContext = await chrome.debugger.sendCommand(t, 'Target.createBrowserContext', {}); }
  catch (e) { out.createBrowserContext = 'ERR ' + (e.message ?? e); }
  await chrome.debugger.sendCommand(t, 'Network.enable', {});
  await chrome.debugger.sendCommand(t, 'Fetch.enable', { patterns: [
    { urlPattern: ORIGIN + '/*', requestStage: 'Request' },
    { urlPattern: ORIGIN + '/*', requestStage: 'Response' } ] });
  return JSON.stringify(out);
};
globalThis.extra = new Map(); // CDP networkId -> raw Set-Cookie lines from responseReceivedExtraInfo
globalThis.events = [];
chrome.debugger.onEvent.addListener(async (src, method, p) => {
  const t = { tabId: src.tabId };
  if (method === 'Network.responseReceivedExtraInfo') {
    const sc = Object.entries(p.headers).filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v);
    extra.set(p.requestId, sc); events.push({ ev: 'extraInfo', id: p.requestId, sc }); return;
  }
  if (method !== 'Fetch.requestPaused') return;
  if (p.responseStatusCode !== undefined) {
    events.push({ ev: 'responsePaused', url: p.request.url, status: p.responseStatusCode, networkId: p.networkId, extraAlreadyHere: extra.has(p.networkId) });
    await chrome.debugger.sendCommand(t, 'Fetch.continueRequest', { requestId: p.requestId });
    return;
  }
  // Replace-or-merge: send ONLY persona=p1 and see what the server receives.
  const headers = Object.entries(p.request.headers).filter(([k]) => k.toLowerCase() !== 'cookie').map(([name, value]) => ({ name, value }));
  headers.push({ name: 'Cookie', value: 'persona=p1' });
  events.push({ ev: 'requestPaused', url: p.request.url, pageCookie: p.request.headers.Cookie ?? null, redirectedRequestId: p.redirectedRequestId ?? null });
  await chrome.debugger.sendCommand(t, 'Fetch.continueRequest', { requestId: p.requestId, headers });
});
`;

const SWAP_BG = `${COMMON}
// The persona's cookies are written INTO the shared jar while its tab works, and taken out
// afterwards. Learned names come from observation, because chrome.cookies.getAll returns []
// on Chrome 154 (CLAUDE.md) - only get-by-name works.
const names = new Set();
chrome.webRequest.onHeadersReceived.addListener((d) => {
  for (const h of d.responseHeaders ?? []) if (h.name.toLowerCase() === 'set-cookie') names.add(parse(h.value)[0]);
}, { urls: [ORIGIN + '/*'] }, ['responseHeaders', 'extraHeaders']);
globalThis.swapIn = async (pairs) => { for (const [name, value] of pairs) await chrome.cookies.set({ url: ORIGIN + '/', name, value, path: '/' }); return 'in'; };
globalThis.swapOut = async () => {
  const saved = [];
  for (const name of names) {
    const c = await chrome.cookies.get({ url: ORIGIN + '/', name });
    if (c) { saved.push([c.name, c.value]); await chrome.cookies.remove({ url: ORIGIN + '/', name }); }
  }
  return saved;
};
`;

function writeExt(name, perms, bg) {
  const dir = mkdtempSync(join(tmpdir(), `probe-${name}-`));
  writeFileSync(join(dir, 'manifest.json'), MANIFEST(perms));
  writeFileSync(join(dir, 'background.js'), bg);
  return dir;
}

// ---------------------------------------------------------------- runner
async function tabIdOf(chrome, url) {
  return chrome.swSession.eval(`chrome.tabs.query({}).then(ts => ts.find(t => (t.url||t.pendingUrl||'').startsWith(${JSON.stringify(url)}))?.id)`);
}

async function runChain(page) {
  const n = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  await page.send('Page.navigate', { url: `${ORIGIN}/c1?n=${n}` });
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    const txt = await page.eval(`document.getElementById('r')?.textContent ?? null`);
    if (txt) return { ...JSON.parse(txt), ms: Date.now() - t0 };
  }
  return { ok: false, at: 'timeout' };
}

const results = {};
const TRIALS = 5;

async function engine(name, perms, bg) {
  const ext = bg ? writeExt(name, perms, bg) : null;
  const chrome = await launchChrome({ port: DEBUG_PORT, extensionPath: ext });
  try {
    if (ext) await chrome.swSession.send('Runtime.enable');
    // A "browser login" in the shared jar, from a plain tab.
    const plain = await openPage(chrome, `${ORIGIN}/plant`);
    await sleep(300);
    const page = await openPage(chrome, `${ORIGIN}/home`);
    await sleep(300);
    const tabId = ext ? await tabIdOf(chrome, `${ORIGIN}/home`) : null;
    if (['dnr', 'debugger', 'hybrid', 'barrier', 'dbgprobe'].includes(name)) {
      console.log(`   [${name}] bind tab ${tabId}:`, await chrome.swSession.eval(`bind(${tabId})`));
      console.log(`   [${name}] perms:`, await chrome.swSession.eval(`chrome.permissions.getAll().then(p=>JSON.stringify(p))`),
        await chrome.swSession.eval(`chrome.declarativeNetRequest.getSessionRules().then(r=>JSON.stringify(r))`));
    }
    const runs = [];
    if (name === 'swap') {
      // Race measurement: a plain tab polls the site every ~5 ms while the persona tab
      // runs its chain with the persona's cookies swapped into the shared jar.
      await chrome.swSession.eval(`swapIn([['persona','p1']])`);
      await plain.eval(`window.__hits=[];window.__poll=setInterval(()=>fetch('/echo',{cache:'no-store'}).then(r=>r.json()).then(j=>__hits.push(j.cookie)),5);1`);
      for (let i = 0; i < TRIALS; i++) runs.push(await runChain(page));
      const swapStart = Date.now();
      const saved = await chrome.swSession.eval(`swapOut()`);
      const swapMs = Date.now() - swapStart;
      await sleep(200);
      const hits = await plain.eval(`clearInterval(__poll); __hits`);
      const leaked = hits.filter((c) => /persona=|(^|; )a=|(^|; )b=/.test(c)).length;
      results.swap_race = { plainTabRequests: hits.length, sawPersonaCookies: leaked, swapOutMs: swapMs, savedBack: saved.length,
        personaTabCarriedBrowserLogin: runs.filter((r) => /browser=me/.test(r.cookie ?? '')).length };
    } else {
      for (let i = 0; i < TRIALS; i++) runs.push(await runChain(page));
    }
    // Same chain inside a cross-site iframe (an out-of-process frame, like Google's
    // RotateCookiesPage / CheckConnection frames).
    const fn = 'f' + Math.random().toString(36).slice(2, 7);
    await page.send('Page.navigate', { url: `${ORIGIN}/frame?n=${fn}` });
    for (let i = 0; i < 20 && !outcome.has(fn); i++) await sleep(150);
    const frame = outcome.get(fn) ?? { ok: false, at: 'timeout' };
    const firstHop = seen.filter((r) => r.path === '/c1').slice(-TRIALS - 1);
    // What does the shared jar look like afterwards, and what does a plain tab send?
    const plainCookie = (await plain.eval(`fetch('/echo',{cache:'no-store'}).then(r=>r.json())`)).cookie;
    if (name === 'dnr') console.log('   [dnr] webRequest seen', await chrome.swSession.eval(`JSON.stringify({seen: globalThis.seenWR, last: globalThis.lastTab, keys: [...jar.keys()]})`));
    const ext_log = ext ? await chrome.swSession.eval(`JSON.stringify(globalThis.log.slice(-12))`) : null;
    const held = name === 'barrier' ? JSON.parse(await chrome.swSession.eval(`JSON.stringify(held.slice(-8))`)) : undefined;
    const events = name === 'dbgprobe' ? JSON.parse(await chrome.swSession.eval(`JSON.stringify(events.slice(-14))`)) : undefined;
    const stats = ['debugger', 'hybrid'].includes(name) ? await chrome.swSession.eval(`JSON.stringify(stats)`) : null;
    results[name] = {
      passed: runs.filter((r) => r.ok).length + '/' + TRIALS,
      runs: runs.map((r) => `${r.ok ? 'ok' : 'FAIL@' + r.at} ${r.ms ?? ''}ms cookie="${r.cookie ?? ''}"`),
      personaTabSentBrowserLogin: runs.some((r) => /browser=me/.test(r.cookie ?? '')) || firstHop.some((r) => /browser=me/.test(r.cookie)),
      crossSiteIframe: `${frame.ok ? 'ok' : 'FAIL@' + frame.at} host=${frame.host} cookie="${frame.cookie ?? ''}"`,
      attachedTargets: ['debugger', 'hybrid'].includes(name) ? await chrome.swSession.eval(`JSON.stringify(attached)`) : undefined,
      plainTabCookieAfter: plainCookie,
      extLog: ext_log ? JSON.parse(ext_log) : undefined,
      stats: stats ? JSON.parse(stats) : undefined,
      held, events,
    };
  } finally {
    await chrome.kill();
  }
}

try {
  // ENGINES=dnr,debugger runs a subset while iterating on one.
  const want = new Set((process.env.ENGINES ?? 'control,dnr,barrier,debugger,hybrid,dbgprobe,swap').split(','));
  if (want.has('control')) await engine('control', [], null);
  if (want.has('dnr')) await engine('dnr', ['declarativeNetRequest', 'webRequest', 'tabs'], DNR_BG);
  if (want.has('debugger')) await engine('debugger', ['debugger', 'tabs'], DEBUGGER_BG);
  if (want.has('hybrid')) await engine('hybrid', ['debugger', 'declarativeNetRequest', 'tabs'], HYBRID_BG);
  if (want.has('barrier')) await engine('barrier', ['declarativeNetRequest', 'webRequest', 'tabs', 'debugger'], BARRIER_BG);
  if (want.has('dbgprobe')) await engine('dbgprobe', ['debugger', 'tabs'], DBGPROBE_BG);
  if (want.has('swap')) await engine('swap', ['cookies', 'webRequest', 'tabs'], SWAP_BG);
} finally {
  server.close();
}
console.log(JSON.stringify(results, null, 2));
process.exit(0);
