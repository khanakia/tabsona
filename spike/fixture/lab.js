// Storage lab: three mini apps, each keeping its login in exactly ONE storage layer.
//
// WHY this exists: an isolation claim is only as good as the app it was tested against.
// The main fixture mirrors one identity into every layer at once, which is right for
// spotting a leak and wrong for proving a single layer is separated — a layer that
// leaks can be masked by another that does not. Here each app depends on one layer
// alone, so a suite can say exactly which layer holds and which leaks:
//
//   /lab/cookie  login in an HttpOnly cookie (lab_sid), no storage writes at all
//   /lab/local   login token in localStorage (lab_token), sent as a Bearer header
//   /lab/idb     login token in IndexedDB, plus an offline-first notes app: notes and an
//                outbox of unsent notes live in IndexedDB; sync() uploads the outbox
//                as whoever the stored token says you are
//
// The IndexedDB app is deliberately the NAIVE kind: one fixed database name for every
// user, no check that stored data belongs to the signed-in user. That is the shape that
// makes two personas corrupt each other, so it is the shape isolation has to survive.
//
// Every page exposes `window.__lab` for drivers and shows the user on screen for humans.
// Zero dependencies, like the server that mounts it.

const crypto = require('node:crypto');

/** Who may sign in. Password-free: this is a localhost fixture, and real credential
 *  handling would only obscure the thing under test. */
const LAB_USERS = ['alice', 'bob'];
const LAB_COOKIE = 'lab_sid';
const IDB_NAME = 'lab-notes';

/** sid or token -> user, and user -> notes the server has accepted. In-memory: every
 *  suite starts from a fresh server or calls /api/lab/reset. */
const cookieSessions = new Map();
const tokens = new Map();
const serverNotes = new Map();

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

/** The signed-in user, from a Bearer token first, then the lab cookie. */
function userFor(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return tokens.get(auth.slice('Bearer '.length)) ?? null;
  const sid = parseCookies(req.headers.cookie)[LAB_COOKIE];
  return sid ? cookieSessions.get(sid) ?? null : null;
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}

function json(res, status, value, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra })
    .end(JSON.stringify(value));
}

const STYLE = `body{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:0;padding:24px;background:#0b0b0c;color:#e7e7ea}
.who{font-size:36px;font-weight:700;margin:0 0 4px}.muted{color:#9a9aa3;font-size:12px}
button{font:inherit;height:28px;padding:0 12px;border-radius:6px;border:1px solid #3a3a42;background:#1a1a1f;color:#e7e7ea;cursor:pointer;margin-right:6px}
code{background:#1a1a1f;padding:1px 5px;border-radius:4px}ul{padding-left:18px}`;

/** Shared client code: render who is signed in, wire the buttons. */
const COMMON_JS = `
const $ = (id) => document.getElementById(id);
async function render() {
  const who = await window.__lab.whoami();
  $('who').textContent = who ?? 'signed out';
  document.body.dataset.user = who ?? '';
  if (window.__lab.notes) {
    const list = await window.__lab.notes();
    $('notes').innerHTML = list.map((n) => '<li>' + n.replace(/</g, '&lt;') + '</li>').join('');
  }
}
for (const u of ${JSON.stringify(LAB_USERS)}) {
  const b = document.createElement('button');
  b.textContent = 'log in as ' + u;
  b.onclick = async () => { await window.__lab.login(u); await render(); };
  $('buttons').appendChild(b);
}
$('logout').onclick = async () => { await window.__lab.logout(); await render(); };
window.__labReady = render().then(() => true);
`;

