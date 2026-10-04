// Two personas on one origin, one mini app per storage layer: cookie, localStorage,
// IndexedDB. Each layer must keep the personas apart on its own.
//
// Uses the storage lab (spike/fixture/lab.js): every lab app keeps its login in exactly
// ONE layer, so a pass here is a claim about that layer and nothing else. The IndexedDB
// app is also a naive offline-first notes app — one fixed database name, no ownership
// check — the shape that corrupts accounts when two users share its database.
//
// Per layer:
//   1. CONTROL   two PLAIN tabs: sign in as alice in one, the other reads alice too.
//                Proves the collision is real, so step 2 is not passing vacuously.
//   2. ISOLATION persona A signs in as alice, persona B as bob, side by side: each reads
//                its own user, before and after a reload.
// IndexedDB only:
//   3. offline notes stay with their persona; databases() and db.name show only the
//      app's own name; going online uploads A's queue as alice and B's as bob; deleting
//      the database in A leaves B's intact.
//   4. the badge reports indexedDB `covered` for the origin.
//
// See docsi/SPEC_INDEXEDDB.md for the design this proves.

import { attach, claimNewTab, pageIds, report, requireGrant, sleep, startChrome, waitFor } from './lib/harness.mjs';

const ORIGIN = process.env.LAB_ORIGIN ?? 'http://localhost:8787';
const HOST = new URL(ORIGIN).host;
const LAYERS = ['cookie', 'local', 'idb'];

const chrome = await startChrome(9885);
await requireGrant(chrome, ORIGIN);
await fetch(`${ORIGIN}/api/lab/reset`, { method: 'POST' });

/** Wait for a lab page to have rendered who is signed in. */
const ready = (page) => waitFor(page, `document.readyState === 'complete' && !!window.__lab && !!window.__labReady`, 'lab page ready', 20000);
const lab = (page, call) => page.eval(`window.__lab.${call}`);

async function goto(page, path) {
  await page.eval(`location.href = ${JSON.stringify(`${ORIGIN}${path}`)}`);
  await sleep(300);
  await ready(page);
}

async function reload(page) {
  await page.send('Page.reload', { ignoreCache: true });
  await sleep(500);
  await ready(page);
}

/** Wait until the page's own whoami() returns `user` — a cookie login lands in the
 *  persona's jar asynchronously (observed, then a rule resync), so poll the truth. */
const becomes = (page, user, label) =>
  waitFor(page, `window.__lab.whoami().then((u) => u === ${JSON.stringify(user)})`, label, 10000);

async function plainTab(path) {
  const before = await pageIds(chrome);
  await chrome.newTab(`${ORIGIN}${path}`);
  const page = await attach(await claimNewTab(chrome, before, HOST));
  await ready(page);
  return page;
}

async function personaTab(personaId) {
  const before = await pageIds(chrome);
  const tabId = await chrome.op(`addSite(${JSON.stringify(personaId)}, ${JSON.stringify(`${ORIGIN}/`)})`);
  const page = await attach(await claimNewTab(chrome, before, HOST));
  await waitFor(page, `document.readyState === 'complete'`, 'persona tab loaded', 20000);
  return { page, tabId };
}

const checks = [];
const check = (label, ok, detail) => { checks.push([label, ok, detail]); };

// --- 1. CONTROL: plain tabs collide on every layer ---------------------------
for (const layer of LAYERS) {
  const one = await plainTab(`/lab/${layer}`);
  const two = await plainTab(`/lab/${layer}`);
  await lab(one, `login('alice')`);
  const seen = await lab(two, 'whoami()');
  check(`control · ${layer}: a second PLAIN tab sees the first tab's login`, seen === 'alice', String(seen));
  if (layer === 'idb') {
    await lab(one, 'setOffline(true)');
    await lab(one, `addNote('plain-note')`);
    const notes = await lab(two, 'notes()');
    check('control · idb: a second PLAIN tab sees the first tab\'s offline notes', notes.includes('plain-note'), JSON.stringify(notes));
    await lab(one, 'deleteDb()');
  }
  await lab(one, 'logout()');
  one.close();
  two.close();
}
// Close every plain lab tab, so nothing below can be served by a plain tab's state.
await chrome.swSession.eval(`chrome.tabs.query({}).then(ts => Promise.all(ts
  .filter(t => t.url && t.url.includes(${JSON.stringify(HOST)})).map(t => chrome.tabs.remove(t.id))))`);
