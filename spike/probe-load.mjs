// Which loading path actually gets an unpacked MV3 extension into Chrome 154?
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EXT = new URL('./ext', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ws(url) {
  const w = new globalThis.WebSocket(url);
  await new Promise((res, rej) => { w.onopen = res; w.onerror = rej; });
  let n = 0; const p = new Map();
  w.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  };
  return { send: (method, params = {}) => { const id = ++n; w.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => p.set(id, { res, rej })); }, close: () => w.close() };
}

async function attempt(label, extraArgs, useCdpLoad) {
  const port = 9400 + Math.floor(Math.random() * 100);
  const profile = mkdtempSync(join(tmpdir(), 'probe-'));
  const args = [...extraArgs, `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--headless=new', '--window-size=1280,900',
    '--no-first-run', '--no-default-browser-check', 'about:blank'];
  const ch = spawn(CHROME, args, { stdio: 'ignore' });
  let version;
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(250); }
  }
  let cdpResult = null;
  if (useCdpLoad && version) {
    try {
      const b = await ws(version.webSocketDebuggerUrl);
      cdpResult = await b.send('Extensions.loadUnpacked', { path: EXT });
      b.close();
    } catch (e) { cdpResult = { error: String(e.message).slice(0, 200) }; }
  }
  await sleep(2500);
  let targets = [];
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch {}
  const mine = targets.filter((t) => t.url.includes('background.js'));
  console.log(`\n### ${label}`);
  if (cdpResult) console.log('  Extensions.loadUnpacked ->', JSON.stringify(cdpResult));
  console.log('  spike extension target found:', mine.length > 0, mine.map((t) => t.url).join(' '));
  ch.kill('SIGKILL');
  await sleep(500);
  return mine.length > 0;
}

const a = await attempt('A: --load-extension alone', [`--load-extension=${EXT}`], false);
const b = await attempt('B: --load-extension + --enable-unsafe-extension-debugging',
  [`--load-extension=${EXT}`, '--enable-unsafe-extension-debugging'], false);
const c = await attempt('C: CDP Extensions.loadUnpacked (needs --remote-debugging-pipe style access)',
  ['--enable-unsafe-extension-debugging'], true);
console.log(`\nWORKS -> A:${a}  B:${b}  C:${c}`);
