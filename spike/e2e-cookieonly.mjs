// A cookie-only app that REDIRECTS signed-out users must open signed in from a persona —
// and the persona's cookie must reach that app's host and no other.
//
// THE BUG THIS EXISTS FOR, reported by the user against a real app (Next.js + WorkOS
// AuthKit, login held in one HttpOnly cookie): "copy into the persona" worked, but
// opening the persona landed on the AuthKit sign-in page.
//
// The cookie WAS saved. The rule was computed from the url the tab was on, and a tab is
// on about:blank when it is bound, so the first real request left with no cookie, the
// server answered 302 → sign-in, and the correct rule arrived a moment too late. Every
// other suite missed it because the default fixture writes localStorage on each load:
// restoring storage triggers a reload, and the reload carried the right cookie.
//
// Asserts, against the fixture in COOKIE_ONLY mode:
//   1. precondition: the signed-in page holds NOTHING in storage, so no reload can mask
//      a signed-out first request
//   2. copy the login into a persona, close the tab, open the persona
//   3. the FIRST document the server rendered for the persona tab is signed in, and the
//      tab never bounced to /signin
//   4. control: the same tab's own host receives the session cookie, so step 5 is not
//      passing because no cookie is ever sent
//   5. a DIFFERENT host (127.0.0.1, same server) receives no session cookie from the
//      persona tab — a tab-wide Cookie rule used to send it to every host

import {
  attach, claimNewTab, pageIds, report, requireGrant, sleep, startChrome, waitFor,
} from './lib/harness.mjs';

const ORIGIN = process.env.COOKIE_ONLY_ORIGIN ?? 'http://localhost:8789';
const OTHER_ORIGIN = process.env.COOKIE_ONLY_OTHER_ORIGIN ?? 'http://127.0.0.1:8789';
const HOST = new URL(ORIGIN).host;
const COOKIE_NAME = 'fixture_sid';
const SIGNIN_PATH = '/signin';
const USER = 'alice';

/** What the SERVER rendered for this document's own request. Not /whoami: a fetch made
 *  after load carries whatever rule is installed by then, which is exactly the timing
 *  that hid this bug. Parenthesised because it is spliced into larger expressions. */
const RENDERED_USER = `(document.body ? (document.body.dataset.user ?? null) : null)`;

const chrome = await startChrome(9880);
await requireGrant(chrome, ORIGIN);
await requireGrant(chrome, OTHER_ORIGIN);

// --- 1. an ordinary tab, signed in normally, nothing in storage ---------------
const before = await pageIds(chrome);
await chrome.newTab(`${ORIGIN}/`);
const target = await claimNewTab(chrome, before, HOST);
const page = await attach(target);
await waitFor(page, `location.pathname === ${JSON.stringify(SIGNIN_PATH)} && !!document.querySelector('form[action="/login"]')`,
  'redirected to the sign-in page');
await page.eval(`(() => {
  const f = [...document.querySelectorAll('form[action="/login"]')]
    .find(f => f.querySelector('input[name=user]').value === ${JSON.stringify(USER)});
  if (f) f.submit();
})()`);
await waitFor(page, `${RENDERED_USER} === ${JSON.stringify(USER)}`, 'signed in on the ordinary tab');
const storageKeys = await page.eval(`localStorage.length + sessionStorage.length`);
page.close();

const tabId = Number(await chrome.swSession.eval(
  `chrome.tabs.query({}).then(ts => { const t = ts.find(x => x.url && x.url.includes(${JSON.stringify(HOST)})); return t ? t.id : -1; })`));
await chrome.swSession.eval(`chrome.tabs.update(${tabId}, {active: true})`);
await sleep(400);

// --- 2. copy into a persona, close the tab, open the persona ------------------
const personaId = await chrome.op('newPersona("Cookie only")');
// Mode spelled out: the drivers are plain JS and nothing type-checks these call sites.
const saved = await chrome.op(`saveCurrentTab(${JSON.stringify(personaId)}, "copy", false)`);
const state = await chrome.op('getState()');
const session = state.personas.find((p) => p.id === personaId)?.sessions[0];

await chrome.swSession.eval(`chrome.tabs.remove(${tabId})`);
await sleep(800);

const beforeOpen = await pageIds(chrome);
const opened = await chrome.op(`openPersona(${JSON.stringify(personaId)})`);
const personaTarget = await claimNewTab(chrome, beforeOpen, HOST).catch(() => null);

// --- 3. the first rendered document is signed in, no bounce -------------------
let renderedUser = 'no-tab';
let landedPath = 'no-tab';
let ownHostCookies = [];
let otherHostCookies = ['not-run'];
if (personaTarget) {
  const p = await attach(personaTarget);
  await waitFor(p, `document.readyState === 'complete' && ${RENDERED_USER} !== null`, 'persona tab rendered', 15000);
  // Give a would-be redirect time to land, so "no bounce" is observed, not assumed.
  await sleep(1000);
  renderedUser = await p.eval(RENDERED_USER);
  landedPath = await p.eval('location.pathname');

  // --- 4 + 5. which hosts receive the session cookie ------------------------
  const echo = (origin) => `fetch(${JSON.stringify(`${origin}/echo-cookies`)}, {credentials: 'include', cache: 'no-store'})
    .then(r => r.json()).then(j => j.cookies).catch(e => ['fetch-failed: ' + e.message])`;
  ownHostCookies = await p.eval(echo(ORIGIN));
  otherHostCookies = await p.eval(echo(OTHER_ORIGIN));
  p.close();
}

await chrome.kill();

console.log(`\nsigned in normally (storage keys on the page: ${storageKeys}); copy -> ${JSON.stringify(saved)}`);
console.log(`   the saved session          : ${session?.cookieCount} cookies, ${session?.storageKeyCount} keys`);
console.log(`   openPersona                : ${opened} tab(s); landed on ${landedPath} as ${renderedUser}`);
console.log(`   cookies at ${HOST.padEnd(16)}: ${JSON.stringify(ownHostCookies)}`);
console.log(`   cookies at ${new URL(OTHER_ORIGIN).host.padEnd(16)}: ${JSON.stringify(otherHostCookies)}`);

const pass = report('cookie-only app opens signed in, cookie stays on its host', [
  ['precondition: the app keeps nothing in storage', storageKeys === 0, String(storageKeys)],
  ['the copy succeeded', saved?.ok === true, JSON.stringify(saved)],
  ['the persona captured the HttpOnly cookie', (session?.cookieCount ?? 0) > 0, `${session?.cookieCount}`],
  ['the persona opened a tab', opened === 1 && personaTarget !== null, String(opened)],
  ['the tab did not bounce to the sign-in page', landedPath === '/', landedPath],
  ['the first document the server rendered is signed in', renderedUser === USER, String(renderedUser)],
  ['control: the app\'s own host receives the session cookie', ownHostCookies.includes(COOKIE_NAME),
    JSON.stringify(ownHostCookies)],
  ['another host receives no session cookie', Array.isArray(otherHostCookies)
    && !otherHostCookies.includes(COOKIE_NAME) && !otherHostCookies.some((c) => String(c).startsWith('fetch-failed')),
  JSON.stringify(otherHostCookies)],
]);
process.exit(pass ? 0 : 1);
