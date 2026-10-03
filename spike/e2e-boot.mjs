// Reproduces the failure a real install hit and a headless run never did:
//
//   Uncaught (in promise) Error: Duplicate script ID 'tabsona-shim'
//
// On an extension reload at chrome://extensions, the service-worker module body runs
// AND chrome.runtime.onInstalled fires — two boots at once. Both unregister (finding
// nothing), both register, and the second throws, taking the shim down with it.
//
// Asserts: concurrent boots never throw, and exactly one copy of each script ends up
// registered no matter how many times boot runs.

import { launchChrome, sleep } from './lib/cdp.mjs';

const EXT = new URL('../apps/extension/dist', import.meta.url).pathname;
const PORT = 9870;

const chrome = await launchChrome({ port: PORT, extensionPath: EXT, ignoreCertErrors: true });
if (!chrome.swSession) { console.error('no service worker'); await chrome.kill(); process.exit(1); }
await sleep(1500);

const sw = chrome.swSession;
const registered = async () => JSON.parse(await sw.eval(
  `chrome.scripting.getRegisteredContentScripts().then(s => JSON.stringify(s.map(x => x.id).sort()))`));

const atBoot = await registered();
console.log('after first boot        :', JSON.stringify(atBoot));

// Five boots at once — far harsher than the two a reload produces.
const concurrent = await sw.eval(`
  Promise.allSettled([
    globalThis.__tabsona.boot(), globalThis.__tabsona.boot(), globalThis.__tabsona.boot(),
    globalThis.__tabsona.boot(), globalThis.__tabsona.boot(),
  ]).then(rs => JSON.stringify(rs.map(r => r.status === 'rejected' ? String(r.reason) : 'ok')))
`);
console.log('5 concurrent boots      :', concurrent);

// And registration called directly in parallel, which is the exact racing step.
const parallelRegister = await sw.eval(`
  Promise.allSettled([
    globalThis.__tabsona.registerContentScripts(),
    globalThis.__tabsona.registerContentScripts(),
    globalThis.__tabsona.registerContentScripts(),
  ]).then(rs => JSON.stringify(rs.map(r => r.status === 'rejected' ? String(r.reason) : 'ok')))
`);
console.log('3 parallel registrations:', parallelRegister);

await sleep(500);
const after = await registered();
console.log('registered scripts after:', JSON.stringify(after));

const errorLogs = sw.logs.filter((l) => /Duplicate script ID|boot failed/i.test(l));
console.log('worker errors           :', errorLogs.length ? errorLogs : 'none');

await chrome.kill();

const noDuplicateError = !JSON.stringify([concurrent, parallelRegister]).includes('Duplicate script ID');
const noWorkerError = errorLogs.length === 0;
const exactlyOneEach = after.length === 2
  && after.includes('tabsona-shim') && after.includes('tabsona-badge');

console.log('\n   concurrent boots threw nothing? ', noDuplicateError);
console.log('   worker logged no boot failure?  ', noWorkerError);
console.log('   exactly one of each script?     ', exactlyOneEach, JSON.stringify(after));

const pass = noDuplicateError && noWorkerError && exactlyOneEach;
console.log(`\nVERDICT: ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
