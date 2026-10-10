// Capture every Chrome Web Store and README image from the REAL built extension.
//
// Why it is worth a script: a listing whose screenshots were mocked up is a listing that
// stops matching the product at the first UI change, and the Store's own policy is that
// screenshots must show the actual item. So every pixel inside the frame here comes from
// the running extension — the surrounding plate and caption are the only staging.
//
// Outputs, all regenerated from scratch:
//   brand/store/screenshot-N-*.png   1280x800, the size the dashboard wants (git-ignored)
//   brand/store/small-*.png          640x400, the alternative size the dashboard accepts
//   docs/shots/*.png                 the same frames for the README and project site (tracked)
//
// Run with: task screenshots

import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { attach, claimNewTab, pageIds, pickApp, sleep, startChrome, waitFor } from './lib/harness.mjs';

const STORE_DIR = new URL('../brand/store/', import.meta.url).pathname;
const SHOTS_DIR = new URL('../docs/shots/', import.meta.url).pathname;

/** The dashboard's preferred screenshot size. 640x400 is the only accepted alternative,
 *  so both are emitted and whichever the listing wants is already on disk. */
const STORE_SIZE = { width: 1280, height: 800 };
const SMALL_SIZE = { width: 640, height: 400 };

/** The fixture the end-to-end suites use. Real origin, real cookies, real page storage —
 *  the Coverage screenshot has to show a site the engine actually observed. */
const FIXTURE = 'http://localhost:8787';

/** Dark plate behind each frame. Matches the icon's plate so the set reads as one brand. */
const PLATE = '#18181b';

/**
 * Clear only THIS script's own output.
 *
 * `brand/store/` also holds the promo art that `task brand` generates, so wiping the
 * whole directory deletes assets this script cannot rebuild — it did exactly that once.
 * Screenshots are matched by their own naming instead.
 */
const SHOT_FILE = /^(small-)?\d-[a-z-]+\.png$/;
mkdirSync(STORE_DIR, { recursive: true });
for (const file of readdirSync(STORE_DIR)) {
  if (SHOT_FILE.test(file)) rmSync(join(STORE_DIR, file));
}
rmSync(SHOTS_DIR, { recursive: true, force: true });
mkdirSync(SHOTS_DIR, { recursive: true });

const chrome = await startChrome(9890);
const base = `chrome-extension://${chrome.extensionId}`;

// --- a library that looks like real use -------------------------------------
//
// An empty popup is a worse advert than no screenshot. One persona spans three apps with
// one session still EMPTY, because "sign in once" is the product's sharpest edge and
// hiding it in the listing would be a promise the first run breaks.

const acme = await chrome.op('newPersona("Acme admin")');
const client = await chrome.op('newPersona("Client X")');
await chrome.swSession.eval(`chrome.storage.local.get(['personas','sessions']).then(g => {
  const ps = g.personas;
  const a = ps.find(x => x.id === ${JSON.stringify(acme)});
  if (a) a.description = 'Staging stack · admin role';
  const c = ps.find(x => x.id === ${JSON.stringify(client)});
  if (c) c.description = 'Tenant B · read-only';
  const cookie = (n, v, d) => ({ name:n, value:v, domain:d, hostOnly:true, path:'/',
    expiresAt:null, secure:true, httpOnly:true, sameSite:'lax', partitionKey:null });
  const s = g.sessions;
  s.push({ id:'s_a', personaId:${JSON.stringify(acme)}, site:'https://app.example.com',
    label:'Dashboard · Acme', domains:['app.example.com'],
    cookies:[cookie('sid','x','app.example.com'), cookie('csrf','y','app.example.com')],
    storage:{'https://app.example.com':{local:{'auth.access':'jwt','auth.workspace':'wsp_1'}}},
    engine:'cookie+storage', bearerToken:null, savedAt:Date.now()-7200000, lastUsedAt:Date.now() });
  s.push({ id:'s_b', personaId:${JSON.stringify(acme)}, site:'https://admin.example.com',
    label:'Admin console', domains:['admin.example.com'], cookies:[cookie('sid','z','admin.example.com')],
    storage:{}, engine:'cookie+storage', bearerToken:null,
    savedAt:Date.now()-900000, lastUsedAt:Date.now()-900000 });
  s.push({ id:'s_c', personaId:${JSON.stringify(acme)}, site:'https://billing.example.com',
    label:'billing.example.com', domains:['billing.example.com'], cookies:[], storage:{},
    engine:'cookie+storage', bearerToken:null, savedAt:Date.now(), lastUsedAt:Date.now() });
  s.push({ id:'s_d', personaId:${JSON.stringify(client)}, site:'https://app.example.com',
    label:'Dashboard · Client X', domains:['app.example.com'],
    cookies:[cookie('sid','q','app.example.com')],
    storage:{'https://app.example.com':{local:{'auth.access':'jwt'}}},
    engine:'cookie+storage', bearerToken:null, savedAt:Date.now()-259200000, lastUsedAt:Date.now()-259200000 });
  return chrome.storage.local.set({ personas: ps, sessions: s });
})`);
await sleep(600);