await sleep(800);

// --- 2. ISOLATION: two personas, side by side --------------------------------
const personaA = await chrome.op('newPersona("Lab A")');
const personaB = await chrome.op('newPersona("Lab B")');
const a = await personaTab(personaA);
const b = await personaTab(personaB);

for (const layer of LAYERS) {
  await goto(a.page, `/lab/${layer}`);
  await goto(b.page, `/lab/${layer}`);
  await lab(a.page, `login('alice')`);
  await lab(b.page, `login('bob')`);
  await becomes(a.page, 'alice', `${layer}: persona A signed in`);
  await becomes(b.page, 'bob', `${layer}: persona B signed in`);
  const whoA = await lab(a.page, 'whoami()');
  const whoB = await lab(b.page, 'whoami()');
  check(`${layer}: personas keep separate logins side by side`, whoA === 'alice' && whoB === 'bob', `A=${whoA} B=${whoB}`);

  await reload(a.page);
  await reload(b.page);
  const afterA = await lab(a.page, 'whoami()');
  const afterB = await lab(b.page, 'whoami()');
  check(`${layer}: …and still after a reload`, afterA === 'alice' && afterB === 'bob', `A=${afterA} B=${afterB}`);
}

// --- 3. IndexedDB: offline data, listings, upload, delete ----------------------
// The tabs are on /lab/idb now, both signed in.
await lab(a.page, 'setOffline(true)');
await lab(b.page, 'setOffline(true)');
await lab(a.page, `addNote('alice-offline')`);
await lab(b.page, `addNote('bob-offline')`);
const notesA = await lab(a.page, 'notes()');
const notesB = await lab(b.page, 'notes()');
check('idb: each persona sees only its own offline notes', JSON.stringify(notesA) === '["alice-offline"]' && JSON.stringify(notesB) === '["bob-offline"]',
  `A=${JSON.stringify(notesA)} B=${JSON.stringify(notesB)}`);

const namesA = await lab(a.page, 'dbNames()');
const nameProp = await lab(a.page, 'dbNameProperty()');
check('idb: databases() lists only the app\'s own name, no prefix, no other persona', JSON.stringify(namesA) === '["lab-notes"]', JSON.stringify(namesA));
check('idb: db.name reads back the name the app asked for', nameProp === 'lab-notes', String(nameProp));

await lab(a.page, 'setOffline(false)');
await lab(b.page, 'setOffline(false)');
await lab(a.page, 'sync()');
await lab(b.page, 'sync()');
const serverA = await lab(a.page, 'serverNotes()');
const serverB = await lab(b.page, 'serverNotes()');
check('idb: going online uploads each queue as its own user, never crossed',
  JSON.stringify(serverA) === '["alice-offline"]' && JSON.stringify(serverB) === '["bob-offline"]',
  `alice=${JSON.stringify(serverA)} bob=${JSON.stringify(serverB)}`);

await reload(a.page);
const persisted = await lab(a.page, 'notes()');
check('idb: offline data survives a reload in its persona', JSON.stringify(persisted) === '["alice-offline"]', JSON.stringify(persisted));

const deleted = await lab(a.page, 'deleteDb()');
const bAfterDelete = await lab(b.page, 'notes()');
check('idb: deleting the database in A leaves B\'s intact', deleted === true && JSON.stringify(bAfterDelete) === '["bob-offline"]',
  `deleted=${deleted} B=${JSON.stringify(bAfterDelete)}`);

// --- 4. the badge's claim ------------------------------------------------------
await chrome.op(`statusForTab(${b.tabId})`);
const coverage = await chrome.op('coverageReport()');
const idbStatus = coverage.find((c) => c.origin === ORIGIN)?.coverage.find((l) => l.layer === 'indexedDB');
check('badge: indexedDB reported covered for the origin', idbStatus?.status === 'covered', JSON.stringify(idbStatus));

a.page.close();
b.page.close();
await chrome.kill();

const pass = report('storage lab — cookie, localStorage and IndexedDB kept per persona', checks);
process.exit(pass ? 0 : 1);
