// Shared end-to-end harness for the v2 extension.
//
// Every driver talks to the REAL built extension in a real Chrome, through the
// worker's own operations — chrome.runtime.sendMessage does not deliver to its own
// sender, so the worker exposes them on globalThis for exactly this.

import { launchChrome, Session, sleep } from './cdp.mjs';

export const EXT = new URL('../../apps/extension/dist', import.meta.url).pathname;

export const APPS = {
  fixture: {
    url: 'http://localhost:8787/',
    users: [{ label: 'alice' }, { label: 'bob' }],
    formReady: `!!document.querySelector('form[action="/login"]')`,
    loggedIn: `fetch('/whoami',{cache:'no-store'}).then(r=>r.json()).then(j=>!!j.user)`,
    whoami: `fetch('/whoami',{cache:'no-store'}).then(r=>r.json()).then(j=>j.user)`,
    login: (u) => `(() => {
      const f = [...document.querySelectorAll('form[action="/login"]')]
        .find(f => f.querySelector('input[name=user]').value === ${JSON.stringify(u.label)});
      if (!f) return 'no-form'; f.submit(); return 'submitted';
    })()`,
  },
  sync: {
    url: 'https://sync.localhost/',
    users: [
      { label: process.env.SYNC_USER1, pass: process.env.SYNC_PASS1 },
      { label: process.env.SYNC_USER2, pass: process.env.SYNC_PASS2 },
    ],
    formReady: `!!document.querySelector('input[type=password]')`,
    loggedIn: `!!localStorage.getItem('authmgr.access')`,
    whoami: `(() => { try { const t = localStorage.getItem('authmgr.access');
      return t ? (JSON.parse(atob(t.split('.')[1])).sub ?? 'token') : null; } catch { return 'unreadable'; } })()`,
    login: (u) => `(async () => {
      const q = (...ss) => ss.map(s => document.querySelector(s)).find(Boolean);
      const email = q('input[type=email]','input[autocomplete=username]');
      const pass = q('input[type=password]');
      if (!email || !pass) return 'no-form';
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
        d.set.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); };
      set(email, ${JSON.stringify(u.label)});
      set(pass, ${JSON.stringify(u.pass)});
      await new Promise(r => setTimeout(r, 300));
      const btn = [...document.querySelectorAll('button')].find(b => /sign in|log in|login|continue/i.test(b.textContent||''));
      if (!btn) return 'no-button'; btn.click(); return 'submitted';
    })()`,
  },
};

export function pickApp(name = process.env.APP ?? 'fixture') {
  const app = APPS[name];
  if (!app) { console.error(`unknown APP=${name}`); process.exit(2); }
  if (app.users.some((u) => !u.label)) {
    console.error(`APP=${name} needs credentials in the environment`);
    process.exit(2);
  }
  return { ...app, name, host: new URL(app.url).host, origin: new URL(app.url).origin };
}

/** `extensionPath` defaults to the built extension; a suite passes a copy only when it
 *  needs a different grant set in the same run (see e2e-signin.mjs). */
export async function startChrome(port, extensionPath = EXT) {
  const chrome = await launchChrome({ port, extensionPath, ignoreCertErrors: true });
  if (!chrome.swSession) {
    console.error('extension service worker not found — did you build?');
    await chrome.kill();
    process.exit(1);
  }
  await sleep(1500);

  // Kill the browser even when the driver throws.
  //
  // Without this a failed assertion leaves Chrome running on its debug port, and the
  // NEXT run attaches to that stale instance instead of a fresh one — which produced a
  // baffling error from code that had already been fixed. The port guard in cdp.mjs
  // catches it, but not leaving the zombie behind is the real fix.
  const cleanup = () => { try { chrome.kill(); } catch { /* already gone */ } };
  process.once('uncaughtException', (err) => { cleanup(); console.error(err); process.exit(1); });
  process.once('unhandledRejection', (err) => { cleanup(); console.error(err); process.exit(1); });
  process.once('SIGINT', () => { cleanup(); process.exit(130); });
  process.once('SIGTERM', () => { cleanup(); process.exit(143); });

  chrome.op = async (expr) => {
    const r = await chrome.swSession.eval(`globalThis.__tabsona.${expr}`);
    if (r && r.__err) throw new Error(`${expr} -> ${r.__err}`);
    return r;
  };
  chrome.json = async (expr) => JSON.parse(await chrome.swSession.eval(`${expr}.then(v => JSON.stringify(v))`));
  return chrome;
}

/**
 * `chrome.permissions.request` opens Chrome's own confirmation dialog and requires a
 * HUMAN click, so a headless run cannot pass through it — an early attempt hung
 * indefinitely. The tasks pre-grant the origin in the BUILT manifest instead; this only
 * checks the grant is there and explains clearly when it is not.
 */
export async function requireGrant(chrome, origin) {
  const pattern = `${origin}/*`;
  const granted = await chrome.swSession.eval(
    `chrome.permissions.contains({origins:[${JSON.stringify(pattern)}]})`) === true;
  if (!granted) {
    console.error(`\n${pattern} is not granted.\n`
      + 'In normal use the popup\'s "allow this site" button grants it, which opens\n'
      + 'Chrome\'s confirmation dialog — a human click by design. Run this through its\n'
      + 'task, which pre-grants the origin in the built manifest.\n');
    await chrome.kill();
    process.exit(1);
  }
  return true;
}

/** Claim the ONE page target that appeared since `beforeIds`. Never guesses: a harness
 *  that falls back to "the first tab on this host" hands back a tab another session
 *  already owns, and then blames the extension for the collision. */
export async function claimNewTab(chrome, beforeIds, host) {
  for (let i = 0; i < 90; i++) {
    const fresh = (await chrome.targets())
      .filter((t) => t.type === 'page' && t.url.includes(host) && !beforeIds.has(t.id));
    if (fresh.length === 1) return fresh[0];
    if (fresh.length > 1) throw new Error(`ambiguous: ${fresh.length} new tabs on ${host}`);
    await sleep(250);
  }
  throw new Error(`no new tab appeared on ${host}`);
}

export async function pageIds(chrome) {
  return new Set((await chrome.targets()).filter((t) => t.type === 'page').map((t) => t.id));
}

export async function attach(target) {
  const s = await Session.open(target.webSocketDebuggerUrl);
  await s.send('Runtime.enable');
  await s.send('Page.enable');
  return s;
}

/** Wait on a real condition. A fixed sleep has produced a false result three times in
 *  this project; sync.localhost takes ~9s just to render its login form. */
export async function waitFor(session, expr, label, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await session.eval(expr) === true) return true;
    await sleep(400);
  }
  console.log(`   !! timed out: ${label}`);
  return false;
}

export function report(title, checks) {
  console.log(`\n================ ${title} ================\n`);
  let pass = true;
  for (const [label, ok, detail] of checks) {
    console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
    if (!ok) pass = false;
  }
  console.log(`\nVERDICT: ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

export { sleep, Session };
