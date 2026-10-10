// Can an extension STOP a persona tab's navigation to a host it holds no permission for,
// and learn where the tab was going, before any request leaves?
//
// The sign-in gate (engine/gate.ts) rests on four Chrome behaviours, each checked here
// against a throwaway extension granted ONE origin (the SSO fixture app):
//
//   1. a session rule `{tabIds:[tab], resourceTypes:['main_frame'], action:block}` blocks a
//      navigation to an UN-granted host, with no host permission for it;
//   2. a higher-priority `allow` rule scoped by regexFilter to the granted origin lets the
//      tab's own app through (port-exact, which `excludedRequestDomains` cannot express),
//      and our modifyHeaders rules on the granted host still apply above it;
//   3. `webNavigation.onErrorOccurred` reports the blocked url, for a direct navigation AND
//      for a server 302 into the un-granted host, with `net::ERR_BLOCKED_BY_CLIENT`;
//   4. a `redirect` rule to an extension page, for comparison (expected to need host access).
//
// Plus the control: an UNBOUND tab navigates to the same host untouched.
//
// Run: node spike/probe-gate.mjs   (needs the SSO fixture on :8790 — task fixture:up-sso)

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, Session, sleep } from './lib/cdp.mjs';

const APP = 'http://localhost:8790';
const IDP = 'http://127.0.0.1:8790';
const RELAY_HOST = 'relay.localhost';

const dir = mkdtempSync(join(tmpdir(), 'probe-gate-'));
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'probe-gate', version: '0.0.1',
  permissions: ['declarativeNetRequest', 'webNavigation', 'tabs'],
  host_permissions: [`${APP}/*`],
  background: { service_worker: 'background.js' },
  web_accessible_resources: [{ resources: ['gate.html'], matches: ['<all_urls>'] }],
}));
writeFileSync(join(dir, 'gate.html'), '<!doctype html><title>gate</title><p id=g>gate page');
writeFileSync(join(dir, 'background.js'), `
globalThis.errs = [];
chrome.webNavigation.onErrorOccurred.addListener((d) => {
  if (d.frameId === 0) errs.push({ tabId: d.tabId, url: d.url, error: d.error });
});
globalThis.navs = [];
chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId === 0) navs.push({ tabId: d.tabId, url: d.url });
});
`);

const chrome = await launchChrome({ port: 9871, extensionPath: dir });
const sw = chrome.swSession;
if (!sw) { console.error('no service worker'); await chrome.kill(); process.exit(1); }

async function page(url) {
  const t = await chrome.newTab(url);
  const s = await Session.open(t.webSocketDebuggerUrl);
  await s.send('Runtime.enable');
  await sleep(800);
  const tabId = await sw.eval(`chrome.tabs.query({}).then(ts => ts.find(t => t.url === ${JSON.stringify(url)})?.id)`);
  return { s, tabId };
}
const go = async (p, url) => { await p.s.eval(`location.href = ${JSON.stringify(url)}`); await sleep(1500); };
const where = (p) => sw.eval(`chrome.tabs.get(${p.tabId}).then(t => t.url)`);
const who = (p) => p.s.eval(`fetch('/whoami',{cache:'no-store'}).then(r=>r.json()).then(j=>j.user).catch(e=>'ERR '+e)`);

// The browser's own login on the app, so "did our strip rule apply" has something to strip.
const plain = await page(`${APP}/?plain`);
await plain.s.eval(`fetch('/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'user=alice'}).then(r=>r.status)`);
const plainWho = await who(plain);

const bound = await page(`${APP}/?bound`);
const unbound = await page(`${APP}/?unbound`);
const allowRegex = '^https?://localhost:8790(?:[/?#]|$)';
const rules = (stripPriority) => [
  // the gate: block every http(s) main_frame of this tab...
  { id: 1, priority: 1, action: { type: 'block' },
    condition: { tabIds: [bound.tabId], resourceTypes: ['main_frame'], regexFilter: '^https?://' } },
  // ...except the granted origin. Not tab-scoped: an allow only competes with OUR rules.
  { id: 2, priority: 1, action: { type: 'allow' },
    condition: { resourceTypes: ['main_frame'], regexFilter: allowRegex } },
  // the existing strip rule, on every request of the tab
  { id: 3, priority: stripPriority, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'cookie', operation: 'remove' }] },
    condition: { tabIds: [bound.tabId], resourceTypes: ['main_frame', 'xmlhttprequest'] } },
];
const install = (r) => sw.eval(`chrome.declarativeNetRequest.getSessionRules().then(old =>
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: old.map(x => x.id), addRules: ${JSON.stringify(r)} })).then(() => 'ok', e => 'ERR ' + e.message)`);