// --- real browsing, so the Coverage tab has something true to say ------------
//
// Coverage is computed from what the engine OBSERVED on an origin, not from intentions.
// There is no way to seed it honestly: a tab has to really run on a real site first.

await chrome.op(`addSite(${JSON.stringify(acme)}, ${JSON.stringify(FIXTURE)})`);
const live = await chrome.json(`chrome.storage.local.get('sessions')`);
const liveSession = live.sessions.find((s) => s.site === FIXTURE);
const beforeOpen = await pageIds(chrome);
await chrome.op(`openSession(${JSON.stringify(liveSession.id)}, 'new-tab')`);
{
  // Sign in for real. Without a login the engine has seen no Set-Cookie on the origin, and
  // the Coverage screenshot would honestly — but uselessly — report cookies as "unknown".
  const tab = await claimNewTab(chrome, beforeOpen, new URL(FIXTURE).host);
  const page = await attach(tab);
  const app = pickApp('fixture');
  await waitFor(page, app.formReady, 'fixture login form');
  await page.eval(app.login(app.users[0]));
  await sleep(1500);
  await waitFor(page, app.loggedIn, 'fixture signed in');
  await sleep(2500);
  page.close();
}

/**
 * Open `url` in a tab that is NOT the active one, and return its CDP target.
 *
 * Why: the popup asks Chrome for the active tab to decide what its footer offers. Opened
 * the normal way, the popup's own page IS the active tab, so the footer correctly says
 * "open a website" and the save menu never appears. Rendering it behind a real website
 * makes the popup see what it sees in real use: the site the user is looking at.
 */
async function openInBackground(url) {
  const before = new Set((await chrome.targets()).map((t) => t.id));
  await chrome.swSession.eval(`chrome.tabs.create({ url: ${JSON.stringify(url)}, active: false }).then(() => true)`);
  for (let i = 0; i < 40; i++) {
    const fresh = (await chrome.targets()).find((t) => t.type === 'page' && t.url === url && !before.has(t.id));
    if (fresh) return fresh;
    await sleep(250);
  }
  throw new Error(`background tab for ${url} never appeared`);
}

/**
 * Screenshot a page, at both sizes the dashboard accepts and once for the README.
 *
 * The extension page is loaded DIRECTLY and restyled in place rather than framed in a
 * wrapper: Chrome refuses to put a `chrome-extension://` page in an iframe owned by a
 * `data:` URL, which produced a blank white capture the first time. Since the page is
 * ours, the surround can simply be injected.
 */
