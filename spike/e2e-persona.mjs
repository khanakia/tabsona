// Opening a PERSONA opens every one of its sites as a tab, each signed in as the right
// identity. This is the feature that justifies personas existing — the original mission
// was "stop juggling five browsers" — so it gets its own test.
//
// Runs against the fixture, where two distinct ports are two distinct sites, which is
// exactly the multi-app shape a persona is for.

import {
  attach, claimNewTab, pageIds, report, sleep, startChrome, waitFor,
} from './lib/harness.mjs';

const PORT_A = 'http://localhost:8787/';
// A second fixture on another port is a genuinely different SITE, which is the
// multi-app shape a persona exists for. (127.0.0.1 is not usable: node rejects the
// host mismatch with 421.)
const PORT_B = process.env.SECOND_SITE ?? 'http://localhost:8788/';
const HOST_A = new URL(PORT_A).host;
const HOST_B = new URL(PORT_B).host;

const whoami = `fetch('/whoami',{cache:'no-store'}).then(r=>r.json()).then(j=>j.user)`;
const loggedIn = `fetch('/whoami',{cache:'no-store'}).then(r=>r.json()).then(j=>!!j.user)`;
const formReady = `!!document.querySelector('form[action="/login"]')`;
const login = (user) => `(() => {
  const f = [...document.querySelectorAll('form[action="/login"]')]
    .find(f => f.querySelector('input[name=user]').value === ${JSON.stringify(user)});
  if (!f) return 'no-form'; f.submit(); return 'submitted';
})()`;

const chrome = await startChrome(9810);

// Both origins must be granted, or one of the two sites silently stays un-isolated.
for (const origin of [new URL(PORT_A).origin, new URL(PORT_B).origin]) {
  const granted = await chrome.swSession.eval(
    `chrome.permissions.contains({origins:[${JSON.stringify(`${origin}/*`)}]})`) === true;
  if (!granted) {
    console.error(`${origin}/* not granted — run via 'task e2e:persona', which pre-grants it`);
    await chrome.kill();
    process.exit(1);
  }
}

// Build one persona holding two DIFFERENT sites, each signed in as a different user —
// so a cross-contamination between them is visible rather than coincidental.
const personaId = await chrome.op('newPersona("Acme admin")');
const plan = [
  { url: PORT_A, host: HOST_A, user: 'alice' },
  { url: PORT_B, host: HOST_B, user: 'bob' },
];

for (const step of plan) {
  const before = await pageIds(chrome);
  await chrome.op(`addSite(${JSON.stringify(personaId)}, ${JSON.stringify(step.url)})`);
  const target = await claimNewTab(chrome, before, step.host);
  const page = await attach(target);
  await waitFor(page, formReady, `${step.host}: login form`);
  await page.eval(login(step.user));
  await waitFor(page, loggedIn, `${step.host}: signed in`);
  await sleep(600);
  step.tabId = Number(target.id ? 0 : 0);
  page.close();
}

// Close every tab, so opening the persona has to restore from saved state alone.
await chrome.swSession.eval(
  `chrome.tabs.query({}).then(ts => Promise.all(ts
     .filter(t => t.url && (t.url.includes(${JSON.stringify(HOST_A)}) || t.url.includes(${JSON.stringify(HOST_B)})))
     .map(t => chrome.tabs.remove(t.id))))`);
await sleep(1500);

const stateBefore = await chrome.op('getState()');
const persona = stateBefore.personas.find((p) => p.id === personaId);
const siteCount = persona?.sessions.length ?? 0;

// --- the thing under test ---------------------------------------------------
const beforeOpen = await pageIds(chrome);
const opened = await chrome.op(`openPersona(${JSON.stringify(personaId)})`);
await sleep(2000);

const fresh = (await chrome.targets()).filter(
  (t) => t.type === 'page' && !beforeOpen.has(t.id)
    && (t.url.includes(HOST_A) || t.url.includes(HOST_B)));

const seen = [];
for (const target of fresh) {
  const page = await attach(target);
  await waitFor(page, loggedIn, `${target.url}: signed in after open-persona`, 25000);
  seen.push({ url: target.url, who: await page.eval(whoami) });
  page.close();
}

// Tab groups: cosmetic, so a failure here must not fail isolation — but when the
// setting is on and the API exists, the tabs should be grouped together.
const groups = await chrome.swSession.eval(
  `chrome.tabGroups ? chrome.tabGroups.query({}).then(g => JSON.stringify(g.map(x => x.title))) : '[]'`);
const grouped = JSON.parse(groups ?? '[]');

await chrome.kill();

console.log(`\npersona held ${siteCount} sites; openPersona reported ${opened} tabs`);
seen.forEach((s) => console.log(`   ${s.url.replace(/#.*$/, '').padEnd(34)} ${s.who}`));
console.log(`   chrome tab groups: ${JSON.stringify(grouped)}`);

const everyTabSignedIn = seen.length > 0 && seen.every((s) => s.who !== null);
const identitiesMatchSites = seen.length === 2
  && seen.find((s) => s.url.includes(HOST_A))?.who === 'alice'
  && seen.find((s) => s.url.includes(HOST_B))?.who === 'bob';

const pass = report('open a persona', [
  ['persona holds both sites', siteCount === 2, `${siteCount}`],
  ['opened one tab per site', opened === siteCount && seen.length === siteCount, `${opened}`],
  ['every opened tab is signed in', everyTabSignedIn],
  ['each site kept its own identity', identitiesMatchSites, seen.map((s) => s.who).join(' / ')],
  ['tabs joined a named Chrome group', grouped.includes('Acme admin'), JSON.stringify(grouped)],
]);
process.exit(pass ? 0 : 1);
