// SPIKE S0 — where does a real app keep its login?
//
// Guessing which state layer carries auth decides how much machinery this project
// needs, so it gets measured instead. The probe logs into a real app, snapshots
// every layer, logs out, snapshots again, and reports which entries CHANGED --
// a value that appears on login and vanishes on logout is the credential.
//
// Credentials come from the environment so they never land in a committed file:
//   APP_URL=https://sync.localhost \
//   APP_USER=a@b.test APP_PASS=secret \
//   node spike/probe-app.mjs
//
// Pass --inspect to dump the login form's shape without attempting a login.

import { launchChrome, openPage, sleep } from './lib/cdp.mjs';

const APP_URL = process.env.APP_URL;
const APP_USER = process.env.APP_USER;
const APP_PASS = process.env.APP_PASS;
const INSPECT_ONLY = process.argv.includes('--inspect');
const PORT = 9500;

if (!APP_URL) {
  console.error('APP_URL is required');
  process.exit(2);
}

/** Snapshot every storage layer a login could hide in, from the page's own view. */
const SNAPSHOT = `(async () => {
  const out = { cookiesVisibleToJs: document.cookie, localStorage: {}, sessionStorage: {}, idb: [] };
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.localStorage[k] = String(localStorage.getItem(k)).slice(0, 220); } } catch (e) { out.localStorage = { __err: String(e) }; }
  try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); out.sessionStorage[k] = String(sessionStorage.getItem(k)).slice(0, 220); } } catch (e) { out.sessionStorage = { __err: String(e) }; }
  try { if (indexedDB.databases) out.idb = (await indexedDB.databases()).map(d => d.name); } catch (e) { out.idb = ['__err:' + String(e)]; }
  return out;
})()`;

/** Describe every form control on the page, so a login can be driven without guessing. */
const FORM_SHAPE = `(() => {
  const sel = (el) => el.tagName.toLowerCase()
    + (el.type ? '[type=' + el.type + ']' : '')
    + (el.name ? '[name=' + el.name + ']' : '')
    + (el.id ? '#' + el.id : '');
  return {
    url: location.href,
    title: document.title,
    inputs: [...document.querySelectorAll('input,select,textarea')].map((el) => ({
      sel: sel(el), placeholder: el.placeholder || null, label: el.getAttribute('aria-label') || null,
      autocomplete: el.getAttribute('autocomplete') || null, visible: el.offsetParent !== null,
    })),
    buttons: [...document.querySelectorAll('button,input[type=submit],a[href]')]
      .filter((el) => el.offsetParent !== null)
      .slice(0, 25)
      .map((el) => ({ tag: el.tagName.toLowerCase(), text: (el.textContent || el.value || '').trim().slice(0, 50), href: el.getAttribute?.('href') || null })),
    forms: [...document.querySelectorAll('form')].map((f) => ({ action: f.getAttribute('action'), method: f.method })),
  };
})()`;

const chrome = await launchChrome({ port: PORT, ignoreCertErrors: true });
const page = await openPage(chrome, 'about:blank');

// Collect every Set-Cookie the browser receives, including HttpOnly ones the
// page itself can never see. This is the layer document.cookie hides.
await page.send('Network.enable');
const setCookies = [];
page.ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Network.responseReceivedExtraInfo') {
    const h = m.params.headers || {};
    for (const [k, v] of Object.entries(h)) {
      if (k.toLowerCase() === 'set-cookie') {
        for (const line of String(v).split('\n')) setCookies.push(line);
      }
    }
  }
});

await page.send('Page.navigate', { url: APP_URL });
await sleep(3500);

const shape = await page.eval(FORM_SHAPE);
console.log('=== page after load ===');
console.log(JSON.stringify(shape, null, 2));

if (INSPECT_ONLY) {
  console.log('\n=== storage while logged out ===');
  console.log(JSON.stringify(await page.eval(SNAPSHOT), null, 2));
  console.log('\n=== Set-Cookie seen (incl. HttpOnly) ===');
  console.log(setCookies.length ? setCookies.join('\n') : '(none)');
  await chrome.kill();
  process.exit(0);
}

const before = await page.eval(SNAPSHOT);

// Drive the login with whatever the page actually offers: find the email-ish and
// password inputs by type/autocomplete/name, set them through the native value
// setter so React's onChange fires, then submit.
const LOGIN = `(async () => {
  const q = (...ss) => ss.map(s => document.querySelector(s)).find(Boolean);
  const email = q('input[type=email]', 'input[autocomplete=username]', 'input[name*=email i]', 'input[name*=user i]', 'input[id*=email i]');
  const pass = q('input[type=password]', 'input[autocomplete*=password]', 'input[name*=pass i]');
  if (!email || !pass) return { ok: false, why: 'no email/password input found' };
  const set = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set(email, ${JSON.stringify(APP_USER)});
  set(pass, ${JSON.stringify(APP_PASS)});
  await new Promise(r => setTimeout(r, 250));
  const form = pass.closest('form');
  const btn = form?.querySelector('button[type=submit], button:not([type])')
    || [...document.querySelectorAll('button')].find(b => /sign in|log in|login|continue|submit/i.test(b.textContent || ''));
  if (btn) { btn.click(); return { ok: true, via: 'button:' + btn.textContent.trim() }; }
  if (form) { form.requestSubmit ? form.requestSubmit() : form.submit(); return { ok: true, via: 'form.submit' }; }
  return { ok: false, why: 'found inputs but no submit path' };
})()`;

console.log('\n=== attempting login ===');
console.log(JSON.stringify(await page.eval(LOGIN)));
await sleep(5000);

const after = await page.eval(SNAPSHOT);
const afterUrl = await page.eval('location.href');

console.log('\n=== storage AFTER login ===');
console.log(JSON.stringify({ url: afterUrl, ...after }, null, 2));

// Diff: a key that appeared or changed on login is a credential candidate.
function diff(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const changed = {};
  for (const k of keys) if ((a || {})[k] !== (b || {})[k]) changed[k] = { before: (a || {})[k] ?? null, after: (b || {})[k] ?? null };
  return changed;
}

console.log('\n################ WHERE THE LOGIN LIVES ################\n');
console.log('localStorage keys that changed on login:');
console.log(JSON.stringify(diff(before.localStorage, after.localStorage), null, 2));
console.log('\nsessionStorage keys that changed on login:');
console.log(JSON.stringify(diff(before.sessionStorage, after.sessionStorage), null, 2));
console.log('\ndocument.cookie before:', before.cookiesVisibleToJs || '(empty)');
console.log('document.cookie after :', after.cookiesVisibleToJs || '(empty)');
console.log('\nIndexedDB databases before:', JSON.stringify(before.idb), 'after:', JSON.stringify(after.idb));
console.log('\nALL Set-Cookie headers observed (HttpOnly included):');
console.log(setCookies.length ? setCookies.map((c) => '  ' + c).join('\n') : '  (none)');

await chrome.kill();
