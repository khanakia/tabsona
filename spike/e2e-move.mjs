// Saving a login must MOVE it into the persona, not copy it.
//
// THE BUG THIS EXISTS FOR, reported by the user: "I'm signed in on site1.com and added
// it to group 1. If I open site1.com in a normal tab it's already logged in as the same
// session — so if I log out there, group 1 is logged out too."
//
// Exactly right. A copy leaves ONE server-side session shared between the browser's own
// jar and the persona. Signing out anywhere invalidates it everywhere, and the saved
// persona silently becomes worthless.
//
// Asserts the move:
//   1. sign in normally, save into a persona
//   2. the browser's OWN jar no longer holds that origin's cookies
//   3. the tab you were on is now inside the persona and still signed in
//   4. a fresh, un-isolated tab on that origin is signed OUT
//   5. signing out in a normal tab cannot touch the persona, because there is nothing
//      left in the shared jar to sign out of

import {
  attach, claimNewTab, pageIds, pickApp, report, requireGrant, sleep, startChrome, waitFor,
} from './lib/harness.mjs';

const app = pickApp();
const user = app.users[0];
const chrome = await startChrome(9865);
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
const whoBefore = await page.eval(app.whoami);

const tabId = Number(await chrome.swSession.eval(
  `chrome.tabs.query({}).then(ts => { const t = ts.find(x => x.url && x.url.includes(${JSON.stringify(app.host)})); return t ? t.id : -1; })`));
await chrome.swSession.eval(`chrome.tabs.update(${tabId}, {active: true})`);
await sleep(400);

// --- 2. save it into a persona ------------------------------------------------
const personaId = await chrome.op('newPersona("Acme admin")');
// Mode is EXPLICIT. This argument used to be `replace`, and when a `mode` was inserted
// before it the driver kept passing `false` — `false !== 'move'`, so the move silently
// did nothing and only the end-to-end assertions noticed. The drivers are plain JS, so
// nothing type-checks these call sites; spell the intent out.
const saved = await chrome.op(`saveCurrentTab(${JSON.stringify(personaId)}, "move", false)`);
await sleep(3500);

// NOT chrome.cookies.getAll: it returns [] for every filter on Chrome 154, so an
// assertion built on it passes whether or not the jar was cleared. This exact check
// reported "cleared" while a fresh tab was still signed in. The only honest test of the
// shared jar is to open an un-isolated tab and ask the SERVER who it is — which is
// step 4 below, and is the assertion that matters.

// --- 3. the tab you were on should now be inside the persona, still signed in --
const bindings = await chrome.json(`chrome.storage.session.get('bindings').then(g => g.bindings ?? {})`);
const state = await chrome.op('getState()');
const session = state.personas.find((p) => p.id === personaId)?.sessions[0];
const sameTabBound = Object.entries(bindings).some(([, sid]) => sid === session?.id);

// The tab navigated during the move, so re-attach to whatever is on the host now.
const livingTarget = (await chrome.targets()).find((t) => t.type === 'page' && t.url.includes(app.host));
let whoAfterMove = null;
if (livingTarget) {
  const p2 = await attach(livingTarget);
  await waitFor(p2, app.loggedIn, 'the moved tab is still signed in', 25000);
  whoAfterMove = await p2.eval(app.whoami);
  p2.close();
}

// --- 4. a fresh un-isolated tab must be signed OUT ----------------------------
const beforePlain = await pageIds(chrome);
await chrome.newTab(app.url);
const plainTarget = await claimNewTab(chrome, beforePlain, app.host).catch(() => null);
let whoPlain = 'no-tab';
if (plainTarget) {
  const p3 = await attach(plainTarget);
  await sleep(2500);
  whoPlain = await p3.eval(app.whoami);
  p3.close();
}

await chrome.kill();

console.log(`\nsigned in normally as ${whoBefore}; save -> ${JSON.stringify(saved)}`);
console.log(`   the saved session              : ${session?.cookieCount} cookies, ${session?.storageKeyCount} keys, ${session?.state}`);
console.log(`   the tab you were on            : ${whoAfterMove} (bound to the persona: ${sameTabBound})`);
console.log(`   a fresh un-isolated tab        : ${whoPlain}`);

const pass = report(`saving MOVES a login — ${app.name}`, [
  ['the save succeeded', saved?.ok === true, JSON.stringify(saved)],
  ['the persona captured the login', (session?.cookieCount ?? 0) + (session?.storageKeyCount ?? 0) > 0,
    `${session?.cookieCount} cookies / ${session?.storageKeyCount} keys`],
  ['the tab you were on joined the persona', sameTabBound],
  ['…and is still signed in', whoAfterMove !== null && whoAfterMove === whoBefore,
    `${whoBefore} -> ${whoAfterMove}`],
  ['a fresh un-isolated tab is signed OUT', whoPlain === null, String(whoPlain)],
]);
process.exit(pass ? 0 : 1);