const CLIENT = {
  cookie: `
window.__lab = {
  layer: 'cookie',
  async login(user) {
    await fetch('/api/lab/cookie-login', { method: 'POST', body: JSON.stringify({ user }) });
  },
  async logout() { await fetch('/api/lab/cookie-logout', { method: 'POST' }); },
  async whoami() {
    const r = await fetch('/api/lab/me', { cache: 'no-store' });
    return (await r.json()).user;
  },
};`,

  local: `
const KEY = 'lab_token';
window.__lab = {
  layer: 'localStorage',
  async login(user) {
    const r = await fetch('/api/lab/token', { method: 'POST', body: JSON.stringify({ user }) });
    localStorage.setItem(KEY, (await r.json()).token);
  },
  async logout() { localStorage.removeItem(KEY); },
  async whoami() {
    const token = localStorage.getItem(KEY);
    if (!token) return null;
    const r = await fetch('/api/lab/me', { cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer ' + token } });
    return (await r.json()).user;
  },
};`,

  idb: `
const DB = ${JSON.stringify(IDB_NAME)};
let offline = false;
function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('auth');
      db.createObjectStore('notes', { autoIncrement: true });
      db.createObjectStore('outbox', { autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
/** One transaction; resolves with the request's result once the transaction commits. */
async function tx(store, mode, op) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = op(t.objectStore(store));
    t.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}
const token = () => tx('auth', 'readonly', (s) => s.get('token'));
const authed = async (path, init = {}) => {
  const t = await token();
  return fetch(path, { ...init, cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer ' + (t ?? '') } });
};
window.__lab = {
  layer: 'indexedDB',
  async login(user) {
    const r = await fetch('/api/lab/token', { method: 'POST', body: JSON.stringify({ user }) });
    // Read the token BEFORE opening the transaction: an IndexedDB transaction commits as
    // soon as its callback yields, so awaiting inside it would write to a closed one.
    const fresh = (await r.json()).token;
    await tx('auth', 'readwrite', (s) => s.put(fresh, 'token'));
  },
  async logout() { await tx('auth', 'readwrite', (s) => s.delete('token')); },
  async whoami() {
    if (!(await token())) return null;
    return (await (await authed('/api/lab/me')).json()).user;
  },
  async addNote(text) {
    await tx('notes', 'readwrite', (s) => s.add(text));
    await tx('outbox', 'readwrite', (s) => s.add(text));
    if (!offline) await window.__lab.sync();
  },
  notes: () => tx('notes', 'readonly', (s) => s.getAll()),
  outbox: () => tx('outbox', 'readonly', (s) => s.getAll()),
  setOffline(value) { offline = Boolean(value); },
  /** Upload every queued note AS WHOEVER THE STORED TOKEN SAYS — the step that sends one
   *  user's edits under another user's account when the database is shared. */
  async sync() {
    if (offline) return 0;
    const pending = await window.__lab.outbox();
    if (pending.length === 0) return 0;
    await authed('/api/lab/notes', { method: 'POST', body: JSON.stringify({ notes: pending }) });
    await tx('outbox', 'readwrite', (s) => s.clear());
    return pending.length;
  },
  async serverNotes() { return (await (await authed('/api/lab/notes')).json()).notes; },
  async dbNames() { return (await indexedDB.databases()).map((d) => d.name); },
  /** The name the app reads back from an open database — must be the name it asked for. */
  async dbNameProperty() { const db = await openDb(); const n = db.name; db.close(); return n; },
  deleteDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase(DB);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
      r.onblocked = () => resolve(false);
    });
  },
};`,
};

const TITLES = {
  cookie: 'Cookie login (HttpOnly lab_sid, no storage)',
  local: 'localStorage login (lab_token → Bearer)',
  idb: 'IndexedDB login + offline-first notes',
};

function page(kind) {
  const notes = kind === 'idb'
    ? `<p class="muted">notes (stored in IndexedDB <code>${IDB_NAME}</code>):</p><ul id="notes"></ul>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>lab · ${kind}</title><style>${STYLE}</style></head>
<body data-user=""><p class="muted">${TITLES[kind]}</p><p class="who" id="who">…</p>
<p id="buttons"></p><p><button id="logout">log out</button></p>${notes}
<script>${CLIENT[kind]}
${COMMON_JS}</script></body></html>`;
}

/**
 * Handle a /lab or /api/lab request. Returns true when it answered, so the host server
 * can fall through to its own routes otherwise.
 */
function handleLab(req, res, url) {
  const kind = /^\/lab\/(cookie|local|idb)$/.exec(url.pathname)?.[1];
  if (kind && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(page(kind));
    return true;
  }
  if (!url.pathname.startsWith('/api/lab/')) return false;
  const route = `${req.method} ${url.pathname.slice('/api/lab/'.length)}`;

  void (async () => {
    switch (route) {
      case 'POST cookie-login': {
        const { user } = await readJson(req);
        if (!LAB_USERS.includes(user)) return json(res, 400, { error: 'unknown user' });
        const sid = crypto.randomBytes(16).toString('hex');
        cookieSessions.set(sid, user);
        return json(res, 200, { ok: true }, { 'Set-Cookie': `${LAB_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax` });
      }
      case 'POST cookie-logout':
        return json(res, 200, { ok: true }, { 'Set-Cookie': `${LAB_COOKIE}=; Path=/; HttpOnly; Max-Age=0` });
      case 'POST token': {
        const { user } = await readJson(req);
        if (!LAB_USERS.includes(user)) return json(res, 400, { error: 'unknown user' });
        const token = crypto.randomBytes(16).toString('hex');
        tokens.set(token, user);
        return json(res, 200, { token });
      }
      case 'GET me':
        return json(res, 200, { user: userFor(req) });
      case 'GET notes': {
        const user = userFor(req);
        return user ? json(res, 200, { notes: serverNotes.get(user) ?? [] }) : json(res, 401, { error: 'signed out' });
      }
      case 'POST notes': {
        const user = userFor(req);
        if (!user) return json(res, 401, { error: 'signed out' });
        const { notes } = await readJson(req);
        serverNotes.set(user, [...(serverNotes.get(user) ?? []), ...(Array.isArray(notes) ? notes : [])]);
        return json(res, 200, { ok: true });
      }
      case 'POST reset':
        cookieSessions.clear(); tokens.clear(); serverNotes.clear();
        return json(res, 200, { ok: true });
      default:
        return json(res, 404, { error: 'no such lab route' });
    }
  })();
  return true;
}

module.exports = { handleLab, LAB_USERS, IDB_NAME };