const installed = await install(rules(2));

// 2. the tab's own app still loads, and the strip rule (priority 2) still applies above the allow.
await go(bound, `${APP}/`);
const appUrl = await where(bound);
const boundWho = await who(bound);

// 1+3. direct navigation to an un-granted host
await go(bound, `${IDP}/whoami`);
const directUrl = await where(bound);
// 1+3. a server 302 from the granted app into an un-granted host
await go(bound, `${APP}/`);
await bound.s.eval(`location.href = '/sso/start'`); await sleep(1500);
const redirectUrl = await where(bound);
const errs = await sw.eval('errs');

// control: an unbound tab is untouched
await go(unbound, `${IDP}/whoami`);
const unboundUrl = await where(unbound);
const unboundBody = await unbound.s.eval('document.body.innerText.slice(0,60)');

// strip at the SAME priority as the allow: does the allow suppress it?
await install(rules(1));
await go(bound, `${APP}/`);
const boundWhoEqual = await who(bound);

// 4. redirect to an extension page instead of block, no host permission for the target
const redirTab = await page(`${APP}/?redir`);
const redirInstall = await install([
  { id: 10, priority: 1, action: { type: 'redirect', redirect: { extensionPath: '/gate.html' } },
    condition: { tabIds: [redirTab.tabId], resourceTypes: ['main_frame'], regexFilter: '^https?://' } },
  { id: 11, priority: 1, action: { type: 'allow' }, condition: { resourceTypes: ['main_frame'], regexFilter: allowRegex } },
]);
await go(redirTab, `${IDP}/whoami`);
const redirUrl = await where(redirTab);

// 5. chrome.tabs.update to the extension page after a block (what the gate actually does)
const gateUrl = `chrome-extension://${chrome.extensionId}/gate.html`;
await sw.eval(`chrome.tabs.update(${bound.tabId}, { url: ${JSON.stringify(gateUrl)} }).then(() => 1)`);
await sleep(800);
const replaced = await where(bound);

const out = {
  installed, plainWho, appUrl, boundWho, boundWhoEqual, directUrl, redirectUrl, errs,
  unboundUrl, unboundBody, redirInstall, redirUrl, replaced,
};
console.log(JSON.stringify(out, null, 2));
await chrome.kill();
rmSync(dir, { recursive: true, force: true });

const ok = (label, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`); return cond; };
const blocked = (u) => errs.find((e) => e.tabId === bound.tabId && e.url.startsWith(u) && e.error === 'net::ERR_BLOCKED_BY_CLIENT');
const results = [
  ok('rules install with no host permission for the blocked hosts', installed === 'ok', installed),
  ok('allowed app still loads in the gated tab', appUrl.startsWith(APP), appUrl),
  ok('modifyHeaders above the allow still strips the cookie', plainWho === 'alice' && boundWho === null, `${plainWho} / ${boundWho}`),
  ok('direct navigation to an un-granted host is blocked and reported', !!blocked(IDP), JSON.stringify(blocked(IDP))),
  ok('a 302 from the app into an un-granted host is blocked and reported with the TARGET url',
    !!blocked(`http://${RELAY_HOST}:8790/relay/authorize`), JSON.stringify(blocked(`http://${RELAY_HOST}`))),
  ok('CONTROL: an unbound tab reaches the same host', unboundUrl.startsWith(IDP) && /user|null/.test(unboundBody), `${unboundUrl} ${unboundBody}`),
  ok('tabs.update replaces the blocked tab with the extension page', replaced === gateUrl, replaced),
];
console.log(`\nfact (informational): strip at the allow's priority → whoami ${boundWhoEqual}; redirect action → ${redirUrl}`);
process.exit(results.every(Boolean) ? 0 : 1);
