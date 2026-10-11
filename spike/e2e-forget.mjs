// "Forget this login" while its tab is open, in the user's words: "i say forget this login
// but i am still logged and tab is still there in tabsona claude group".
//
// The answer shipped: Forget this login and Delete persona CLOSE the open tabs (a tab
// that was the persona's, dropped onto the browser's jar, is one tab showing one identity
// while acting as another). Their page data is scrubbed from the origin first. Only Leave
// persona (unbindTab) keeps the tab, as a plain tab. This suite pins both outcomes.
//
// For the kept tab, "still logged in" has two very different meanings:
//   (a) the FORGOTTEN persona's login still in force — a bug (a stale rule, mirror or shim)
//   (b) the browser's OWN login for the site — legitimate: a left tab is a normal tab
// So each leave path runs twice. Plain browser signed OUT: the tab must be signed out.
// Plain browser signed in as alice, persona signed in as bob: the tab must be alice, never
// bob. For Leave persona the tab must leave the persona's Chrome tab group, lose the page-title
// marker, hold no binding or per-tab rule, and keep none of the persona's page data.
//
// Three paths: deleteSession (the popup row menu's "Forget this login") and deletePersona
// close the tab; unbindTab ("Leave persona" — keeps the login, so the persona's own data
// stays, but the tab is the browser's again) keeps it.

import {
  attach, claimNewTab, pageIds, pickApp, reloadExtension, report, requireGrant, sleep, startChrome, waitFor,
} from './lib/harness.mjs';

const app = pickApp();
const [alice, bob] = app.users;
const chrome = await startChrome(9892);
await requireGrant(chrome, app.origin);

/** The fixture's own <title>: anything else in front of it is the persona's marker. */
const PLAIN_TITLE = 'fixture';

const hostTabIds = () => chrome.json(
  `chrome.tabs.query({}).then(ts => ts.filter(t => t.url && t.url.includes(${JSON.stringify(app.host)})).map(t => t.id))`);

async function groupTitleOf(tabId) {
  return chrome.swSession.eval(`chrome.tabs.get(${Number(tabId)}).then(t =>
    t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE ? null : chrome.tabGroups.get(t.groupId).then(g => g.title))
    .catch(e => 'error: ' + e.message)`);
}

/** Sign the browser in (or out) on a plain tab, then close that tab. */
async function setBrowserLogin(user) {
  const before = await pageIds(chrome);
  await chrome.newTab(app.url);
  const t = await claimNewTab(chrome, before, app.host);
  const p = await attach(t);
  await sleep(1500);
  if (await p.eval(app.loggedIn) === true) {
    await p.eval(`document.querySelector('form[action="/logout"]')?.submit() ?? 'no-logout'`);
    await sleep(1500);
  }
  if (user) {
    await waitFor(p, app.formReady, 'plain login form');
    await p.eval(app.login(user));
    await waitFor(p, app.loggedIn, 'plain tab signed in');
  }
  p.close();
  const open = await hostTabIds();
  await chrome.swSession.eval(`chrome.tabs.remove(${open.at(-1)})`).catch(() => undefined);
  await sleep(400);
}

/** What the tab's state looks like in the worker, all at once. */
async function inspect(tabId, sessionId) {
  return chrome.json(`(async () => {
    // Bindings live in chrome.storage.session (repo.ts), NOT local: reading local made this
    // check pass vacuously.
    const stored = await chrome.storage.session.get('bindings');
    const bound = Object.hasOwn(stored.bindings || {}, '${tabId}');
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const tabRules = rules.filter(r => (r.condition.tabIds || []).includes(${tabId})).length;
    return { bound, tabRules };
  })()`);
}

