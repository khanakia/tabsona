// The core promise: two personas signed in to the same site at once, each keeping its
// own cookies AND page storage, and a saved session surviving its tab.
//
//   APP=fixture  http://localhost:8787   (HttpOnly cookie login)
//   APP=sync     https://sync.localhost  (localStorage JWT login, no cookies)

import {
  attach, claimNewTab, pageIds, pickApp, report, requireGrant, sleep, Session, startChrome, waitFor,
} from './lib/harness.mjs';

const app = pickApp();
const chrome = await startChrome(9800);
await requireGrant(chrome, app.origin);

const live = [];
for (const user of app.users) {
  const before = await pageIds(chrome);
  const personaId = await chrome.op(`newPersona(${JSON.stringify(String(user.label))})`);
  await chrome.op(`addSite(${JSON.stringify(personaId)}, ${JSON.stringify(app.url)})`);
  const target = await claimNewTab(chrome, before, app.host);
  const page = await attach(target);
  await waitFor(page, app.formReady, `${user.label}: login form`);
  await page.eval(app.login(user));
  await waitFor(page, app.loggedIn, `${user.label}: signed in`);
  await sleep(700);
  live.push({ personaId, user, page, target });
}

// Refresh BOTH, which is where a leaky tool collapses.
for (const l of live) await l.page.eval('location.reload()');
for (const l of live) await waitFor(l.page, app.loggedIn, `${l.user.label}: survived refresh`);
for (const l of live) {
  l.who = await l.page.eval(app.whoami);
  l.ls = await l.page.eval(
    `JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k=>[k,String(localStorage.getItem(k)).slice(0,20)])))`);
}

const ids = live.map((l) => l.who);
const isolated = ids.length === 2 && ids[0] && ids[1] && ids[0] !== ids[1];
// An eval that THREW returns {__err}; comparing two such objects with !== is always
// true, which once made this assertion pass vacuously. Demand parseable strings.
const readable = live.every((l) => typeof l.ls === 'string' && l.ls.startsWith('{'));
const lsIsolated = readable && live[0].ls !== live[1].ls;

// --- save, wipe the origin, restore -----------------------------------------
const first = live[0];
const state = await chrome.op('getState()');
const persona = state.personas.find((p) => p.id === first.personaId);
const sessionId = persona?.sessions[0]?.id;

const bindings = await chrome.json(`chrome.storage.session.get('bindings').then(g => g.bindings ?? {})`);
const boundTab = Number(Object.entries(bindings).find(([, sid]) => sid === sessionId)?.[0]);

const captured = await chrome.op(`captureTabStorage(${boundTab})`);
await chrome.swSession.eval(`chrome.tabs.remove(${boundTab})`);
first.page.close();
await sleep(1200);

// WIPE first: localStorage persists per origin, so without this a reopened tab finds
// its namespaced keys still sitting there and the assertion passes by accident. That
// masked a real capture/restore bug for days.
{
  const before = await pageIds(chrome);
  await chrome.newTab(app.url);
  const t = await claimNewTab(chrome, before, app.host);
  const w = await Session.open(t.webSocketDebuggerUrl);
  await w.send('Runtime.enable');
  await sleep(2500);
  const n = await w.eval(`Object.keys(localStorage).length`);
  await w.eval(`localStorage.clear(); sessionStorage.clear(); true`);
  console.log(`[wipe] cleared ${n} keys (captured=${captured})`);
  w.close();
  await chrome.swSession.eval(
    `chrome.tabs.query({}).then(ts => { const t = ts.find(x => x.url && x.url.includes(${JSON.stringify(app.host)}));
      return t ? chrome.tabs.remove(t.id) : null; })`).catch(() => undefined);
  await sleep(800);
}

const beforeRestore = await pageIds(chrome);
await chrome.op(`openSession(${JSON.stringify(sessionId)}, "new-tab")`);
const restoredTarget = await claimNewTab(chrome, beforeRestore, app.host).catch(() => null);
let restoredWho = null;
if (restoredTarget) {
  const rs = await Session.open(restoredTarget.webSocketDebuggerUrl);
  await rs.send('Runtime.enable');
  await waitFor(rs, app.loggedIn, 'restored session signed in', 35000);
  restoredWho = await rs.eval(app.whoami);
  rs.close();
}

// --- badge honesty ----------------------------------------------------------
const liveBindings = await chrome.json(`chrome.storage.session.get('bindings').then(g => g.bindings ?? {})`);
const statuses = [];
for (const tabId of Object.keys(liveBindings)) {
  statuses.push(await chrome.op(`statusForTab(${Number(tabId)})`));
}
const badgeNamesPersona = statuses.length > 0 && statuses.every((s) => s.personaName);
const badgeReportsCoverage = statuses.every((s) => Array.isArray(s.coverage) && s.coverage.length > 0);

await chrome.kill();

console.log(`\napp=${app.name}`);
live.forEach((l) => console.log(`   ${String(l.user.label).padEnd(22)} ${l.who}  ${l.ls}`));
console.log(`   restored: expected ${first.who}, got ${restoredWho}`);
statuses.forEach((s) => console.log(`   badge: ${s.personaName} · ${s.summary}`));

const pass = report(`isolation — ${app.name}`, [
  ['two personas signed in at once', isolated, ids.join(' vs ')],
  ['localStorage isolated per session', lsIsolated],
  ['save → wipe origin → restore', restoredWho !== null && restoredWho === first.who],
  ['badge names the persona', badgeNamesPersona],
  ['badge reports coverage', badgeReportsCoverage],
]);
process.exit(pass ? 0 : 1);
