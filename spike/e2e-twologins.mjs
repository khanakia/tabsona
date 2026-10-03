// Two logins for ONE site — the thing a user could not work out how to do.
//
// The model says two logins for one site means two personas, and that is deliberate: it
// is what keeps "open this persona" unambiguous. But the journey has to be one action
// from where the user is standing, not a sequence they must invent.
//
// Asserts the whole round trip:
//   1. sign in once, saved into persona A
//   2. "another login for this site" -> a NEW persona, named after the site, signed OUT
//   3. sign in there as somebody else
//   4. both personas now hold that site, with DIFFERENT identities, at the same time

import {
  attach, claimNewTab, pageIds, pickApp, report, requireGrant, sleep, startChrome, waitFor,
} from './lib/harness.mjs';

const app = pickApp();
const [first, second] = app.users;
const chrome = await startChrome(9860);
await requireGrant(chrome, app.origin);

// --- 1. the first login ------------------------------------------------------
const beforeA = await pageIds(chrome);
const personaA = await chrome.op('newPersona("Acme admin")');
await chrome.op(`addSite(${JSON.stringify(personaA)}, ${JSON.stringify(app.url)})`);
const targetA = await claimNewTab(chrome, beforeA, app.host);
const pageA = await attach(targetA);
await waitFor(pageA, app.formReady, 'first login form');
await pageA.eval(app.login(first));
await waitFor(pageA, app.loggedIn, 'first user signed in');
await sleep(700);
const whoA = await pageA.eval(app.whoami);

// --- 2. another login for the same site, into an EXISTING second persona -------
//
// This is the path the user asked for in their own words: "in group 2 I want to create a
// new session for site1.com". Persona B already exists and holds nothing for this site;
// addSite gives it an empty session and opens it signed out.
const personaB = await chrome.op('newPersona("Client X")');
const beforeB = await pageIds(chrome);
await chrome.op(`addSite(${JSON.stringify(personaB)}, ${JSON.stringify(app.url)})`);
const targetB = await claimNewTab(chrome, beforeB, app.host);
const pageB = await attach(targetB);
await waitFor(pageB, app.formReady, 'second tab shows a login form');

// It must arrive SIGNED OUT: inheriting the first login would make the whole exercise
// pointless, and is exactly what an un-isolated tab would do.
const freshIsSignedOut = await pageB.eval(app.whoami) === null;

const afterCreate = await chrome.op('getState()');
const sitePersonas = afterCreate.personas.filter(
  (p) => p.sessions.some((s) => s.site === app.origin));
const newPersona = afterCreate.personas.find((p) => p.id === personaB);

// --- 3. sign in as somebody else ---------------------------------------------
await pageB.eval(app.login(second));
await waitFor(pageB, app.loggedIn, 'second user signed in');
await sleep(700);
const whoB = await pageB.eval(app.whoami);

// --- 4. both alive at once ----------------------------------------------------
await pageA.eval('location.reload()');
await waitFor(pageA, app.loggedIn, 'first tab survived');
const whoAAfter = await pageA.eval(app.whoami);
const whoBAfter = await pageB.eval(app.whoami);

const finalState = await chrome.op('getState()');
const holders = finalState.personas.filter((p) => p.sessions.some((s) => s.site === app.origin));
const bothSaved = holders.length === 2
  && holders.every((p) => p.sessions.some((s) => s.site === app.origin && s.state !== 'empty'));

await chrome.kill();

console.log(`\nsite: ${app.origin}`);
console.log(`   persona A  ${String(first.label).padEnd(22)} ${whoAAfter}`);
console.log(`   persona B  ${String(second.label).padEnd(22)} ${whoBAfter}`);
console.log(`   second persona: ${newPersona?.name}`);
console.log(`   personas holding this site: ${holders.map((p) => p.name).join(', ')}`);

const pass = report(`two logins for one site — ${app.name}`, [
  ['the first login saved', whoA !== null, String(whoA)],
  ['an EXISTING second persona now holds the site', sitePersonas.length === 2, `${sitePersonas.length}`],
  ['without disturbing its name', newPersona?.name === 'Client X', String(newPersona?.name)],
  ['the new tab arrived SIGNED OUT', freshIsSignedOut],
  ['the second login saved', whoB !== null, String(whoB)],
  ['both are signed in at the same time', whoAAfter !== null && whoBAfter !== null && whoAAfter !== whoBAfter,
    `${whoAAfter} vs ${whoBAfter}`],
  ['both personas hold a non-empty session for the site', bothSaved],
]);
process.exit(pass ? 0 : 1);
