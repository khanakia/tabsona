// Two behaviours about TABS, both reported by real use rather than found by a test.
//
// A. "open in this tab" must move EVERY layer — cookies and page storage — and must not
//    discard what the outgoing session had. v1's `use here` moved cookies only.
//
// B. A blank ⌘T tab must NEVER join a persona. The opener-inheritance exists so a
//    target=_blank link out of an app stays in its session; a new tab has an opener
//    too, so it inherited and an empty tab silently joined a persona.

import {
  attach, claimNewTab, pageIds, report, sleep, startChrome, waitFor,
} from './lib/harness.mjs';

const URL_A = 'http://localhost:8787/';
const HOST = new URL(URL_A).host;

const whoami = `fetch('/whoami',{cache:'no-store'}).then(r=>r.json()).then(j=>j.user)`;
const loggedIn = `fetch('/whoami',{cache:'no-store'}).then(r=>r.json()).then(j=>!!j.user)`;
const formReady = `!!document.querySelector('form[action="/login"]')`;
const namespace = `window.__tabsonaSession ? window.__tabsonaSession.id : null`;
const login = (user) => `(() => {
  const f = [...document.querySelectorAll('form[action="/login"]')]
    .find(f => f.querySelector('input[name=user]').value === ${JSON.stringify(user)});
  if (!f) return 'no-form'; f.submit(); return 'submitted';
})()`;

const chrome = await startChrome(9830);

// --- A: open-in-this-tab moves every layer ----------------------------------
const personaA = await chrome.op('newPersona("roleA")');
const personaB = await chrome.op('newPersona("roleB")');

const before = await pageIds(chrome);
await chrome.op(`addSite(${JSON.stringify(personaA)}, ${JSON.stringify(URL_A)})`);
const target = await claimNewTab(chrome, before, HOST);
const page = await attach(target);
await waitFor(page, formReady, 'login form');
await page.eval(login('alice'));
await waitFor(page, loggedIn, 'alice signed in');
await sleep(700);

const beforeSwitch = {
  who: await page.eval(whoami),
  ns: await page.eval(namespace),
};

const stateBefore = await chrome.op('getState()');
const sessionA = stateBefore.personas.find((p) => p.id === personaA)?.sessions[0];
const bindings = await chrome.json(`chrome.storage.session.get('bindings').then(g => g.bindings ?? {})`);
const tabId = Number(Object.entries(bindings).find(([, sid]) => sid === sessionA?.id)?.[0]);

// personaB has no session for this site yet, so give it one, then switch into it.
await chrome.op(`addSite(${JSON.stringify(personaB)}, ${JSON.stringify(URL_A)})`);
await sleep(2500);
const stateMid = await chrome.op('getState()');
const sessionB = stateMid.personas.find((p) => p.id === personaB)?.sessions[0];

await chrome.swSession.eval(`chrome.tabs.update(${tabId}, {active: true})`);
await sleep(400);
await chrome.op(`openSession(${JSON.stringify(sessionB?.id)}, "this-tab")`);
await sleep(3500);

const afterSwitch = {
  who: await page.eval(whoami),
  ns: await page.eval(namespace),
  bound: (await chrome.json(`chrome.storage.session.get('bindings').then(g => g.bindings ?? {})`))[String(tabId)],
};

// Did session A keep what it had at the moment of the switch?
const stateAfter = await chrome.op('getState()');
const savedA = stateAfter.personas.find((p) => p.id === personaA)?.sessions[0];

// --- B: a blank new tab must not inherit ------------------------------------
// Simulates ⌘T from inside a session tab: a tab created WITH an opener and no url.
const blank = await chrome.swSession.eval(
  `chrome.tabs.create({ openerTabId: ${tabId} }).then(t => t.id)`);
await sleep(1500);
const bindingsAfterBlank = await chrome.json(
  `chrome.storage.session.get('bindings').then(g => g.bindings ?? {})`);
const blankInherited = String(blank) in bindingsAfterBlank;

// And the behaviour the inheritance exists FOR must still work: a target=_blank link
// clicked INSIDE a session tab should stay in that session.
//
// Clicked for real rather than fabricated with chrome.tabs.create, because the product
// listens to webNavigation.onCreatedNavigationTarget — an event only a genuine link /
// window.open raises. A synthetic tab would not exercise the code path at all.
const beforeLink = await pageIds(chrome);
await page.eval(`(() => {
  const a = document.createElement('a');
  a.href = ${JSON.stringify(URL_A)};
  a.target = '_blank';
  a.textContent = 'open';
  document.body.appendChild(a);
  a.click();
  return true;
})()`);
const linkedTarget = await claimNewTab(chrome, beforeLink, HOST).catch(() => null);
await sleep(2500);
const bindingsAfterLink = await chrome.json(
  `chrome.storage.session.get('bindings').then(g => g.bindings ?? {})`);
const linkedTabId = Number(await chrome.swSession.eval(
  `chrome.tabs.query({}).then(ts => { const t = ts.find(x => x.id !== ${tabId} && x.url && x.url.includes(${JSON.stringify(HOST)})); return t ? t.id : -1; })`));
const linkInherited = bindingsAfterLink[String(linkedTabId)] === afterSwitch.bound;

await chrome.kill();

console.log(`\nbefore switch: ${beforeSwitch.who} (namespace ${beforeSwitch.ns})`);
console.log(`after switch : ${afterSwitch.who} (namespace ${afterSwitch.ns}, bound ${afterSwitch.bound})`);
console.log(`session A kept: ${savedA?.storageKeyCount} keys, ${savedA?.cookieCount} cookies`);
console.log(`blank tab ${blank} inherited: ${blankInherited}; linked tab ${linkedTabId} inherited: ${linkInherited}`);

const pass = report('tab behaviour', [
  ['open-in-this-tab rebinds the tab', afterSwitch.bound === sessionB?.id],
  ['cookies followed the switch', afterSwitch.who === null, `${beforeSwitch.who} -> ${afterSwitch.who}`],
  ['page storage followed the switch', afterSwitch.ns === sessionB?.id, `${beforeSwitch.ns} -> ${afterSwitch.ns}`],
  ["the outgoing session kept its data", (savedA?.storageKeyCount ?? 0) + (savedA?.cookieCount ?? 0) > 0],
  ['a blank new tab does NOT join a persona', !blankInherited],
  ['a link from a session tab DOES stay in it', linkInherited],
]);
process.exit(pass ? 0 : 1);
