// The flows the user actually described, each pinned so none can quietly regress.
//
// Their correction, in their words: "so I can be logged in plain tab and session too,
// so plain tab has nothing to do with it — but there should be an option: Move this
// logged-in tab to Group 1, so Move or Copy should be an option too."
//
// Four things, in order:
//   A. ADD SITE — build a session from a typed URL. Plain tab untouched.
//   B. USE THIS TAB — put the tab you are on into a persona with a BLANK session, so you
//      sign in fresh there while the browser stays signed in as whoever it was.
//   C. MOVE — import the login and take it OUT of the browser's jar.
//   D. COPY — import it and leave the browser signed in too.

import {
  attach, claimNewTab, pageIds, pickApp, report, requireGrant, sleep, startChrome, waitFor,
} from './lib/harness.mjs';

const app = pickApp();
const [userOne, userTwo] = app.users;
const chrome = await startChrome(9875);
await requireGrant(chrome, app.origin);

/** Who a FRESH un-isolated tab is — the only honest read of the browser's own jar,
 *  because chrome.cookies.getAll returns [] for everything on Chrome 154. */
async function plainTabIdentity() {
  const before = await pageIds(chrome);
  await chrome.newTab(app.url);
  const t = await claimNewTab(chrome, before, app.host);
  const p = await attach(t);
  await sleep(2200);
  const who = await p.eval(app.whoami);
  p.close();
  await chrome.swSession.eval(
    `chrome.tabs.remove(${Number(await chrome.swSession.eval(
      `chrome.tabs.query({}).then(ts => { const x = ts.filter(t => t.url && t.url.includes(${JSON.stringify(app.host)})).pop(); return x ? x.id : -1; })`))})`,
  ).catch(() => undefined);
  await sleep(500);
  return who;
}

/**
 * Sign in on an ordinary, un-isolated tab and leave it open.
 *
 * Signs OUT first if the browser is already signed in. The shared jar persists across
 * phases, so without this the second phase opens an already-signed-in tab, never sees a
 * login form, and times out — which looked like a product bug and was a test bug.
 */
async function signInPlain(user) {
  const before = await pageIds(chrome);
  await chrome.newTab(app.url);
  const t = await claimNewTab(chrome, before, app.host);
  const page = await attach(t);
  await sleep(1500);
  if (await page.eval(app.loggedIn) === true) {
    await page.eval(`document.querySelector('form[action="/logout"]')?.submit() ?? 'no-logout'`);
    await sleep(1500);
  }
  await waitFor(page, app.formReady, 'plain login form');
  await page.eval(app.login(user));
  await waitFor(page, app.loggedIn, 'plain tab signed in');
  await sleep(600);
  const tabId = Number(await chrome.swSession.eval(
    `chrome.tabs.query({}).then(ts => { const x = ts.filter(t => t.url && t.url.includes(${JSON.stringify(app.host)})).pop(); return x ? x.id : -1; })`));
  await chrome.swSession.eval(`chrome.tabs.update(${tabId}, {active: true})`);
  await sleep(400);
  return { page, tabId };
}

// --- A. ADD SITE: a session from a typed URL, plain tab untouched -------------
const plainA = await signInPlain(userOne);
const personaA = await chrome.op('newPersona("Acme admin")');

const beforeAdd = await pageIds(chrome);
await chrome.op(`addSite(${JSON.stringify(personaA)}, ${JSON.stringify(app.url)})`);
const addedTarget = await claimNewTab(chrome, beforeAdd, app.host);
const addedPage = await attach(addedTarget);
await waitFor(addedPage, app.formReady, 'added-site tab shows a login form');
const addedStartsSignedOut = await addedPage.eval(app.whoami) === null;

// Sign in there as the OTHER user, so a leak either way is visible.
await addedPage.eval(app.login(userTwo));
await waitFor(addedPage, app.loggedIn, 'signed in inside the added session');
await sleep(600);
const addedWho = await addedPage.eval(app.whoami);

// The plain tab must be untouched by any of that.
const plainStillSignedIn = await plainA.page.eval(app.whoami);

// --- B. USE THIS TAB: blank session on the tab you are on ---------------------
const personaB = await chrome.op('newPersona("Client X")');
const plainB = await signInPlain(userOne);
await chrome.op(`useTabIn(${JSON.stringify(personaB)})`);
await sleep(3500);

// Watch THE TAB WE CONVERTED, not "the last tab on this host".
//
// By now several tabs sit on this origin — the plain one from phase A, the added-site
// session, and this one — so `.pop()` picks an arbitrary neighbour. It picked the
// added-site tab (signed in as bob) and reported the conversion broken when it was not.
// The same trap as the earlier harness bug: never guess which tab you are driving.
const convertedSignedOut = await waitFor(
  plainB.page, app.formReady, 'converted tab shows a login form', 25000);

// The browser's own login must survive being borrowed like this.
const browserSurvivedConvert = await plainTabIdentity();
void plainB;

// --- C. MOVE -----------------------------------------------------------------
const personaC = await chrome.op('newPersona("Mover")');
const plainC = await signInPlain(userOne);
await chrome.op(`saveCurrentTab(${JSON.stringify(personaC)}, "move")`);
await sleep(3500);
const afterMove = await plainTabIdentity();
void plainC;

// --- D. COPY -----------------------------------------------------------------
const personaD = await chrome.op('newPersona("Copier")');
const plainD = await signInPlain(userOne);
await chrome.op(`saveCurrentTab(${JSON.stringify(personaD)}, "copy")`);
await sleep(2500);
const afterCopy = await plainTabIdentity();

const state = await chrome.op('getState()');
const copied = state.personas.find((p) => p.id === personaD)?.sessions[0];
void plainD;

await chrome.kill();

console.log(`\nA. add site      : started signed out=${addedStartsSignedOut}, signed in as ${addedWho}; plain tab still ${plainStillSignedIn}`);
console.log(`B. use this tab  : converted tab signed out=${convertedSignedOut}; browser still ${browserSurvivedConvert}`);
console.log(`C. move          : a plain tab afterwards is ${afterMove}`);
console.log(`D. copy          : a plain tab afterwards is ${afterCopy}; persona holds ${copied?.cookieCount} cookies`);

const pass = report(`the four flows — ${app.name}`, [
  ['ADD SITE opens a signed-out tab', addedStartsSignedOut],
  ['…you can sign in there as someone else', addedWho === 'bob', String(addedWho)],
  ['…and the plain tab is untouched', plainStillSignedIn === 'alice', String(plainStillSignedIn)],
  ['USE THIS TAB gives a blank session', convertedSignedOut],
  ["…without disturbing the browser's own login", browserSurvivedConvert === 'alice', String(browserSurvivedConvert)],
  ['MOVE takes the login out of the browser', afterMove === null, String(afterMove)],
  ['COPY leaves the browser signed in', afterCopy === 'alice', String(afterCopy)],
  ['…and the persona got the credentials too', (copied?.cookieCount ?? 0) > 0, `${copied?.cookieCount}`],
]);
process.exit(pass ? 0 : 1);
