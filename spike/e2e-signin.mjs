// A fresh persona tab must not come back signed in through the browser's SSO login.
//
// The user's report, verbatim: "i am logge as admin in normal tab
// https://staging-app.franchisepartner.com/ / and then i have 2 proifles s1, s2 each there
// own tab / i remove hte site in s2 and add again it also loas as admin@ifpghub.demo as s1".
//
// That app signs in through WorkOS AuthKit, a provider on ANOTHER host. Chrome applies a
// declarativeNetRequest header rule only on hosts the extension holds a permission for,
// and the user had allowed the app alone, so a persona tab's request to the provider went
// out with the BROWSER's provider cookie and came straight back as the browser's user.
// No rule can fix that on an un-allowed host; the extension must SEE it, SAY so, and
// offer to allow the provider, after which the per-tab rules cover it too.
//
// The fixture's sign-in is a CHAIN, like the real app's (staging-app → api.workos.com →
// auth.<custom domain> → *.authkit.app): /sso/start goes to a RELAY host holding no login
// (relay.localhost, api.workos.com's role), which redirects on to the identity provider
// (the same server as 127.0.0.1, a second cookie jar — cookies record no port).
//
//   G. THE GATE, nothing but the app allowed (the user's setup, and no "Allow on all
//      sites"): a persona tab that starts the sign-in is STOPPED before it reaches the
//      relay — it never carries the browser's login anywhere. The tab shows Tabsona's gate
//      page naming the relay, "Allow and continue" is refused while Chrome has not granted
//      it, "Open in a normal tab" opens the url as the browser and puts the persona tab
//      back on the app signed out, a persona link to an unrelated host gets the same page,
//      and an UNBOUND tab goes to the same hosts untouched. The plain tab stays alice
//      throughout and the persona never held alice.
//   G2. app + relay allowed: the next hop, the provider, is the one that stops, and the
//      chain (relay, provider) is written to storage.local for the site.
//   G3. the whole chain allowed: the stopped navigation resumes with "Allow and continue"
//      to the exact url (state seeded through a seam: a headless run cannot click Chrome's
//      permission dialog) and the persona lands on the provider's form; a leak window
//      makes the next sign-in NOT be saved, marks the session, and Start over clears it.
//   G4. a remembered chain: with the chain in storage the gate asks for ALL the hosts at once.
//   B. whole chain ALLOWED (what "Allow all" grants): a fresh persona tab
//      sees the provider's login form; a second persona signs in as bob while the plain
//      browser stays alice; forgetting that login while its tab is open and adding the
//      site again opens SIGNED OUT; and the forgotten tab is released to the browser's
//      own login rather than left half in a persona that no longer exists.
//   C. "Allow on all sites" (`*://*/*`, one prompt) and NOTHING else granted: the listener
//      and content scripts are scoped to it, a persona added for the app opens signed out,
//      its sign-in asks who you are, no alert appears at any point, the persona signs in
//      as bob while the plain tab stays alice — with no host ever allowed by name.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  attach, claimNewTab, EXT, pageIds, report, requireGrant, sleep, startChrome, waitFor,
} from './lib/harness.mjs';

const APP_ORIGIN = process.env.SSO_ORIGIN ?? 'http://localhost:8790';
const IDP_ORIGIN = process.env.SSO_IDP_ORIGIN ?? 'http://127.0.0.1:8790';
const RELAY_ORIGIN = process.env.SSO_RELAY_ORIGIN ?? 'http://relay.localhost:8790';
const APP_URL = `${APP_ORIGIN}/`;
const APP_HOST = new URL(APP_ORIGIN).host;
/** What "Allow on all sites" grants; the manifest's optional_host_permissions entry. */
const ALL_SITES_PATTERN = '*://*/*';

const WHO = `fetch('/whoami',{cache:'no-store'}).then(r=>r.json()).then(j=>j.user)`;
const ON_IDP = `location.origin === ${JSON.stringify(IDP_ORIGIN)} && !!document.querySelector('form[action^="/idp/login"]')`;
const ON_APP = `location.origin === ${JSON.stringify(APP_ORIGIN)} && document.readyState === 'complete'`;
const idpLogin = (user) => `(() => {
  const f = [...document.querySelectorAll('form[action^="/idp/login"]')]
    .find(f => f.querySelector('input[name=user]').value === ${JSON.stringify(user)});
  if (!f) return 'no-form'; f.submit(); return 'submitted';
})()`;

/** Wait until the tab settles on the app OR on the provider's form; say which. */
async function settle(page) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await page.eval(ON_IDP) === true) return 'idp-form';
    if (await page.eval(ON_APP) === true) { await sleep(400); return 'app'; }
    await sleep(250);
  }
  return 'timeout';
}

/** Plain, un-isolated tab signs in through the provider. Returns its identity. */
async function plainSignIn(chrome, user) {
  const before = await pageIds(chrome);
  await chrome.newTab(`${APP_ORIGIN}/sso/start`);
  const page = await attach(await claimNewTab(chrome, before, ''));
  if (await settle(page) === 'idp-form') { await page.eval(idpLogin(user)); await sleep(600); }
  await waitFor(page, ON_APP, 'plain tab back on the app');
  return { page, who: await page.eval(WHO) };
}