async function runCase(name, how, browserUser, interlude = null) {
  await setBrowserLogin(browserUser);
  const persona = await chrome.op(`newPersona(${JSON.stringify('Forget ' + name)})`);
  const before = await pageIds(chrome);
  await chrome.op(`addSite(${JSON.stringify(persona)}, ${JSON.stringify(app.url)})`);
  const target = await claimNewTab(chrome, before, app.host);
  const page = await attach(target);
  await waitFor(page, app.formReady, `${name}: persona tab shows a login form`);
  await page.eval(app.login(bob));
  await waitFor(page, app.loggedIn, `${name}: persona signed in`);
  await sleep(1200);
  const tabId = Number((await hostTabIds()).at(-1));
  const state = await chrome.op('getState()');
  const sessionId = state.personas.find((p) => p.id === persona).sessions[0].id;
  const personaWho = await page.eval(app.whoami);
  const groupedBefore = await groupTitleOf(tabId);
  const titleBefore = await page.eval('document.title');

  // `interlude` puts the browser in the state a user's is in when Forget is clicked.
  const afterInterlude = interlude ? await interlude({ page, tabId, sessionId, persona }) : null;

  if (how === 'session') await chrome.op(`deleteSession(${JSON.stringify(sessionId)})`);
  if (how === 'persona') await chrome.op(`deletePersona(${JSON.stringify(persona)})`);
  if (how === 'unbind') await chrome.op(`unbindTab(${tabId})`);
  await sleep(2500);

  const closes = how !== 'unbind';
  if (closes) {
    // The tab must be GONE, not merely ungrouped or plain.
    const alive = await chrome.swSession.eval(`chrome.tabs.get(${tabId}).then(() => true).catch(() => false)`);
    const left = await inspect(tabId, sessionId);
    page.close();
    const leftover = await originLeftovers(sessionId);
    return { name, closes, afterInterlude, personaWho, groupedBefore, titleBefore, alive, left, leftover, browserUser };
  }

  await waitFor(page, `document.readyState === 'complete'`, `${name}: tab reloaded`);

  const who = await page.eval(app.whoami);
  const group = await groupTitleOf(tabId);
  const title = await page.eval('document.title');
  const shim = await page.eval(`typeof window.__tabsonaSession === 'object'`);
  const mirror = await page.eval(`Object.keys(localStorage).filter(k => k.startsWith('__tabsona_cookies:'))`);
  const left = await inspect(tabId, sessionId);
  page.close();
  await chrome.swSession.eval(`chrome.tabs.remove(${tabId})`).catch(() => undefined);
  await sleep(400);
  return { name, closes, afterInterlude, personaWho, groupedBefore, titleBefore, who, group, title, shim, mirror, left, browserUser };
}

/** The forgotten login's page data lives on the ORIGIN, so a closed tab must not leave it
 *  behind: open a plain tab and look for the session's namespaced keys and the mirror. */
async function originLeftovers(sessionId) {
  const before = await pageIds(chrome);
  await chrome.newTab(app.url);
  const t = await claimNewTab(chrome, before, app.host);
  const p = await attach(t);
  await sleep(1200);
  const keys = await p.eval(`Object.keys(localStorage).filter(k => k.startsWith('__tabsona_cookies:') || k.startsWith(${JSON.stringify(sessionId + '::')}))`);
  p.close();
  const open = await hostTabIds();
  await chrome.swSession.eval(`chrome.tabs.remove(${open.at(-1)})`).catch(() => undefined);
  await sleep(400);
  return keys;
}

const results = [];
for (const how of ['session', 'persona', 'unbind']) {
  results.push(await runCase(`${how}/out`, how, null));
  results.push(await runCase(`${how}/alice`, how, alice));
}

/** After an extension reload the tab must be the persona's again: same login, grouped,
 *  bound, ruled, badge back. */
async function afterReload({ page, tabId, sessionId }) {
  await reloadExtension(chrome);
  await waitFor(page, `document.readyState === 'complete'`, 'tab reloaded after adoption');
  await sleep(1500);
  const who = await page.eval(app.whoami);
  const status = await chrome.op(`statusForTab(${tabId})`);
  return {
    who, group: await groupTitleOf(tabId), sessionId: status.sessionId,
    left: await inspect(tabId, sessionId),
  };
}

