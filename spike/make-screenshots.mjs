// Capture Chrome Web Store screenshots from the REAL built extension.
//
// 1280×800 is the size the Store wants. Seeding a realistic library first matters: an
// empty popup is a worse advert than no screenshot, and a faked mock-up would be a
// listing that does not match the product.
//
// Run with: task screenshots

import { mkdirSync, writeFileSync } from 'node:fs';
import { attach, sleep, startChrome } from './lib/harness.mjs';

const OUT = new URL('../brand/store/', import.meta.url).pathname;
const WIDTH = 1280;
const HEIGHT = 800;

mkdirSync(OUT, { recursive: true });

const chrome = await startChrome(9890);

// A library that looks like real use: two personas, one spanning two apps, one session
// still empty so the honest "sign in once" state is visible in the listing.
const acme = await chrome.op('newPersona("Acme admin")');
const client = await chrome.op('newPersona("Client X")');
await chrome.swSession.eval(`chrome.storage.local.get(['personas','sessions']).then(g => {
  const ps = g.personas;
  const a = ps.find(x => x.id === ${JSON.stringify(acme)});
  if (a) a.description = 'Staging stack · admin role';
  const c = ps.find(x => x.id === ${JSON.stringify(client)});
  if (c) c.description = 'Tenant B · read-only';
  const cookie = (n, v) => ({ name:n, value:v, domain:'app.example.com', hostOnly:true, path:'/',
    expiresAt:null, secure:true, httpOnly:true, sameSite:'lax', partitionKey:null });
  const s = g.sessions;
  s.push({ id:'s_a', personaId:${JSON.stringify(acme)}, site:'https://app.example.com',
    label:'Dashboard · Acme', domains:['app.example.com'],
    cookies:[cookie('sid','x'), cookie('csrf','y')],
    storage:{'https://app.example.com':{local:{'auth.access':'jwt','auth.workspace':'wsp_1'}}},
    engine:'cookie+storage', bearerToken:null, savedAt:Date.now()-7200000, lastUsedAt:Date.now() });
  s.push({ id:'s_b', personaId:${JSON.stringify(acme)}, site:'https://admin.example.com',
    label:'Admin console', domains:['admin.example.com'], cookies:[cookie('sid','z')],
    storage:{}, engine:'cookie+storage', bearerToken:null,
    savedAt:Date.now()-900000, lastUsedAt:Date.now()-900000 });
  s.push({ id:'s_c', personaId:${JSON.stringify(acme)}, site:'https://billing.example.com',
    label:'billing.example.com', domains:['billing.example.com'], cookies:[], storage:{},
    engine:'cookie+storage', bearerToken:null, savedAt:Date.now(), lastUsedAt:Date.now() });
  s.push({ id:'s_d', personaId:${JSON.stringify(client)}, site:'https://app.example.com',
    label:'Dashboard · Client X', domains:['app.example.com'], cookies:[cookie('sid','q')],
    storage:{'https://app.example.com':{local:{'auth.access':'jwt'}}},
    engine:'cookie+storage', bearerToken:null, savedAt:Date.now()-259200000, lastUsedAt:Date.now()-259200000 });
  return chrome.storage.local.set({ personas: ps, sessions: s });
})`);
await sleep(600);

/**
 * Shoot the popup, centred on a Store-sized canvas.
 *
 * The popup page is loaded DIRECTLY and restyled in place, rather than framed inside a
 * wrapper page: Chrome refuses to put a `chrome-extension://` page in an iframe owned by
 * a `data:` URL, which produced a blank white capture. Since the popup is our own page we
 * can simply inject the surround — every pixel inside the card is the real extension.
 */
async function shootPopup(file, url, label) {
  const target = await chrome.newTab(url);
  await sleep(400);
  const page = await attach(target);
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await sleep(2400);

  await page.eval(`(() => {
    const style = document.createElement('style');
    style.textContent = \`
      html { background: #18181b; height: 100%; }
      body {
        width: 420px !important;
        margin: 96px auto 0 !important;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 24px 70px rgba(0,0,0,.55);
        zoom: 1.3;
      }
      #__shot_caption {
        position: fixed; left: 0; right: 0; bottom: 56px; text-align: center;
        font: 600 15px/1.4 -apple-system, system-ui, sans-serif;
        color: #a1a1aa; letter-spacing: .2px;
      }\`;
    document.head.appendChild(style);
    const cap = document.createElement('div');
    cap.id = '__shot_caption';
    cap.textContent = ${JSON.stringify(label)};
    document.documentElement.appendChild(cap);
    return true;
  })()`);
  await sleep(900);

  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}${file}`, Buffer.from(shot.data, 'base64'));
  console.log(file);
  page.close();
}

const base = `chrome-extension://${chrome.extensionId}`;
await shootPopup('screenshot-1-popup.png', `${base}/src/surfaces/popup/index.html`,
  'Every saved login, and what it actually holds');

// The options page is already wide; shoot it directly rather than framed.
{
  const target = await chrome.newTab(`${base}/src/surfaces/options/index.html`);
  await sleep(400);
  const page = await attach(target);
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await sleep(2600);
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}screenshot-2-library.png`, Buffer.from(shot.data, 'base64'));
  console.log('screenshot-2-library.png');

  // The coverage report — the honesty that distinguishes this from cookie swappers.
  await page.eval(`[...document.querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'Sites')?.click()`);
  await sleep(1200);
  const shot2 = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}screenshot-3-sites.png`, Buffer.from(shot2.data, 'base64'));
  console.log('screenshot-3-sites.png');
  page.close();
}

await chrome.kill();
console.log(`\n→ ${OUT}`);
