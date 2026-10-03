// Two-role fixture app for the isolation spikes.
//
// WHY this exists: every isolation claim in this project has to be demonstrated
// against a real login, not reasoned about. This is the smallest server that has
// a real HttpOnly cookie session plus the storage layers an app might use
// instead, so a spike can observe exactly which layer leaks across tabs.
//
// Deliberately zero dependencies so it can be run by any spike, any time, with
// `node spike/fixture/server.js` and no install step.

const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8787);

/**
 * The fixture's two roles. Password is the username — this is a test fixture on
 * localhost and adding real credential handling would only obscure the thing
 * under test.
 */
const USERS = ['alice', 'bob'];

/** sid -> username. In-memory: the server restarts between spike runs anyway. */
const sessions = new Map();

/** Cookie name the fixture authenticates with. HttpOnly, so only the engine's
 * header-level capture can see it — a content script never can. That is the
 * point: it reproduces the hardest real case. */
const COOKIE_NAME = 'fixture_sid';

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function userFor(req) {
  const sid = parseCookies(req.headers.cookie)[COOKIE_NAME];
  return sid ? sessions.get(sid) : undefined;
}

function html(body) {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>fixture</title>
<style>
  body{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:0;padding:24px;background:#0b0b0c;color:#e7e7ea}
  .who{font-size:40px;font-weight:700;letter-spacing:-.02em;margin:0 0 4px}
  .muted{color:#9a9aa3;font-size:12px}
  button{font:inherit;height:28px;padding:0 12px;border-radius:6px;border:1px solid #3a3a42;background:#1a1a1f;color:#e7e7ea;cursor:pointer}
  button:hover{background:#24242b}
  code{background:#1a1a1f;padding:1px 5px;border-radius:4px}
  table{border-collapse:collapse;margin-top:14px;font-size:13px}
  td{padding:2px 14px 2px 0;vertical-align:top}
  td:first-child{color:#9a9aa3}
</style></head><body>${body}
<script>
// Mirror the cookie identity into the other storage layers, so a spike can see
// per-layer leakage in one glance. Written on every load.
(function(){
  var who = document.body.dataset.user || '';
  try { localStorage.setItem('fixture_token', who); } catch(e){}
  try { sessionStorage.setItem('fixture_token', who); } catch(e){}
  var put = function(id, v){ var el=document.getElementById(id); if(el) el.textContent = v===null?'(empty)':v; };
  try { put('ls', localStorage.getItem('fixture_token')); } catch(e){ put('ls','(blocked)'); }
  try { put('ss', sessionStorage.getItem('fixture_token')); } catch(e){ put('ss','(blocked)'); }
})();
</script></body></html>`;
}

function page(user) {
  if (!user) {
    const buttons = USERS.map((u) => `<form method="POST" action="/login" style="display:inline">
      <input type="hidden" name="user" value="${u}">
      <button type="submit">log in as ${u}</button></form>`).join(' ');
    return html(`<p class="who" id="who">logged out</p>
      <p class="muted">no valid <code>${COOKIE_NAME}</code> cookie reached the server</p>
      <p>${buttons}</p>`);
  }
  return html(`<p class="who" id="who">${user}</p>
    <p class="muted">server read this from the HttpOnly <code>${COOKIE_NAME}</code> cookie</p>
    <table>
      <tr><td>localStorage</td><td id="ls">?</td></tr>
      <tr><td>sessionStorage</td><td id="ss">?</td></tr>
    </table>
    <p style="margin-top:16px">
      <form method="POST" action="/logout" style="display:inline"><button type="submit">log out</button></form>
    </p>`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'POST' && url.pathname === '/login') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const user = new URLSearchParams(body).get('user');
      if (!USERS.includes(user)) {
        res.writeHead(400).end('unknown user');
        return;
      }
      const sid = crypto.randomBytes(16).toString('hex');
      sessions.set(sid, user);
      // HttpOnly on purpose: only header-level capture can see this.
      res.writeHead(302, {
        'Set-Cookie': `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax`,
        Location: url.searchParams.size ? `/?${url.searchParams}` : '/',
      }).end();
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/logout') {
    const sid = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (sid) sessions.delete(sid);
    res.writeHead(302, {
      'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`,
      Location: '/',
    }).end();
    return;
  }

  // Machine-readable truth, for a spike to assert on without scraping HTML.
  if (url.pathname === '/whoami') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify({ user: userFor(req) ?? null }));
    return;
  }

  if (url.pathname === '/') {
    const user = userFor(req);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(page(user).replace('<body>', `<body data-user="${user ?? ''}">`));
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, () => {
  console.log(`fixture listening on http://localhost:${PORT}`);
});