/** addSite into a persona, then start the SSO flow in that tab. */
async function addSiteAndStartSso(chrome, personaId) {
  const before = await pageIds(chrome);
  const tabId = await chrome.op(`addSite(${JSON.stringify(personaId)}, ${JSON.stringify(APP_URL)})`);
  const page = await attach(await claimNewTab(chrome, before, APP_HOST));
  await waitFor(page, ON_APP, 'persona tab on the app');
  const before0 = await page.eval(WHO);
  await page.eval(`location.href = '/sso/start'`);
  await sleep(300);
  const landed = await settle(page);
  return { tabId, page, signedOutAtFirst: before0 === null, landed };
}

/**
 * Sign in at the provider from a persona tab, then wait until it is back on the app.
 *
 * Counts how often the provider showed its form AGAIN right after a successful sign-in:
 * the provider's `Set-Cookie` arrives on a 302 whose follow-up request leaves before the
 * captured cookie's rule is installed. A known engine race (docs/limits.md), reported
 * here rather than hidden; one retry of the flow is what a user would do.
 */
async function personaProviderSignIn(page, user) {
  let retries = 0;
  await page.eval(idpLogin(user));
  await sleep(300);
  while (await settle(page) === 'idp-form' && retries < 2) {
    retries += 1;
    await sleep(800);
    await page.eval(`location.href = ${JSON.stringify(`${APP_ORIGIN}/sso/start`)}`);
    await sleep(300);
    if (await settle(page) === 'idp-form') await page.eval(idpLogin(user));
    await sleep(300);
  }
  await waitFor(page, ON_APP, 'persona tab back on the app', 10000);
  return { who: await page.eval(WHO), retries };
}

const status = (chrome, tabId) => chrome.op(`statusForTab(${Number(tabId)})`);

/**
 * A copy of the built extension with `origins` pre-granted. The popup's "Allow" calls
 * chrome.permissions.request, which needs a human click on Chrome's own dialog; a
 * headless run grants the same origins in a copy of the built manifest instead, exactly
 * as `task grant` does for the app.
 */
function extensionGranting(origins) {
  return extensionWithHostPermissions(origins.map((o) => `${o}/*`), { replace: false });
}

/** The same copy, with `patterns` as host permissions — added to the build's grants, or
 *  (`replace`) INSTEAD of them, so a phase can prove a grant works on its own. */