async function shoot(name, url, { frame = null, caption = null, before = null, background = false } = {}) {
  const target = background ? await openInBackground(url) : await chrome.newTab(url);
  await sleep(400);
  const page = await attach(target);
  await page.send('Emulation.setDeviceMetricsOverride',
    { ...STORE_SIZE, deviceScaleFactor: 1, mobile: false });
  await sleep(2400);

  if (frame) {
    await page.eval(`(() => {
      const style = document.createElement('style');
      style.textContent = \`
        html { background: ${PLATE}; height: 100%; }
        body {
          width: ${frame.width}px !important;
          margin: ${frame.top}px auto 0 !important;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 24px 70px rgba(0,0,0,.55);
          zoom: ${frame.zoom};
        }
        #__shot_caption {
          position: fixed; left: 0; right: 0; ${frame.captionTop ? 'top: 26px' : 'bottom: 48px'}; text-align: center;
          font: 600 15px/1.4 -apple-system, system-ui, sans-serif;
          color: #a1a1aa; letter-spacing: .2px;
        }\`;
      document.head.appendChild(style);
      if (${JSON.stringify(caption)}) {
        const cap = document.createElement('div');
        cap.id = '__shot_caption';
        cap.textContent = ${JSON.stringify(caption)};
        document.documentElement.appendChild(cap);
      }
      return true;
    })()`);
    await sleep(900);
  }

  if (before) await before(page);

  const full = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${STORE_DIR}${name}.png`, Buffer.from(full.data, 'base64'));
  writeFileSync(`${SHOTS_DIR}${name}.png`, Buffer.from(full.data, 'base64'));

  // The 640x400 alternative is the SAME frame at half scale. Re-laying the page out in a
  // smaller viewport instead crops it and lands the caption on top of the content — the
  // first version did exactly that. `clip.scale` re-renders the identical layout smaller,
  // so text is drawn at the target size rather than resampled from a bitmap.
  const small = await page.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, ...STORE_SIZE, scale: SMALL_SIZE.width / STORE_SIZE.width },
  });
  writeFileSync(`${STORE_DIR}small-${name}.png`, Buffer.from(small.data, 'base64'));

  console.log(`${name}.png`);
  page.close();
  return page;
}

const POPUP_FRAME = { width: 420, top: 86, zoom: 1.35 };

await shoot('1-popup', `${base}/src/surfaces/popup/index.html`,
  { frame: POPUP_FRAME, caption: 'Every saved login, and exactly what it holds' });

// The sign-in gate: where a persona tab lands when it was about to visit a website Tabsona
// is not allowed on. The stop itself is the worker's record in session storage (a tab id is
// meaningless after a restart), so it is seeded for a real tab; the PAGE shown is the real
// gate surface reading it through the real worker. 'sign-in' reason needs a recorded hop.
{
  const GATE_HOST = 'https://login.example-idp.com';
  const hostTab = await chrome.swSession.eval(`chrome.tabs.query({}).then(ts => ts.find(t => t.url.startsWith(${JSON.stringify(FIXTURE)}))?.id)`);
  await chrome.swSession.eval(`(async () => {
    await chrome.storage.local.set({ signInChains: { [${JSON.stringify(FIXTURE)}]: [${JSON.stringify(GATE_HOST)}] } });
    await chrome.storage.session.set({ gatePending: { [String(${hostTab})]: {
      url: ${JSON.stringify(`${GATE_HOST}/authorize?client_id=tabsona-demo`)}, host: ${JSON.stringify(GATE_HOST)},
      sessionId: ${JSON.stringify(liveSession.id)}, at: Date.now() } } });
    return true;
  })()`);
  await shoot('2-gate', `${base}/src/surfaces/gate/index.html?tab=${hostTab}`, {
    frame: { width: 760, top: 70, zoom: 1.1, captionTop: true },
    caption: 'A persona tab asks before it visits a website you have not allowed',
  });
  await chrome.swSession.eval(`Promise.all([chrome.storage.session.remove('gatePending'), chrome.storage.local.remove('signInChains')]).then(() => true)`);
}

// The menu that makes the Move/Copy choice the user's, not ours — the interaction the
// whole "did it log me out of my normal tab?" confusion turns on.
// A PLAIN tab on a site — not bound to any persona — is what the save menu is for.
await chrome.swSession.eval(`chrome.tabs.create({ url: ${JSON.stringify(`${FIXTURE}/`)}, active: true }).then(() => true)`);
await sleep(2000);

await shoot('6-save-menu', `${base}/src/surfaces/popup/index.html`, {
  background: true,
  frame: { ...POPUP_FRAME, top: 16, zoom: 1.05 },
  caption: 'Move the login, or copy it — you choose',
  before: async (page) => {
    await waitFor(page, `!!document.querySelector('button')`, 'popup rendered');
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => /Add to persona/i.test(x.textContent||''));
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(1200);
  },
});

const OPTIONS = `${base}/src/surfaces/options/index.html`;

/** Click an options tab by its label and let it settle. */
const openTab = (label) => async (page) => {
  await waitFor(page, `!!document.querySelector('button')`, 'options rendered');
  await page.eval(`[...document.querySelectorAll('button')]
    .find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
  await sleep(1600);
};

/** The options page is wide, so it gets a wide card and a caption ABOVE it — the content
 *  is tall enough to collide with the bottom caption slot the popup uses. */
const OPTIONS_FRAME = { width: 1000, top: 74, zoom: 1.1, captionTop: true };

await shoot('3-library', OPTIONS, {
  frame: OPTIONS_FRAME, caption: 'One persona, many apps — open the whole set in one click',
});
await shoot('5-coverage', OPTIONS, {
  frame: OPTIONS_FRAME, caption: 'What is actually isolated on each site, measured — not assumed',
  before: async (page) => {
    await waitFor(page, `!!document.querySelector('button')`, 'options rendered');
    await page.eval(`[...document.querySelectorAll('button')]
      .find(b => /choose sites myself/i.test(b.textContent))?.click()`);
    await sleep(600);
    await openTab('Coverage')(page);
  },
});
// Settings and Sites come last: dismissing the first-run welcome (which the Settings frame
// would otherwise be pushed down by) is a real choice the user makes once, and it persists.
await shoot('4-settings', OPTIONS, {
  frame: OPTIONS_FRAME, caption: 'Settings: websites, normal-login sites, badge, page titles and tabs',
  before: async (page) => {
    await waitFor(page, `!!document.querySelector('button')`, 'options rendered');
    await page.eval(`[...document.querySelectorAll('button')]
      .find(b => /choose sites myself/i.test(b.textContent))?.click()`);
    await sleep(600);
    await openTab('Settings')(page);
  },
});
await shoot('7-sites', OPTIONS, {
  frame: OPTIONS_FRAME, caption: 'You grant each site yourself, through Chrome\'s own prompt',
  before: openTab('Sites'),
});

await chrome.kill();
console.log(`\n→ ${STORE_DIR}\n→ ${SHOTS_DIR}`);
