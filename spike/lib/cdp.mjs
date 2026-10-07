// Minimal Chrome DevTools Protocol client for the spikes.
//
// WHY this exists rather than puppeteer: the spikes must observe a REAL Chrome
// with a REAL unpacked extension loaded, and the one command that can load an
// unpacked extension in Chrome 154 (Extensions.loadUnpacked) lives on the
// browser target. Keeping this tiny and dependency-free means a spike can be
// run years from now without an install step rotting underneath it.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One CDP connection. Collects console output, because a spike's evidence is
 *  usually what the extension's service worker logged. */
export class Session {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.logs = [];
  }

  static async open(wsUrl) {
    const ws = new globalThis.WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const s = new Session(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        s.logs.push(msg.params.args
          .map((a) => a.value ?? a.description ?? JSON.stringify(a.preview ?? ''))
          .join(' '));
      }
      if (msg.id && s.pending.has(msg.id)) {
        const { res, rej } = s.pending.get(msg.id);
        s.pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    };
    return s;
  }

  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }

  /**
   * Evaluate in the target and return the value, or `{__err}` on a throw —
   * spikes need to SEE failures, not have them vanish into a rejected promise.
   *
   * Retries on "Cannot find default execution context", which CDP raises when the
   * page is mid-navigation and its context has been torn down. That is a property
   * of watching a page that reloads, not a failure of the thing under test, and
   * letting it throw cost one spurious FAIL in a 3-run stability check.
   */
  async eval(expression, { retries = 12, userGesture = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.send('Runtime.evaluate', {
          expression, awaitPromise: true, returnByValue: true, userGesture,
        });
        if (r.exceptionDetails) {
          return { __err: `${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`.trim() };
        }
        return r.result?.value;
      } catch (e) {
        const transient = /execution context|Target closed|Inspected target navigated/i.test(String(e.message));
        if (!transient || attempt >= retries) throw e;
        await sleep(300);
      }
    }
  }

  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

/**
 * Launch a throwaway Chrome with remote debugging, optionally loading an
 * unpacked extension.
 *
 * TRAP: Chrome 154 SILENTLY IGNORES --load-extension — it starts fine, the flag
 * does nothing, and the only extension service workers present are Chrome's own
 * built-ins. A harness that attaches to "the service worker" then measures a
 * Google extension. The only working path is the CDP Extensions.loadUnpacked
 * command on the browser target, which is what this does.
 */
export async function launchChrome({ port, extensionPath = null, ignoreCertErrors = false, extraArgs = [], headless = process.env.SPIKE_HEADLESS !== '0' }) {
  const profile = mkdtempSync(join(tmpdir(), 'spike-chrome-'));
  const args = [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-features=ChromeWhatsNewUI',
  ];
  // Headless by DEFAULT: these spikes launch Chrome repeatedly, and a visible
  // window steals focus from whoever is working on this machine. --headless=new
  // is full Chrome (extensions included), not the old stripped headless mode.
  // Set SPIKE_HEADLESS=0 to watch a run happen on screen.
  if (headless) args.push('--headless=new', '--window-size=1280,900');
  if (extensionPath) args.push('--enable-unsafe-extension-debugging');
  // Local dev hosts routinely serve a self-signed cert; a spike must not die on it.
  if (ignoreCertErrors) args.push('--ignore-certificate-errors');
  args.push(...extraArgs, 'about:blank');

  // REFUSE to start if the port already answers.
  //
  // Chrome does not fail when its debugging port is taken — it quietly picks another —
  // so the driver's fetch then connects to whatever is ALREADY there: a leftover
  // browser from a previous run, with a stale extension build and stale storage. The
  // symptom is a bizarre error from code you just fixed (seen for real: "e.find is not
  // a function" from a v1 build still running on the port). Fail loudly instead.
  const stale = await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true).catch(() => false);
  if (stale) {
    throw new Error(
      `a browser is already listening on debug port ${port} — it is almost certainly a `
      + 'leftover from an earlier run, and attaching to it would test a stale build. '
      + "Kill it first: pkill -f 'spike-chrome-'",
    );
  }

  const proc = spawn(CHROME_BIN, args, { stdio: 'ignore' });

  let version;
  for (let i = 0; i < 80; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; }
    catch { await sleep(250); }
  }
  if (!version) throw new Error(`Chrome did not expose a debug port on ${port}`);

  const api = {
    port,
    profile,
    extensionId: null,
    swSession: null,

    targets: async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json(),

    // The target URL rides in the QUERY of /json/new, so its own `#fragment` must be
    // escaped — unescaped, fetch treats it as this request's fragment and silently drops
    // it, and a page opened at `…#settings` arrives without the hash.
    newTab: async (url) =>
      (await fetch(`http://127.0.0.1:${port}/json/new?${url.replace(/#/g, '%23')}`, { method: 'PUT' })).json(),

    async kill() {
      this.swSession?.close();
      proc.kill('SIGKILL');
      await sleep(600);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };

  if (extensionPath) {
    const browser = await Session.open(version.webSocketDebuggerUrl);
    const { id } = await browser.send('Extensions.loadUnpacked', { path: extensionPath });
    browser.close();
    api.extensionId = id;
    await sleep(1500);
    const sw = (await api.targets()).find((t) => t.url === `chrome-extension://${id}/background.js`);
    if (sw) {
      api.swSession = await Session.open(sw.webSocketDebuggerUrl);
      await api.swSession.send('Runtime.enable'); // console output == evidence
    }
  }

  return api;
}

/** Open a page target and enable the domains every spike needs. */
export async function openPage(chrome, url) {
  const target = await chrome.newTab(url);
  await sleep(300);
  const s = await Session.open(target.webSocketDebuggerUrl);
  await s.send('Runtime.enable');
  await s.send('Page.enable');
  return s;
}
