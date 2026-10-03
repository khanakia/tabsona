// Chrome Web Store client: authorise, create the item, upload a new build, publish, status.
//
// Why it is hand-rolled on `fetch` rather than `chrome-webstore-upload-cli`: that CLI
// cannot CREATE an item, only update one that already exists, so a first listing needed a
// second tool anyway; and an `npx` download at publish time is a supply-chain dependency
// in the one step that ships code to users. Five REST calls do not justify either.
//
// Credentials live in the repo's `.env` (git-ignored) and are never printed:
//   CWS_CLIENT_ID, CWS_CLIENT_SECRET   an OAuth "Desktop app" client with the Chrome Web
//                                      Store API enabled. One client can serve every
//                                      extension on the same developer account.
//   CWS_REFRESH_TOKEN                  written by `auth`.
//   CWS_EXTENSION_ID                   written by `create`.
//
// Run through the Taskfile: task cws:auth · cws:create · cws:upload · cws:publish · cws:status

import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import {
  missingKeys, parseEnv, settleUpload as settle, tokenRefreshError, upsertEnvLine,
} from './lib-cws.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const ENV_PATH = resolve(ROOT, '.env');

/** The only scope the Store API needs. Narrower than any Google-wide scope on purpose. */
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

/**
 * Loopback port for the OAuth redirect.
 *
 * Fixed, not random, so a "Web application" OAuth client can list it as an authorised
 * redirect. Matches filemark's script, so one client registration covers both repos.
 */
const OAUTH_PORT = 42813;

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/chromewebstore/v1.1/items';
const UPLOAD_API = 'https://www.googleapis.com/upload/chromewebstore/v1.1/items';

/** How often, and how many times, to re-read an upload the Store is still processing.
 *  40 × 3 s = two minutes, far longer than a sub-megabyte package ever takes. */
const UPLOAD_POLL_MS = 3000;
const UPLOAD_POLL_TRIES = 40;

// --- .env -------------------------------------------------------------------

/** Read `.env` (absent file = no keys). Parsing rules live in lib-cws.mjs. */
function readEnv() {
  return existsSync(ENV_PATH) ? parseEnv(readFileSync(ENV_PATH, 'utf8')) : {};
}

/** Set one key in `.env`, preserving every other line (see upsertEnvLine). */
function writeEnv(key, value) {
  const raw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  writeFileSync(ENV_PATH, upsertEnvLine(raw, key, value));
}

/** Read required keys or exit naming exactly which are missing. */
function need(env, ...keys) {
  const missing = missingKeys(env, keys);
  if (missing.length > 0) {
    console.error(`cws: missing ${missing.join(', ')} in .env — see the header of apps/extension/scripts/cws.mjs`);
    process.exit(1);
  }
  return keys.map((k) => env[k]);
}

// --- auth -------------------------------------------------------------------

/**
 * Exchange the refresh token for a short-lived access token.
 *
 * `invalid_grant` here almost always means the refresh token expired. A consent screen in
 * "Testing" mode issues tokens that die after seven days — publish it to "In production"
 * (no verification is needed for this scope on your own account) to get durable ones.
 */