function extensionWithHostPermissions(patterns, { replace }) {
  const dir = mkdtempSync(join(tmpdir(), 'tabsona-ext-signin-'));
  cpSync(EXT, dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = [...new Set([...(replace ? [] : manifest.host_permissions ?? []), ...patterns])];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

/** Open the stopped-tab's gate page target and attach to it. */
async function waitForGate(page, tabId) {
  for (let i = 0; i < 80; i++) {
    const href = await page.eval('location.href').catch(() => '');
    if (typeof href === 'string' && href.includes('/surfaces/gate/index.html') && href.includes(`tab=${tabId}`)) {
      await sleep(400); // let React render
      return true;
    }
    await sleep(250);
  }
  return false;
}
/** The gate page's text, once React has rendered it (a bare URL match can land first,
 *  which under load read "Loading…" and failed a wording check for the wrong reason). */
async function gateText(page) {
  let text = '';
  for (let i = 0; i < 20; i++) {
    text = await page.eval('document.body.innerText');
    if (typeof text === 'string' && !text.startsWith('Loading')) return text;
    await sleep(250);
  }
  return text;
}

/** Add the app to a persona and send the tab down the sign-in; the gate should stop it. */
async function addSiteAndHitGate(chrome, personaId, target = `${APP_ORIGIN}/sso/start`) {
  const before = await pageIds(chrome);
  const tabId = await chrome.op(`addSite(${JSON.stringify(personaId)}, ${JSON.stringify(APP_URL)})`);
  const page = await attach(await claimNewTab(chrome, before, APP_HOST));
  await waitFor(page, ON_APP, 'persona tab on the app');
  const signedOutAtFirst = (await page.eval(WHO)) === null;
  await page.eval(`location.href = ${JSON.stringify(target)}`);
  const stopped = await waitForGate(page, tabId);
  return { tabId, page, signedOutAtFirst, stopped };
}

/** The stored session itself (cookies, leak mark): getState() summarises and omits them,
 *  so reading the summary would make "no cookies saved" pass vacuously. */
const rawSession = async (chrome, sessionId) => chrome.swSession.eval(
  `chrome.storage.local.get('sessions').then(v => (v.sessions ?? []).find(s => s.id === ${JSON.stringify(sessionId)}) ?? null)`);

const sessionOf = async (chrome, personaId) =>
  (await chrome.op('getState()')).personas.find((p) => p.id === personaId).sessions[0];

// --- G. the gate: only the app allowed ------------------------------------------------
const chromeG = await startChrome(9882, EXT);
await requireGrant(chromeG, APP_ORIGIN);
const holdsG = async (origin) => await chromeG.swSession.eval(
  `chrome.permissions.contains({origins:[${JSON.stringify(`${origin}/*`)}]})`) === true;
const grantedG = { relay: await holdsG(RELAY_ORIGIN), provider: await holdsG(IDP_ORIGIN) };
const plainG = await plainSignIn(chromeG, 'alice');
const sG = await chromeG.op('newPersona("s2")');
const G = await addSiteAndHitGate(chromeG, sG);
const gateInfoG = await chromeG.op(`gateInfo(${G.tabId})`);
const gateTextG = G.stopped ? await gateText(G.page) : '';
const declined = await chromeG.op(`gateContinue(${G.tabId})`);
const sessionG = await rawSession(chromeG, (await sessionOf(chromeG, sG)).id);
const noLeakedG = Array.isArray(sessionG.cookies) && sessionG.cookies.length === 0 && !sessionG.leakedThrough;
// "Open in a normal tab"
const beforeNormal = await pageIds(chromeG);
const opened = await chromeG.op(`gateOpenNormally(${G.tabId})`);
const normalTab = await attach(await claimNewTab(chromeG, beforeNormal, ':8790'));
await waitFor(G.page, ON_APP, 'persona tab put back on the app');
const personaWhoG = await G.page.eval(WHO);
await waitFor(normalTab, ON_APP, 'ordinary tab arrived (the url was the sign-in, which the browser\'s alice completes)');
const normalWho = await normalTab.eval(WHO);
// a persona link to an unrelated host gets the same page
const OTHER_ORIGIN = 'http://other.localhost:8790';
await G.page.eval(`location.href = ${JSON.stringify(`${OTHER_ORIGIN}/page?x=1`)}`);
const linkStopped = await waitForGate(G.page, G.tabId);
const linkInfo = await chromeG.op(`gateInfo(${G.tabId})`);
const linkText = linkStopped ? await gateText(G.page) : '';
// control: an unbound tab reaches the same host untouched
const beforeUnbound = await pageIds(chromeG);
await chromeG.newTab(`${OTHER_ORIGIN}/whoami`);
const unboundTab = await attach(await claimNewTab(chromeG, beforeUnbound, 'other.localhost'));
const unboundHref = await unboundTab.eval('location.href');
const chainsG = await chromeG.swSession.eval(`chrome.storage.local.get('signInChains').then(v => v.signInChains)`);
const plainAfterG = await plainSignIn(chromeG, 'nobody');
await chromeG.kill();

// --- G2. app + relay allowed: the provider is the next stop ---------------------------
const extG2 = extensionGranting([RELAY_ORIGIN]);
const chromeG2 = await startChrome(9884, extG2);
await requireGrant(chromeG2, APP_ORIGIN);
await requireGrant(chromeG2, RELAY_ORIGIN);
const sG2 = await chromeG2.op('newPersona("s2")');
const G2 = await addSiteAndHitGate(chromeG2, sG2);
const infoG2 = await chromeG2.op(`gateInfo(${G2.tabId})`);
const chainsG2 = await chromeG2.swSession.eval(`chrome.storage.local.get('signInChains').then(v => v.signInChains)`);
await chromeG2.kill();
rmSync(extG2, { recursive: true, force: true });

// --- G4. a remembered chain: ONE prompt for every host ----------------------------------
const chromeG4 = await startChrome(9887, EXT);
await requireGrant(chromeG4, APP_ORIGIN);
await chromeG4.swSession.eval(`chrome.storage.local.set({ signInChains: { ${JSON.stringify(APP_ORIGIN)}: [${JSON.stringify(RELAY_ORIGIN)}, ${JSON.stringify(IDP_ORIGIN)}] } })`);
const sG4 = await chromeG4.op('newPersona("s4")');
const G4 = await addSiteAndHitGate(chromeG4, sG4);
const infoG4 = await chromeG4.op(`gateInfo(${G4.tabId})`);
const textG4 = G4.stopped ? await gateText(G4.page) : '';
await chromeG4.kill();

// --- G3. everything allowed: continue resumes; a leaked login is never saved ----------
const extG3 = extensionGranting([RELAY_ORIGIN, IDP_ORIGIN]);
const chromeG3 = await startChrome(9888, extG3);
await requireGrant(chromeG3, APP_ORIGIN);
const plainG3 = await plainSignIn(chromeG3, 'alice');
const sG3 = await chromeG3.op('newPersona("s5")');
const beforeG3 = await pageIds(chromeG3);
const tabG3 = await chromeG3.op(`addSite(${JSON.stringify(sG3)}, ${JSON.stringify(APP_URL)})`);
const pageG3 = await attach(await claimNewTab(chromeG3, beforeG3, APP_HOST));
await waitFor(pageG3, ON_APP, 'persona tab on the app');
// Seam: the state a stopped tab is in before the user's click (see engine/index.ts).
const sessionIdG3 = (await sessionOf(chromeG3, sG3)).id;
await chromeG3.op(`setGatePending(${tabG3}, ${JSON.stringify({ url: `${APP_ORIGIN}/sso/start`, host: RELAY_ORIGIN, sessionId: sessionIdG3, at: Date.now() })})`);
await chromeG3.swSession.eval(`chrome.tabs.update(${tabG3}, { url: chrome.runtime.getURL('src/surfaces/gate/index.html') + '?tab=${tabG3}' })`);
const gateShownG3 = await waitForGate(pageG3, tabG3);
const resumed = await chromeG3.op(`gateContinue(${tabG3})`);
const landedG3 = await settle(pageG3);
let g3Login = { who: null, retries: 0 };
if (landedG3 === 'idp-form') g3Login = await personaProviderSignIn(pageG3, 'bob');
const g3Session = await sessionOf(chromeG3, sG3);
// Leak window: the next sign-in on the app must NOT be saved.
const s6 = await chromeG3.op('newPersona("s6")');
const beforeL = await pageIds(chromeG3);
const tabL = await chromeG3.op(`addSite(${JSON.stringify(s6)}, ${JSON.stringify(APP_URL)})`);
const pageL = await attach(await claimNewTab(chromeG3, beforeL, APP_HOST));
await waitFor(pageL, ON_APP, 'leak-test tab on the app');
await chromeG3.op(`openLeakWindow(${tabL}, ${JSON.stringify(RELAY_ORIGIN)})`);
await pageL.eval(`fetch('/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'user=bob',redirect:'manual'}).then(()=>'sent')`);
await sleep(1200);
const leakSession = await rawSession(chromeG3, (await sessionOf(chromeG3, s6)).id);
const leakStatus = await status(chromeG3, tabL);
await pageL.eval('location.reload()');
await sleep(1500);
const leakWho = await pageL.eval(WHO).catch(() => 'err');
await chromeG3.op(`startOver(${JSON.stringify(leakSession.id)})`);
await sleep(1500);
const afterStartOver = await rawSession(chromeG3, leakSession.id);
const plainAfterG3 = await plainSignIn(chromeG3, 'nobody');
await chromeG3.kill();
rmSync(extG3, { recursive: true, force: true });

// --- H. the stopped url is resumed BYTE FOR BYTE; a stopped form POST is not resent as a GET ---
// The user's staging run: AuthKit -> "Sign in with Google" landed the tab on Google's
// "Error 400: Required parameter is missing: response_type". The url was fine for a link;
// for a form POST it was a bare address (the body is gone and onErrorOccurred does not say
// it was a POST), so resuming sent Google a GET with no parameters.
const OAUTH_LOCATION = (await fetch(`${APP_ORIGIN}/oauth/start`, { redirect: 'manual' })).headers.get('location');
const OAUTH_ORIGIN = new URL(OAUTH_LOCATION ?? 'http://invalid').origin;
const SEEN = `JSON.parse(document.getElementById('seen')?.textContent ?? 'null')`;
const chromeH = await startChrome(9893, EXT);
await requireGrant(chromeH, APP_ORIGIN);
const sH = await chromeH.op('newPersona("s2")');
const H = await addSiteAndHitGate(chromeH, sH, `${APP_ORIGIN}/oauth/start`);
const infoH = await chromeH.op(`gateInfo(${H.tabId})`);
const H2 = await addSiteAndHitGate(chromeH, sH, `${APP_ORIGIN}/oauth/form`);
await H2.page.eval(`document.querySelector('#oauth button').click()`);
const formStopped = await waitForGate(H2.page, H2.tabId);
const infoHForm = await chromeH.op(`gateInfo(${H2.tabId})`);
const textHForm = formStopped ? await gateText(H2.page) : '';
const openNormallyForm = await chromeH.op(`gateOpenNormally(${H2.tabId})`);
await chromeH.kill();

// The same, with the provider allowed: resume the recorded url, and go back from a form.
const extH2 = extensionGranting([OAUTH_ORIGIN]);
const chromeH2 = await startChrome(9894, extH2);
await requireGrant(chromeH2, APP_ORIGIN);
await requireGrant(chromeH2, OAUTH_ORIGIN);
const beforeBrowser = await pageIds(chromeH2);
await chromeH2.newTab(`${OAUTH_ORIGIN}/o/auth?browser`);
const browserTab = await attach(await claimNewTab(chromeH2, beforeBrowser, new URL(OAUTH_ORIGIN).host));
await browserTab.eval(`document.cookie = 'fixture_sid=the-browsers-account; path=/'`);
const sH2 = await chromeH2.op('newPersona("s2")');
const beforeH2 = await pageIds(chromeH2);
const tabH2 = await chromeH2.op(`addSite(${JSON.stringify(sH2)}, ${JSON.stringify(APP_URL)})`);
const pageH2 = await attach(await claimNewTab(chromeH2, beforeH2, APP_HOST));
await waitFor(pageH2, ON_APP, 'persona tab on the app');
const sessionH2 = (await sessionOf(chromeH2, sH2)).id;
const gateUrlFor = (tabId) => `chrome.tabs.update(${tabId}, { url: chrome.runtime.getURL('src/surfaces/gate/index.html') + '?tab=${tabId}' })`;
// (a) a GET stop recorded as the browser reported it (infoH.url), resumed
await chromeH2.op(`setGatePending(${tabH2}, ${JSON.stringify({ url: infoH?.url ?? '', host: OAUTH_ORIGIN, sessionId: sessionH2, at: Date.now() })})`);
await chromeH2.swSession.eval(gateUrlFor(tabH2));
await waitForGate(pageH2, tabH2);
const resumedGet = await chromeH2.op(`gateContinue(${tabH2})`);
await waitFor(pageH2, `!!document.getElementById('seen')`, 'provider page after the resume');
const seenGet = await pageH2.eval(SEEN);
// (b) a POST stop: back to the page that held the form, press the button, the body arrives
await pageH2.eval(`location.href = '/oauth/form'`);
await waitFor(pageH2, `!!document.getElementById('oauth')`, 'the form page');
await chromeH2.op(`setGatePending(${tabH2}, ${JSON.stringify({ url: `${OAUTH_ORIGIN}/o/auth`, host: OAUTH_ORIGIN, sessionId: sessionH2, at: Date.now(), viaForm: true })})`);
await chromeH2.swSession.eval(gateUrlFor(tabH2));
await waitForGate(pageH2, tabH2);
const textH2Form = await gateText(pageH2);
const resumedForm = await chromeH2.op(`gateContinue(${tabH2})`);
await waitFor(pageH2, `!!document.getElementById('oauth')`, 'back on the form page');
const backOnForm = await pageH2.eval('location.pathname');
await pageH2.eval(`document.querySelector('#oauth button').click()`);
await waitFor(pageH2, `!!document.getElementById('seen')`, 'provider page after pressing the button');
const seenPost = await pageH2.eval(SEEN);
// (c) the marker on a page with no title: once, never doubled
await pageH2.eval(`location.href = '/untitled'`);
await sleep(1800);
const untitled = [await pageH2.eval('document.title')];
await sleep(600);
untitled.push(await pageH2.eval('document.title'));
await chromeH2.kill();
rmSync(extH2, { recursive: true, force: true });

// --- J. cookies a PAGE writes, and cookies a response sets, reach the next request -----------
// The user's Google sign-in inside a persona: "Cookies are disabled". Google writes a test
// cookie from script (document.cookie) and from an XHR response, then needs both back. In
// a bound tab the first went to the browser's SHARED jar (never sent, visible to every
// plain tab) and document.cookie read the browser's cookies, not the persona's.
const chromeJ = await startChrome(9897, EXT);
await requireGrant(chromeJ, APP_ORIGIN);
const beforeJ0 = await pageIds(chromeJ);
await chromeJ.newTab(`${APP_ORIGIN}/ck/page`);
const plainJ = await attach(await claimNewTab(chromeJ, beforeJ0, APP_HOST));
await waitFor(plainJ, `!!window.__ck`, 'plain tab finished the cookie round-trips');
const ckPlain = await plainJ.eval('window.__ck');
await plainJ.eval(`document.cookie = 'browsercookie=1; path=/'; fetch('/ck/set?name=browserhttp&httponly=1').then(() => 'ok')`);
const sJ = await chromeJ.op('newPersona("s2")');
const beforeJ = await pageIds(chromeJ);
const tabJ = await chromeJ.op(`addSite(${JSON.stringify(sJ)}, ${JSON.stringify(APP_URL)})`);
const pageJ = await attach(await claimNewTab(chromeJ, beforeJ, APP_HOST));
await waitFor(pageJ, ON_APP, 'persona tab on the app');
await pageJ.eval(`location.href = '/ck/page'`);
await waitFor(pageJ, `!!window.__ck`, 'persona tab finished the cookie round-trips');
const ckPersona = await pageJ.eval('window.__ck');
// a later navigation: both test cookies must come back (Google's actual verdict)
await pageJ.eval(`location.href = '/ck/check'`);
await waitFor(pageJ, `!!document.getElementById('verdict')`, 'verdict page');
const verdictJ = await pageJ.eval(`document.getElementById('verdict').textContent`);
// a reload of a page reads the persona's cookies synchronously, HttpOnly withheld
await pageJ.eval(`document.cookie = 'personaonly=1; path=/'; fetch('/ck/set?name=personaonly2').then(() => 'ok'); fetch('/ck/set?name=hidden&httponly=1').then(() => 'ok')`);
await sleep(600);
await pageJ.eval(`location.href = '/ck/echo'`);
await sleep(800);
const echoJ = JSON.parse(await pageJ.eval('document.body.innerText'));
await pageJ.eval(`location.href = '/untitled'`);
await sleep(800);
const readJ = await pageJ.eval('document.cookie');
const plainReadJ = await plainJ.eval('document.cookie');
await chromeJ.kill();

// --- B. the whole chain allowed ---------------------------------------------------------
const extB = extensionGranting([RELAY_ORIGIN, IDP_ORIGIN]);
const chrome = await startChrome(9883, extB);
await requireGrant(chrome, APP_ORIGIN);
await requireGrant(chrome, RELAY_ORIGIN);
await requireGrant(chrome, IDP_ORIGIN);

const plainB = await plainSignIn(chrome, 'alice');
const s1 = await chrome.op('newPersona("s1")');
const s1Tab = await addSiteAndStartSso(chrome, s1);
const s1Login = s1Tab.landed === 'idp-form' ? await personaProviderSignIn(s1Tab.page, 'alice') : { who: null, retries: 0 };
const s1Who = s1Login.who;

const s2 = await chrome.op('newPersona("s2")');
const s2Tab = await addSiteAndStartSso(chrome, s2);
const s2SawForm = s2Tab.landed === 'idp-form';
const s2Login = s2SawForm ? await personaProviderSignIn(s2Tab.page, 'bob') : { who: null, retries: 0 };
const s2Who = s2Login.who;

// Forget s2's login WHILE its tab is open — the exact order in the user's screenshot
// ("Signed in · 1 tab open") — then add the site to s2 again.
const s2State = await chrome.op('getState()');
const s2SessionId = s2State.personas.find((p) => p.id === s2).sessions[0].id;
await chrome.op(`deleteSession(${JSON.stringify(s2SessionId)})`);
await sleep(1200);
const forgottenStatus = await status(chrome, s2Tab.tabId);
await waitFor(s2Tab.page, ON_APP, 'forgotten tab reloaded');
const forgottenShim = await s2Tab.page.eval(`typeof window.__tabsonaSession === 'object'`);
const forgottenWho = await s2Tab.page.eval(WHO);

const readded = await addSiteAndStartSso(chrome, s2);
const readdedSawForm = readded.landed === 'idp-form';
const readdedLogin = readdedSawForm ? await personaProviderSignIn(readded.page, 'bob') : { who: null, retries: 0 };
const readdedWho = readdedLogin.who;
const readdedStatus = await status(chrome, readded.tabId);
const alertsB = (await chrome.op('getState()')).signInAlerts;

// The browser's own login, asked of the server through a brand-new plain tab.
const plainAfter = await plainSignIn(chrome, 'nobody');
await chrome.kill();
rmSync(extB, { recursive: true, force: true });

// --- C. "Allow on all sites": ONE grant, and no host named anywhere -----------------
// The build's per-origin grant is REPLACED by the every-website pattern, which is what
// one click on "Allow on all sites" and Chrome's one prompt leave behind. Nothing names
// the app, the relay or the provider, so this proves the wildcard alone is enough.
const extC = extensionWithHostPermissions([ALL_SITES_PATTERN], { replace: true });
const chromeC = await startChrome(9886, extC);
const grantsC = await chromeC.json('chrome.permissions.getAll().then(p => p.origins)');
const holdsC = async (origin) => await chromeC.swSession.eval(
  `chrome.permissions.contains({origins:[${JSON.stringify(`${origin}/*`)}]})`) === true;
const chainC = { app: await holdsC(APP_ORIGIN), relay: await holdsC(RELAY_ORIGIN), provider: await holdsC(IDP_ORIGIN) };
const scriptMatchesC = await chromeC.json(
  'chrome.scripting.getRegisteredContentScripts().then(s => s.map(x => x.matches))');
const plainC = await plainSignIn(chromeC, 'alice');
const s3 = await chromeC.op('newPersona("s3")');
const s3Tab = await addSiteAndStartSso(chromeC, s3);
const alertsC = (await chromeC.op('getState()')).signInAlerts;
const allSitesC = (await chromeC.op('getState()')).allSitesAllowed;
const s3Shim = await s3Tab.page.eval(`typeof window.__tabsonaSession === 'object'`);
const s3Login = s3Tab.landed === 'idp-form' ? await personaProviderSignIn(s3Tab.page, 'bob') : { who: null, retries: 0 };
const s3Status = await status(chromeC, s3Tab.tabId);
const alertsCAfter = (await chromeC.op('getState()')).signInAlerts;
const plainAfterC = await plainSignIn(chromeC, 'nobody');
await chromeC.kill();
rmSync(extC, { recursive: true, force: true });

console.log(`\nJ  cookie round-trips in a persona tab (informational): redirect cookie on the follow-up request: ${ckPersona.afterRedirect?.includes('redir')} (a 302's follow-up is issued by the network stack with no extension hop)`);
console.log(`\napp ${APP_ORIGIN} · relay ${RELAY_ORIGIN} · provider ${IDP_ORIGIN}`);
console.log(`   G  plain=${plainG.who} stopped=${G.stopped} reason=${gateInfoG?.reason} host=${gateInfoG?.host} declined=${declined} personaWho=${personaWhoG} link=${linkInfo?.reason}/${linkInfo?.host} plain after=${plainAfterG.who}`);
console.log(`   G2 stops at ${infoG2?.host} (asks ${JSON.stringify(infoG2?.hostsToAllow)}) · stored chain ${JSON.stringify(chainsG2)}`);
console.log(`   G3 resumed=${resumed} landed=${landedG3} as ${g3Login.who} · leak: cookies=${leakSession.cookies?.length} marked=${JSON.stringify(leakSession.leakedThrough?.hosts)} who=${leakWho} · after start over marked=${!!afterStartOver.leakedThrough}`);
console.log(`   G4 remembered chain asks ${JSON.stringify(infoG4?.hostsToAllow)}`);
console.log(`   provider form shown again after a sign-in (cookie-rule race): s1 ${s1Login.retries} · s2 ${s2Login.retries} · re-added ${readdedLogin.retries}`);
console.log(`   C  all sites (${JSON.stringify(grantsC)}): welcome=${chromeC.welcomeTabOpened} scripts=${JSON.stringify(scriptMatchesC)} plain=${plainC.who} s3 landed=${s3Tab.landed} as ${s3Login.who} (retries ${s3Login.retries}) alerts=${JSON.stringify(alertsC)} plain after=${plainAfterC.who}`);
console.log(`   B  plain=${plainB.who}  s1=${s1Who}  s2=${s2Who}  forgotten tab=${forgottenWho}  re-added s2=${readdedWho}  plain after=${plainAfter.who}`);

const pass = report('sign-in through another website — the re-added persona that came back as admin', [
  ['G: only the app is allowed (the user\'s setup)', !grantedG.relay && !grantedG.provider],
  ['G: the plain tab signed in through the chain', plainG.who === 'alice', String(plainG.who)],
  ['G: the persona tab opened signed out', G.signedOutAtFirst],
  ['G: GATE — the sign-in was STOPPED before the relay: the tab shows the gate page', G.stopped === true],
  ['G: the gate names the relay as the first host and says it is a sign-in',
    gateInfoG?.host === RELAY_ORIGIN && gateInfoG?.reason === 'sign-in', JSON.stringify(gateInfoG)],
  ['G: the page text names the host, the persona and the three choices',
    gateTextG.includes('relay.localhost') && gateTextG.includes('s2')
      && gateTextG.includes('Allow and continue') && gateTextG.includes('Open in a normal tab')
      && gateTextG.includes('Allow on all sites'), gateTextG.slice(0, 200)],
  ['G: "Allow and continue" is refused while the host is not granted', declined === false, String(declined)],
  ['G: nothing was saved from the stopped hop and nothing is marked leaked', noLeakedG],
  ['G: "Open in a normal tab" opened the stopped url as an ORDINARY tab: it completed the sign-in as the browser\'s alice',
    opened === true && normalWho === 'alice', `${opened} / ${normalWho}`],
  ['G: and put the persona tab back on the app, signed OUT (it never was alice)',
    personaWhoG === null, String(personaWhoG)],
  ['G: a persona link to an unrelated host gets the gate page too (reason "link")',
    linkStopped && linkInfo?.reason === 'link' && linkInfo?.host === OTHER_ORIGIN
      && linkText.includes('This tab is about to visit') && linkInfo?.url === `${OTHER_ORIGIN}/page?x=1`,
    JSON.stringify(linkInfo)],
  ['G: CONTROL — an UNBOUND tab reaches that same host untouched', unboundHref.startsWith(OTHER_ORIGIN), String(unboundHref)],
  ['G: the browser\'s own login is still alice', plainAfterG.who === 'alice', String(plainAfterG.who)],
  ['G2: with the relay allowed, the PROVIDER is the next stop',
    G2.stopped && infoG2?.host === IDP_ORIGIN && JSON.stringify(infoG2?.hostsToAllow) === JSON.stringify([IDP_ORIGIN]),
    JSON.stringify(infoG2)],
  ['G: the first hop (relay) is remembered in storage.local for the site',
    chainsG?.[APP_ORIGIN]?.includes(RELAY_ORIGIN) === true, JSON.stringify(chainsG)],
  ['G2: the next hop (provider) is remembered too, persistently',
    chainsG2?.[APP_ORIGIN]?.includes(IDP_ORIGIN) === true, JSON.stringify(chainsG2)],
  ['G4: a remembered chain asks for ALL its hosts in one prompt, stopped host first',
    G4.stopped && JSON.stringify(infoG4?.hostsToAllow) === JSON.stringify([RELAY_ORIGIN, IDP_ORIGIN])
      && textG4.includes('Allow all 2 and continue'), JSON.stringify(infoG4?.hostsToAllow)],
  ['G3: the plain tab is alice', plainG3.who === 'alice', String(plainG3.who)],
  ['G3: the gate page was shown for the stopped tab', gateShownG3],
  ['G3: "Allow and continue" resumed the exact url and the persona landed on the provider\'s form',
    resumed === true && landedG3 === 'idp-form', `${resumed} / ${landedG3}`],
  ['G3: the persona signed in as bob', g3Login.who === 'bob', String(g3Login.who)],
  ['G3: LEAK WINDOW — a sign-in inside it is NOT saved into the session',
    Array.isArray(leakSession.cookies) && leakSession.cookies.length === 0, JSON.stringify(leakSession.cookies)],
  ['G3: the session is marked "signed in through an unprotected website"',
    JSON.stringify(leakSession.leakedThrough?.hosts) === JSON.stringify([RELAY_ORIGIN]), JSON.stringify(leakSession.leakedThrough)],
  ['G3: the tab status reports it', JSON.stringify(leakStatus.leakedSignInSites ?? leakStatus.unguardedSignInSites ?? []).includes('relay.localhost'),
    JSON.stringify(leakStatus)],
  ['G3: and the persona stays signed OUT after a reload (the login was never kept)', leakWho === null, String(leakWho)],
  ['G3: Start over signed out clears the mark', !afterStartOver.leakedThrough],
  ['G3: the browser\'s own login is still alice', plainAfterG3.who === 'alice', String(plainAfterG3.who)],
  ['H: the url the gate recorded is byte-identical to the provider hop (encoded params, +, =, %2B intact)',
    infoH?.url === OAUTH_LOCATION && infoH?.viaForm === false, `${infoH?.url}`],
  ['H: a stopped FORM POST is recognised as one', formStopped && infoHForm?.viaForm === true, JSON.stringify(infoHForm)],
  ['H: and the page says the form cannot be resent, offers going back, and not "Open in a normal tab"',
    textHForm.includes('form being sent') && textHForm.includes('go back') && !textHForm.includes('Open in a normal tab'), textHForm.slice(0, 260)],
  ['H: "Open in a normal tab" is refused for a POST (a bare GET is not the request that was stopped)', openNormallyForm === false, String(openNormallyForm)],
  ['H2: resuming a GET reaches the provider with the exact query, as a GET',
    resumedGet === true && seenGet?.method === 'GET' && seenGet?.url === new URL(OAUTH_LOCATION ?? '').pathname + new URL(OAUTH_LOCATION ?? '').search,
    JSON.stringify(seenGet)],
  ['H2: and without the browser\'s login on the provider (the tab is separated there too)', seenGet?.cookie === null, JSON.stringify(seenGet?.cookie)],
  ['H2: a form stop says so on the page', textH2Form.includes('form being sent'), textH2Form.slice(0, 200)],
  ['H2: continuing a form stop takes the tab BACK to the form, not to a bare url',
    resumedForm === true && backOnForm === '/oauth/form', `${resumedForm} / ${backOnForm}`],
  ['H2: pressing the button again sends the POST with every parameter, response_type included',
    seenPost?.method === 'POST' && /(^|&)response_type=code(&|$)/.test(seenPost?.body ?? ''), JSON.stringify(seenPost)],
  ['H2: and without the browser\'s login', seenPost?.cookie === null, JSON.stringify(seenPost?.cookie)],
  ['H2: a page with NO title carries the persona marker ONCE (was "X X" until the app set a title)',
    untitled.every((t) => t.length > 0 && !/^(\S+) \1$/u.test(t)) && untitled.every((t) => t === untitled[0]), JSON.stringify(untitled)],
  ['J: CONTROL — a plain tab gets the JS-written cookie, the XHR cookie and the redirect cookie back',
    ckPlain.afterJs.includes('jstest') && ckPlain.afterXhr.includes('xhrtest') && ckPlain.afterRedirect.includes('redir'), JSON.stringify(ckPlain)],
  ['J: in a persona tab document.cookie reads the PERSONA\'s cookies, not the browser\'s (browsercookie=1 is not there)',
    ckPersona.readBack === 'jstest=1', JSON.stringify(ckPersona.readBack)],
  ['J: a cookie written with document.cookie is on the very next fetch', ckPersona.afterJs?.includes('jstest') === true, JSON.stringify(ckPersona.afterJs)],
  ['J: a cookie set by an XHR response is on the very next fetch (both test cookies now)',
    ckPersona.afterXhr?.includes('jstest') && ckPersona.afterXhr?.includes('xhrtest'), JSON.stringify(ckPersona.afterXhr)],
  ['J: Google\'s verdict page, reached by a later navigation, sees BOTH cookies', verdictJ === 'cookies enabled', verdictJ],
  ['J: an HttpOnly cookie reaches the server but page script cannot read it',
    echoJ.cookies?.hidden === '1' && !readJ.includes('hidden'), `${JSON.stringify(echoJ.cookies)} / ${readJ}`],
  ['J: the persona\'s cookies never touched the browser\'s jar (the plain tab does not see them)',
    !plainReadJ.includes('personaonly') && !plainReadJ.includes('hidden') && plainReadJ.includes('browsercookie=1'), plainReadJ],
  ['B: s1 saw the provider\'s form and signed in as alice', s1Tab.landed === 'idp-form' && s1Who === 'alice', `${s1Tab.landed} / ${s1Who}`],
  ['B: s2 saw the provider\'s form (not the browser\'s alice) and signed in as bob', s2SawForm && s2Who === 'bob', `${s2Tab.landed} / ${s2Who}`],
  ['B: forgetting the login released its open tab from the persona', forgottenStatus.sessionId === null, String(forgottenStatus.sessionId)],
  ['B: the released tab no longer runs the persona\'s storage shim', forgottenShim === false],
  ['B: the released tab is honestly on the browser\'s own login', forgottenWho === 'alice', String(forgottenWho)],
  ['B: the site added to s2 AGAIN opens signed out', readded.signedOutAtFirst],
  ['B: and its sign-in asks who you are instead of reusing anyone',
    readdedSawForm && readdedWho === 'bob', `${readded.landed} / ${readdedWho}`],
  ['B: no unguarded sign-in site is reported once the whole chain is allowed',
    readdedStatus.unguardedSignInSites.length === 0, JSON.stringify(readdedStatus.unguardedSignInSites)],
  ['B: and the popup has no sign-in alert', alertsB.length === 0, JSON.stringify(alertsB)],
  ['B: the browser\'s own login is still alice throughout', plainAfter.who === 'alice', String(plainAfter.who)],
  ['C: a first install opens the library page, where the welcome asks about all sites', chromeC.welcomeTabOpened === true],
  ['C: the only grant is every website — no host is named', JSON.stringify(grantsC) === JSON.stringify([ALL_SITES_PATTERN]), JSON.stringify(grantsC)],
  ['C: and it covers the app, the relay and the provider', chainC.app && chainC.relay && chainC.provider, JSON.stringify(chainC)],
  ['C: the app reports "allowed on every website"', allSitesC === true],
  ['C: the storage shim, the cookie relay and the badge are registered for every website',
    JSON.stringify(scriptMatchesC) === JSON.stringify([[ALL_SITES_PATTERN], [ALL_SITES_PATTERN], [ALL_SITES_PATTERN]]), JSON.stringify(scriptMatchesC)],
  ['C: the plain tab signed in through the chain', plainC.who === 'alice', String(plainC.who)],
  ['C: the persona tab opened signed out', s3Tab.signedOutAtFirst],
  ['C: its sign-in asks who you are instead of arriving as the browser\'s alice',
    s3Tab.landed === 'idp-form', s3Tab.landed],
  ['C: the persona tab runs the storage shim', s3Shim === true],
  ['C: no sign-in alert while the chain runs, and none after', alertsC.length === 0 && alertsCAfter.length === 0,
    `${JSON.stringify(alertsC)} / ${JSON.stringify(alertsCAfter)}`],
  ['C: the persona signs in as bob and keeps it (its cookies were captured)', s3Login.who === 'bob', String(s3Login.who)],
  ['C: no unguarded sign-in site is reported for the tab', s3Status.unguardedSignInSites.length === 0,
    JSON.stringify(s3Status.unguardedSignInSites)],
  ['C: the browser\'s own login is still alice', plainAfterC.who === 'alice', String(plainAfterC.who)],
]);
process.exit(pass ? 0 : 1);