/** The worker has lost the binding AND has not re-adopted (the window between reload and
 *  boot, or a tab adoption could not script): Forget must still reach the tab by its marker. */
async function strandTab({ tabId }) {
  await reloadExtension(chrome);
  await sleep(1500);
  await chrome.swSession.eval(`chrome.storage.session.remove('bindings').then(() => globalThis.__tabsona.syncRules())`);
  return inspect(tabId, '');
}

/** The session is gone from the library AND the worker restarts (reload simulated): boot
 *  finds a tab carrying a marker for a login that no longer exists and must close it. */
async function strandedAtBoot({ tabId, sessionId }) {
  await chrome.swSession.eval(`chrome.storage.local.get('sessions').then((g) =>
    chrome.storage.local.set({ sessions: (g.sessions || []).filter((x) => x.id !== ${JSON.stringify(sessionId)}) }))`);
  await reloadExtension(chrome);
  await sleep(1500);
  return inspect(tabId, sessionId);
}

const reloadResults = [
  await runCase('reload+session/out', 'session', null, afterReload),
  await runCase('reload+session/alice', 'session', alice, afterReload),
  await runCase('stranded+session/alice', 'session', alice, strandTab),
  await runCase('boot-stranded/alice', 'none', alice, strandedAtBoot),
];
await chrome.kill();
console.log(JSON.stringify([...results, ...reloadResults], null, 1));

const checks = [];
for (const r of [...results, ...reloadResults]) {
  checks.push([`${r.name}: the persona tab was bob, grouped and title-marked before`, r.personaWho === 'bob' && r.groupedBefore !== null && r.titleBefore !== PLAIN_TITLE, `${r.personaWho} / ${r.groupedBefore} / ${r.titleBefore}`]);
  if (r.closes) {
    checks.push([`${r.name}: the tab was CLOSED`, r.alive === false, String(r.alive)]);
    checks.push([`${r.name}: no binding and no per-tab rule`, !r.left.bound && r.left.tabRules === 0, JSON.stringify(r.left)]);
    checks.push([`${r.name}: the login's page data and cookie mirror are gone from the origin`, r.leftover.length === 0, JSON.stringify(r.leftover)]);
    continue;
  }
  const expected = r.browserUser ? r.browserUser.label : null;
  checks.push([`${r.name}: afterwards the tab is the BROWSER's login (${expected}), never bob`, r.who === expected, String(r.who)]);
  checks.push([`${r.name}: the tab left the persona's tab group`, r.group === null, String(r.group)]);
  checks.push([`${r.name}: the page-title marker is gone`, r.title === PLAIN_TITLE, r.title]);
  checks.push([`${r.name}: no shim, no cookie mirror left in the page`, !r.shim && r.mirror.length === 0, `${r.shim} ${r.mirror}`]);
  checks.push([`${r.name}: no binding and no per-tab rule`, !r.left.bound && r.left.tabRules === 0, JSON.stringify(r.left)]);
}
for (const r of reloadResults.filter((x) => x.name.startsWith('reload'))) {
  const a = r.afterInterlude;
  checks.push([`${r.name}: after the extension reload the tab is re-adopted as the persona's (bob), same session`, a.who === 'bob' && a.sessionId !== null, `${a.who} / ${a.sessionId}`]);
  checks.push([`${r.name}: re-adopted tab is still grouped, bound and ruled`, a.group !== null && a.left.bound && a.left.tabRules > 0, JSON.stringify([a.group, a.left])]);
}
const stranded = reloadResults.find((x) => x.name.startsWith('stranded'));
checks.push([`${stranded.name}: the binding really was gone before Forget`, stranded.afterInterlude.bound === false, JSON.stringify(stranded.afterInterlude)]);

process.exit(report(`forget this login — ${app.name}`, checks) ? 0 : 1);
