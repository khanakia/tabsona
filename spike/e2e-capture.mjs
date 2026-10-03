// "I'm signed in on site1.com — save it as a session in a persona."
//
// The capability v1 had no path for at all, and the one that removes most of the
// friction: you never have to re-sign-in to seed a persona.
//
// Asserts the whole round trip of a COPY, and the thing that must NOT happen:
//   1. sign in on an ORDINARY tab (no persona, no isolation)
//   2. copy that login into a persona
//   3. the browser's own jar is UNTOUCHED — the tab you were sitting in still works
//   4. wipe the origin, open the saved session, and be signed in again
//
// The MOVE variant, which deliberately empties the browser's jar, is e2e-move.

import {
  attach, claimNewTab, pageIds, pickApp, report, requireGrant, sleep, Session, startChrome, waitFor,
} from './lib/harness.mjs';

const app = pickApp();
const user = app.users[0];
const chrome = await startChrome(9820);
await requireGrant(chrome, app.origin);

// --- 1. an ordinary tab, signed in normally ---------------------------------
const before = await pageIds(chrome);
await chrome.newTab(app.url);
const target = await claimNewTab(chrome, before, app.host);
const page = await attach(target);
await waitFor(page, app.formReady, 'login form on the ordinary tab');
await page.eval(app.login(user));
await waitFor(page, app.loggedIn, 'signed in on the ordinary tab');
await sleep(800);

const normalWho = await page.eval(app.whoami);
const bindingsWhileNormal = await chrome.json(
  `chrome.storage.session.get('bindings').then(g => g.bindings ?? {})`);
const wasUnbound = Object.keys(bindingsWhileNormal).length === 0;

// --- 2. save it -------------------------------------------------------------
const personaId = await chrome.op('newPersona("From current tab")');
// saveCurrentTab acts on the ACTIVE tab, so make the one we signed into active.
const tabId = Number(await chrome.swSession.eval(
  `chrome.tabs.query({}).then(ts => { const t = ts.find(x => x.url && x.url.includes(${JSON.stringify(app.host)})); return t ? t.id : -1; })`));
await chrome.swSession.eval(`chrome.tabs.update(${tabId}, {active: true})`);
await sleep(400);
// COPY on purpose: this suite's whole point is that importing a login can leave the
// browser's own session alone. The move behaviour is covered by e2e-move.
const saved = await chrome.op(`saveCurrentTab(${JSON.stringify(personaId)}, "copy", false)`);

const state = await chrome.op('getState()');
const persona = state.personas.find((p) => p.id === personaId);
const session = persona?.sessions[0];

// --- 3. the browser's own jar must be untouched ------------------------------
// Importing reads chrome.cookies and the page's real storage; if it MODIFIED either,
// the tab the user was sitting in would break — which would be a far worse bug than
// failing to save.
const stillSignedIn = await page.eval(app.whoami);

// --- 4. wipe the origin, then open the saved session -------------------------
const n = await page.eval(`Object.keys(localStorage).length`);
await page.eval(`localStorage.clear(); sessionStorage.clear(); true`);
console.log(`[wipe] cleared ${n} keys from the origin`);
await chrome.swSession.eval(`chrome.tabs.remove(${tabId})`);
page.close();
await sleep(1200);

// Also clear the browser's real cookie jar for this origin, so a restored session
// cannot pass by inheriting the login that is still sitting there.
await chrome.swSession.eval(`
  chrome.cookies.getAll({ url: ${JSON.stringify(app.url)} }).then(cs =>
    Promise.all(cs.map(c => chrome.cookies.remove({
      url: ${JSON.stringify(app.url)}, name: c.name,
    })))).then(r => r.length)`);
await sleep(600);

const beforeOpen = await pageIds(chrome);
await chrome.op(`openSession(${JSON.stringify(session?.id)}, "new-tab")`);
const restoredTarget = await claimNewTab(chrome, beforeOpen, app.host).catch(() => null);
let restoredWho = null;
if (restoredTarget) {
  const rs = await Session.open(restoredTarget.webSocketDebuggerUrl);
  await rs.send('Runtime.enable');
  await waitFor(rs, app.loggedIn, 'restored from an imported login', 35000);
  restoredWho = await rs.eval(app.whoami);
  rs.close();
}

await chrome.kill();

console.log(`\nsigned in normally as ${normalWho}; saved=${JSON.stringify(saved)}`);
console.log(`   session: ${session?.label} — ${session?.cookieCount} cookies, ${session?.storageKeyCount} keys, state=${session?.state}`);
console.log(`   restored as ${restoredWho}`);

const pass = report(`save the current tab's login — ${app.name}`, [
  ['the source tab was NOT isolated', wasUnbound],
  ['signed in on an ordinary tab', normalWho !== null, String(normalWho)],
  ['save reported success', saved?.ok === true, JSON.stringify(saved)],
  ['the session captured credentials', (session?.cookieCount ?? 0) + (session?.storageKeyCount ?? 0) > 0,
    `${session?.cookieCount} cookies / ${session?.storageKeyCount} keys`],
  ['the session is not reported as empty', session?.state !== 'empty', String(session?.state)],
  ["the browser's own login was untouched", stillSignedIn === normalWho],
  ['reopening it signs in again', restoredWho !== null && restoredWho === normalWho],
]);
process.exit(pass ? 0 : 1);
