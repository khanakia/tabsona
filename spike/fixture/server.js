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
const { handleLab } = require('./lab');

const PORT = Number(process.env.PORT || 8787);

/**
 * COOKIE_ONLY=1 makes `/` behave like a real app behind an auth provider (AuthKit,
 * OAuth): the login lives ONLY in an HttpOnly cookie — nothing in localStorage or
 * sessionStorage — and a signed-out request is 302'd to a separate sign-in page
 * instead of rendering a login form.
 *
 * WHY: the default mode mirrors the identity into storage on every load, so a restored
 * session always has storage, and restoring storage triggers a reload that quietly
 * re-sent the request with the right cookie. That masked a bug for every cookie-only
 * app: the persona's FIRST request left with no cookie and the redirect bounced the tab
 * to the sign-in page before any reload could save it.
 */
const COOKIE_ONLY = process.env.COOKIE_ONLY === '1';
const SIGNIN_PATH = '/signin';

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

function html(body, { mirrorStorage = true } = {}) {
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
${mirrorStorage ? MIRROR_SCRIPT : ''}</body></html>`;
}

/** A 200 html page that mirrors nothing into storage: these pages stand in for hosts the
 *  suite is not supposed to be signed in on. */
function html200(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    .end(html(body, { mirrorStorage: false }));
}

const MIRROR_SCRIPT = `<script>
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
</script>`;

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

/** COOKIE_ONLY pages: identical, minus every storage write. */
function cookieOnlyPage(user) {
  if (!user) {
    const buttons = USERS.map((u) => `<form method="POST" action="/login" style="display:inline">
      <input type="hidden" name="user" value="${u}">
      <button type="submit">log in as ${u}</button></form>`).join(' ');
    return html(`<p class="who" id="who">sign in</p><p>${buttons}</p>`, { mirrorStorage: false });
  }
  return html(`<p class="who" id="who">${user}</p>
    <p class="muted">cookie-only: nothing in localStorage or sessionStorage</p>`, { mirrorStorage: false });
}

/** Which cookie NAMES reached this host, for a cross-host leak check. CORS with
 *  credentials, so a page on another origin can make the request and read the answer. */
function echoCookies(req, res) {
  const origin = req.headers.origin;
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' } : {}),
  }).end(JSON.stringify({ cookies: Object.keys(parseCookies(req.headers.cookie)) }));
}

/**
 * A single-sign-on hop, shaped like AuthKit / OAuth: the app keeps no login form of its
 * own, `/sso/start` sends the browser to an identity provider on ANOTHER host, and the
 * provider sends it back with a one-time code once it knows who you are.
 *
 * WHY: the provider has its own login cookie on its own host. A real user is usually
 * already signed in there from a plain tab, so a persona tab whose request to the
 * provider carries the browser's provider cookie comes straight back signed in as that
 * user, without ever seeing a login form. That is the leak a suite has to be able to
 * reproduce, and it needs a second cookie jar, i.e. a second host name.
 *
 * The provider is this same server reached as `127.0.0.1` (IDP_HOST): cookies record no
 * port, so `localhost` and `127.0.0.1` are two jars on one process.
 *
 * And it is a CHAIN, like the real one (app → api.workos.com → auth.<custom domain> →
 * *.authkit.app): `/sso/start` first goes to a RELAY host that holds no login and only
 * redirects on, the way api.workos.com does, and the login lives one hop further on. A
 * single-hop fixture hid a real bug: a hop seen on a provider's response was filed under
 * the provider, so allowing the first host made the warning vanish while the leak went on.
 * The relay is `relay.localhost`, which Chrome resolves to loopback on its own.
 */
const IDP_HOST = process.env.IDP_HOST || '127.0.0.1';
const RELAY_HOST = process.env.RELAY_HOST || 'relay.localhost';
/** The OAuth-shaped provider host (accounts.google.com's role): never granted by a suite. */
const OAUTH_HOST = process.env.OAUTH_HOST || 'other.localhost';
/** The authorize query as the real provider gets it. `+`, `=`, `%2F`, `%3A`, `%20` and a
 *  doubled `&` are all deliberate: each is a way a rebuilt url stops being byte-identical. */
const OAUTH_QUERY = 'client_id=client_01ABC&redirect_uri=https%3A%2F%2Fauth.example.com%2Fcallback%2Fv1'
  + '&response_type=code&scope=openid%20email%20profile&state=eyJhIjoiYitjPT0ifQ%3D%3D%2B&nonce=a+b%2Fc'
  + '&access_type=offline&prompt=select_account';
const IDP_COOKIE = 'idp_sid';
/** sid -> username, for the provider's own login. */
const idpSessions = new Map();
/** one-time code -> username, handed from the provider back to the app. */
const ssoCodes = new Map();

function idpUserFor(req) {
  const sid = parseCookies(req.headers.cookie)[IDP_COOKIE];
  return sid ? idpSessions.get(sid) : undefined;
}

function idpLoginPage(returnTo) {
  const buttons = USERS.map((u) => `<form method="POST" action="/idp/login?return=${encodeURIComponent(returnTo)}" style="display:inline">
      <input type="hidden" name="user" value="${u}">
      <button type="submit">log in as ${u}</button></form>`).join(' ');
  return html(`<p class="who" id="who">identity provider</p><p>${buttons}</p>`, { mirrorStorage: false });
}

/** Handle the provider and the app's two SSO endpoints. Returns true when it answered. */
function handleSso(req, res, url) {
  if (url.pathname === '/sso/start') {
    const back = `http://${req.headers.host}/sso/callback`;
    res.writeHead(302, {
      Location: `http://${RELAY_HOST}:${PORT}/relay/authorize?return=${encodeURIComponent(back)}`,
      'Cache-Control': 'no-store',
    }).end();
    return true;
  }
  // --- cookie round-trips, as a provider's "are cookies enabled?" check does them -----
  // Google writes a test cookie from page JS (document.cookie) and from an XHR response
  // (Set-Cookie), then makes a request that fails unless BOTH come straight back. These
  // routes mimic that with no knowledge of any extension.
  if (url.pathname === '/ck/echo') {
    // What reached the server: the Cookie header, parsed.
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify({ cookies: parseCookies(req.headers.cookie) }));
    return true;
  }
  if (url.pathname === '/ck/set') {
    // A cookie on a plain 200 (an XHR/fetch response). `?redirect=` makes it a 302.
    const redirect = url.searchParams.get('redirect');
    const cookie = `${url.searchParams.get('name') || 'xhrtest'}=1; Path=/${url.searchParams.get('httponly') ? '; HttpOnly' : ''}`;
    if (redirect) res.writeHead(302, { 'Set-Cookie': cookie, Location: redirect, 'Cache-Control': 'no-store' }).end();
    else res.writeHead(200, { 'Set-Cookie': cookie, 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('ok');
    return true;
  }
  if (url.pathname === '/ck/check') {
    // The verdict page: needs both test cookies, like Google's "Cookies are disabled" screen.
    const c = parseCookies(req.headers.cookie);
    const ok = c.jstest === '1' && c.xhrtest === '1';
    html200(res, `<p id="verdict">${ok ? 'cookies enabled' : 'Cookies are disabled'}</p><pre id="seen">${JSON.stringify(c)}</pre>`);
    return true;
  }
  if (url.pathname === '/ck/page') {
    // Runs the three ways a cookie reaches the next request and reports which came back.
    html200(res, `<p id="out">running</p><script>
      const echo = () => fetch('/ck/echo', { cache: 'no-store' }).then((r) => r.json()).then((j) => Object.keys(j.cookies).sort());
      (async () => {
        const out = {};
        try {
        document.cookie = 'jstest=1; path=/';
        out.readBack = document.cookie;                       // the page's own view, synchronously
        out.afterJs = await echo();                           // fetch right after document.cookie
        await fetch('/ck/set?name=xhrtest', { cache: 'no-store' });
        out.afterXhr = await echo();                          // fetch right after a Set-Cookie response
        await fetch('/ck/set?name=redir&redirect=' + encodeURIComponent('/ck/echo'), { cache: 'no-store' })
          .then((r) => r.json()).then((j) => { out.afterRedirect = Object.keys(j.cookies).sort(); });
        } catch (e) { out.error = String(e); }
        window.__ck = out;
        document.getElementById('out').textContent = 'done';
      })();
    </script>`);
    return true;
  }
  // A page with NO <title>: the browser reports its title as "", which is where the persona
  // marker used to double up ("💚 💚") because document.title trims what it is given.
  if (url.pathname === '/untitled') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      .end('<!doctype html><meta charset="utf-8"><p>no title here</p>');
    return true;
  }
  // An OAuth-shaped hop (the real one: AuthKit -> accounts.google.com/o/oauth2/v2/auth).
  // Several params, some holding encoded reserved characters, so a resumed navigation
  // that re-encodes, splits on `&` or drops a param is caught byte for byte.
  if (url.pathname === '/oauth/start') {
    res.writeHead(302, { Location: `http://${OAUTH_HOST}:${PORT}/o/auth?${OAUTH_QUERY}`, 'Cache-Control': 'no-store' }).end();
    return true;
  }
  // The app's page whose button POSTS the same params to the OAuth host (a form hop).
  if (url.pathname === '/oauth/form') {
    const fields = [...new URLSearchParams(OAUTH_QUERY)]
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${v.replace(/"/g, '&quot;')}">`).join('');
    html200(res, `<form id="oauth" method="POST" action="http://${OAUTH_HOST}:${PORT}/o/auth">${fields}<button>go</button></form>`);
    return true;
  }
  // The provider: says exactly what request reached it, and whether a cookie came along.
  if (url.pathname === '/o/auth') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      html200(res, `<pre id="seen">${JSON.stringify({ method: req.method, url: req.url, body, cookie: req.headers.cookie ?? null })
        .replace(/</g, '\\u003c')}</pre>`);
    });
    return true;
  }
  if (url.pathname === '/relay/authorize') {
    // No login here, only the next hop: what api.workos.com does before the custom domain.
    const returnTo = url.searchParams.get('return') || '/';
    res.writeHead(302, {
      Location: `http://${IDP_HOST}:${PORT}/idp/authorize?return=${encodeURIComponent(returnTo)}`,
      'Cache-Control': 'no-store',
    }).end();
    return true;
  }
  if (url.pathname === '/sso/callback') {
    const user = ssoCodes.get(url.searchParams.get('code'));
    ssoCodes.delete(url.searchParams.get('code'));
    if (!user) { res.writeHead(400).end('bad code'); return true; }
    const sid = crypto.randomBytes(16).toString('hex');
    sessions.set(sid, user);
    res.writeHead(302, {
      'Set-Cookie': `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax`,
      Location: '/',
      'Cache-Control': 'no-store',
    }).end();
    return true;
  }
  if (url.pathname === '/idp/authorize') {
    const returnTo = url.searchParams.get('return') || '/';
    const user = idpUserFor(req);
    if (user) {
      const code = crypto.randomBytes(8).toString('hex');
      ssoCodes.set(code, user);
      res.writeHead(302, { Location: `${returnTo}?code=${code}`, 'Cache-Control': 'no-store' }).end();
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(idpLoginPage(returnTo));
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/idp/login') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const user = new URLSearchParams(body).get('user');
      if (!USERS.includes(user)) { res.writeHead(400).end('unknown user'); return; }
      const sid = crypto.randomBytes(16).toString('hex');
      idpSessions.set(sid, user);
      const returnTo = url.searchParams.get('return') || '/';
      res.writeHead(302, {
        'Set-Cookie': `${IDP_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax`,
        Location: `/idp/authorize?return=${encodeURIComponent(returnTo)}`,
      }).end();
    });
    return true;
  }
  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (handleSso(req, res, url)) return;

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

  if (url.pathname === '/echo-cookies') {
    echoCookies(req, res);
    return;
  }

  if (COOKIE_ONLY && url.pathname === SIGNIN_PATH) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(cookieOnlyPage(null).replace('<body>', '<body data-user="">'));
    return;
  }

  if (COOKIE_ONLY && url.pathname === '/') {
    const user = userFor(req);
    if (!user) {
      res.writeHead(302, { Location: SIGNIN_PATH, 'Cache-Control': 'no-store' }).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(cookieOnlyPage(user).replace('<body>', `<body data-user="${user}">`));
    return;
  }

  if (url.pathname === '/') {
    const user = userFor(req);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      .end(page(user).replace('<body>', `<body data-user="${user ?? ''}">`));
    return;
  }

  // The storage lab: one mini app per storage layer. See lab.js.
  if (handleLab(req, res, url)) return;

  res.writeHead(404).end('not found');
});

server.listen(PORT, () => {
  console.log(`fixture listening on http://localhost:${PORT}${COOKIE_ONLY ? ' (cookie-only)' : ''}`);
});