async function accessToken(env) {
  const [clientId, clientSecret, refreshToken] = need(env, 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(tokenRefreshError(data, res.status));
  return data.access_token;
}

/** Run the loopback OAuth flow once and store the refresh token. Needs a human click. */
function auth(env) {
  const [clientId, clientSecret] = need(env, 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET');
  const redirect = `http://localhost:${OAUTH_PORT}`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // without it Google omits the refresh token on a repeat grant
  })}`;

  const server = http.createServer(async (req, res) => {
    const params = new URL(req.url ?? '/', redirect).searchParams;
    const code = params.get('code');
    const error = params.get('error');
    if (!code && !error) { res.writeHead(404).end(); return; }
    const done = (status, html, exitCode) => {
      res.writeHead(status, { 'content-type': 'text/html' }).end(html);
      server.close();
      process.exitCode = exitCode;
    };
    if (error) { console.error(`cws: Google returned "${error}"`); done(200, `<h3>Authorisation failed: ${error}</h3>`, 1); return; }

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirect, grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.refresh_token) {
      console.error(`cws: token exchange failed: ${data.error ?? tokenRes.status}`);
      done(500, '<h3>Token exchange failed — see the terminal.</h3>', 1);
      return;
    }
    writeEnv('CWS_REFRESH_TOKEN', data.refresh_token);
    console.log('cws: ✓ refresh token saved to .env');
    done(200, '<h3>✓ Tabsona is authorised. You can close this tab.</h3>', 0);
  });

  server.listen(OAUTH_PORT, () => {
    console.log('cws: approve access in the browser, signed in as the Web Store developer account:\n');
    console.log(`${url}\n`);
    spawn('open', [url], { stdio: 'ignore' }).on('error', () => {});
    console.log(`cws: waiting for Google on ${redirect} …`);
  });
}

// --- store calls ------------------------------------------------------------

/** The zip `task package` produced for the CURRENT manifest version. */
function packagePath() {
  const { version } = JSON.parse(readFileSync(resolve(ROOT, 'apps/extension/manifest.json'), 'utf8'));
  const zip = resolve(ROOT, `dist/tabsona-${version}.zip`);
  if (!existsSync(zip)) {
    console.error(`cws: ${zip} not found — run \`task package\` first`);
    process.exit(1);
  }
  return zip;
}

/** Call the Store API and return parsed JSON, throwing with the Store's own error text. */
async function call(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
    ...(body ? { body } : {}),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${JSON.stringify(data.error ?? data)}`);
  return data;
}

/** Wait for an upload to finish against the real API and clock (loop in lib-cws.mjs). */
function settleUpload(token, id, first) {
  return settle(first, {
    getItem: () => call(token, 'GET', `${API}/${id}?projection=DRAFT`),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    intervalMs: UPLOAD_POLL_MS,
    maxPolls: UPLOAD_POLL_TRIES,
  });
}

const commands = {
  auth: (env) => auth(env),

  /** Create a NEW draft item from the package. Private until published. Run once. */
  async create(env) {
    if (env.CWS_EXTENSION_ID) {
      console.error(`cws: CWS_EXTENSION_ID is already set (${env.CWS_EXTENSION_ID}) — use \`task cws:upload\` to update it`);
      process.exit(1);
    }
    const token = await accessToken(env);
    const created = await call(token, 'POST', UPLOAD_API, readFileSync(packagePath()));
    writeEnv('CWS_EXTENSION_ID', created.id);
    const item = await settleUpload(token, created.id, created);
    console.log(`cws: ✓ draft item created — ${item.id}`);
    console.log(`     https://chrome.google.com/webstore/devconsole  (fill the listing from brand/store/LISTING.md)`);
  },

  /** Replace the draft's package with the current build. */
  async upload(env) {
    const [id] = need(env, 'CWS_EXTENSION_ID');
    const token = await accessToken(env);
    const first = await call(token, 'PUT', `${UPLOAD_API}/${id}`, readFileSync(packagePath()));
    const item = await settleUpload(token, id, first);
    console.log(`cws: ✓ uploaded ${item.id} (${item.uploadState})`);
  },

  /** Submit the draft for review. Fails, naming what is missing, until the listing is complete. */
  async publish(env) {
    const [id] = need(env, 'CWS_EXTENSION_ID');
    const token = await accessToken(env);
    const res = await call(token, 'POST', `${API}/${id}/publish`);
    console.log(`cws: status ${JSON.stringify(res.status)}`);
    for (const detail of res.statusDetail ?? []) console.log(`     ${detail}`);
  },

  async status(env) {
    const [id] = need(env, 'CWS_EXTENSION_ID');
    const token = await accessToken(env);
    const item = await call(token, 'GET', `${API}/${id}?projection=DRAFT`);
    console.log(JSON.stringify({ id: item.id, uploadState: item.uploadState, itemError: item.itemError }, null, 2));
  },
};

const name = process.argv[2];
const command = name ? commands[name] : undefined;
if (!command) {
  console.error(`usage: cws.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
try {
  await command(readEnv());
} catch (err) {
  console.error(`cws: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
