// Upgrading from v1 must not break the worker, and must not lose anyone's logins.
//
// WHY THIS EXISTS: v2 shipped with "no migration test" written down as a known gap, and
// it bit within minutes of a real reload. `migrateFromV1` used a dynamic `import()`,
// which vite wraps in a preload helper that calls `window.dispatchEvent` — and a
// service worker has no `window`. Boot died with "ReferenceError: window is not
// defined", but ONLY when there was actually v1 data to migrate. Every automated run
// used a fresh profile and returned before that branch, so nothing caught it.
//
// Seeds v1-shaped storage, reboots the worker, and checks both halves: the worker comes
// up clean, and the old sessions arrive as personas with their cookies intact.

import { report, sleep, startChrome } from './lib/harness.mjs';

const chrome = await startChrome(9840);

// v1's shape: `sessions` was a RECORD keyed by id, each with a name, a flat cookie list
// and a storage map. No personas, no site key, no schemaVersion.
const V1 = {
  sessions: {
    s_old1: {
      id: 's_old1',
      name: 'admin',
      cookies: [{
        name: 'fixture_sid', value: 'legacy-value', domain: 'localhost', hostOnly: true,
        path: '/', expiresAt: null, secure: false, httpOnly: true, sameSite: 'lax',
        partitionKey: null,
      }],
      storage: { 'http://localhost:8787': { local: { fixture_token: 'alice' } } },
      domains: ['localhost'],
    },
    s_old2: {
      id: 's_old2',
      name: 'tenant-b',
      cookies: [],
      storage: { 'https://sync.localhost': { local: { 'authmgr.access': 'jwt' } } },
      domains: ['sync.localhost'],
    },
  },
};

await chrome.swSession.eval(`chrome.storage.local.clear().then(() =>
  chrome.storage.local.set(${JSON.stringify(V1)}))`);
await sleep(300);

const beforeLogs = chrome.swSession.logs.length;
await chrome.op('boot()');
await sleep(1500);

const newLogs = chrome.swSession.logs.slice(beforeLogs);
const bootErrors = newLogs.filter((l) => /boot failed|ReferenceError|is not defined/i.test(l));

const stored = JSON.parse(await chrome.swSession.eval(
  `chrome.storage.local.get(null).then(v => JSON.stringify(v))`));
const state = await chrome.op('getState()');

// Running boot twice must not duplicate anything: the schema marker guards it.
await chrome.op('boot()');
await sleep(1000);
const afterSecond = await chrome.op('getState()');

await chrome.kill();

const personas = state.personas ?? [];
const names = personas.map((p) => p.name).sort();
const adminPersona = personas.find((p) => p.name === 'admin');
const adminSession = adminPersona?.sessions[0];
const tenantSession = personas.find((p) => p.name === 'tenant-b')?.sessions[0];

console.log(`\npersonas after migration: ${JSON.stringify(names)}`);
personas.forEach((p) => p.sessions.forEach((s) => console.log(
  `   ${p.name.padEnd(10)} ${s.site.padEnd(26)} ${s.state}  ${s.cookieCount} cookies, ${s.storageKeyCount} keys`)));
console.log(`   schemaVersion: ${stored.schemaVersion}`);
if (bootErrors.length) console.log('   worker errors:', bootErrors);

const pass = report('upgrade from v1', [
  ['the worker booted with no error', bootErrors.length === 0, bootErrors.join(' | ')],
  ['both v1 sessions became personas', names.length === 2, JSON.stringify(names)],
  ['each persona kept its site', adminSession?.site === 'http://localhost:8787'
    && tenantSession?.site === 'https://sync.localhost',
  `${adminSession?.site} / ${tenantSession?.site}`],
  ['cookies survived the migration', adminSession?.cookieCount === 1, String(adminSession?.cookieCount)],
  ['page storage survived the migration', (adminSession?.storageKeyCount ?? 0) > 0
    && (tenantSession?.storageKeyCount ?? 0) > 0],
  ['a migrated session is not reported as empty', adminSession?.state !== 'empty', String(adminSession?.state)],
  ['the schema marker was written', stored.schemaVersion === 2, String(stored.schemaVersion)],
  ['booting again changes nothing', (afterSecond.personas ?? []).length === personas.length,
    `${(afterSecond.personas ?? []).length} vs ${personas.length}`],
]);
process.exit(pass ? 0 : 1);
