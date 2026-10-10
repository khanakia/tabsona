# Limits — everything this does not do

The complete known list, not a highlights reel. A tool that looks isolated while leaking is worse than no tool, so every hole is written down here and — where the engine can detect it — shown on the tab's badge.

Each row says whether it is **verified** (checked in code, or observed in a run) or **assumed** (believed, never tested). Assumed is not a softer word for verified.

**Shown** says what you would see:

- **badge** — an affected tab reports it in the page.
- **silent** — you get no warning. These are the dangerous ones, and they are the backlog.
- **n/a** — a design decision rather than a leak.

## Isolation holes

| Limit | Shown | Status | Impact |
|---|---|---|---|
| A stopped form POST cannot be resent | page says so | verified | The gate sees only the url of a blocked navigation. A form POST is recognised through the page's `submit` event, and the tab is then taken back to the form after the host is allowed so the button is pressed again; the body is never stored. A form sent by script (`form.submit()`, which fires no event) is not recognised and is resumed as a plain visit, which the provider may reject for missing parameters. `e2e:signin` phase H pins the recognised case. |
| The sign-in gate stops page navigations only | badge when it happens | verified | A sub-frame, a `fetch`/XHR or a service worker's request to a website Tabsona is not allowed on is not blocked (blocking those breaks pages in ways no one could trace to a sign-in) and can carry the browser's login. It is caught afterwards: the leak window drops what the tab captures, the session is marked "signed in through an unprotected website" and offers Start over signed out. Allow on all sites removes the case. |
| Service-worker fetches carry no tab id | badge | verified | A service worker's own requests match no per-tab rule and hit the shared cookie jar. Unfixable in the extension model — only a debugger-based or native engine could see them. |
| IndexedDB opened inside a worker is shared | badge | verified | The page's databases are namespaced per session (`open`, `deleteDatabase`, `databases()` and `db.name` translated; proven by `e2e:storage`, including a break run). A dedicated worker or service worker has its own `indexedDB` the shim never runs in, so the badge reports the layer leaking whenever the page starts a worker. |
| A persona's IndexedDB data is not exported, duplicated or cleaned up | silent | verified | It lives in the browser under `<session>::<name>`. Export/import JSON leaves it out, a duplicated persona starts with empty databases, and deleting a session leaves its databases behind until the site's data is cleared. |
| Cross-origin iframes cannot learn their session | badge when seen | assumed | The shim runs in every frame, but the session marker travels on the top frame's URL hash, `window.name` and `sessionStorage` — none of which a cross-origin child shares. Never measured. |
| A page that reads `localStorage` before `document_start` | silent | assumed | The shim installs at `document_start`, but anything earlier in the same tick would see the real store. Believed rare; never measured. |
| Dedicated Workers are untouched | badge | verified | The shim does not run inside a Worker, so a worker's own storage and fetches are outside every guard. The shim notices `new Worker` and the IndexedDB layer is reported leaking on that page. |
| CacheStorage is untouched | silent | verified | Never namespaced. Rarely carries auth, but an app could cache an authenticated response and serve it to the wrong session. |
| `SharedWorker` is removed wholesale | silent | verified | `delete window.SharedWorker` on every isolated origin, because it re-syncs login state across same-origin tabs behind every other guard. Breaks any app legitimately using one. |
| HTTP Basic auth and client certificates | silent | verified | Not handled at all. Browser-level credentials are shared by every tab. |
| Browser fingerprint is identical across sessions | n/a | by design | Canvas, WebGL, fonts, timezone, screen. Out of scope — this is a developer tool, not an anti-detect browser. |

## Cookie engine

| Limit | Shown | Status | Impact |
|---|---|---|---|
| `partitionKey` is modelled but never populated | silent | verified | `CookieRecord` carries `partitionKey` and cookie identity includes it, but capture always passes null — so under CHIPS all partitions of one cookie collapse into a single record. Presents as random logouts on sites using partitioned cookies. |
| Only `main_frame` and `xmlhttprequest` responses are harvested | silent | verified | Deliberate: harvesting from arbitrary sub-requests causes session churn that breaks CSRF tokens. A `Set-Cookie` arriving on a request classed as another type is missed. |
| `document.cookie` is the persona's, with two gaps | silent | verified | In a persona tab a script's `document.cookie` write goes into the session (and its rule is installed before the page's next `fetch`/XHR leaves), and a read returns the session's cookies without the `HttpOnly` ones. Gaps: a request the page cannot be made to wait for, namely a navigation started straight after a write (`location.href = …`, a form submit) or a synchronous XHR, can leave before the rule is in force; and `cookieStore` (the async cookie API) is not wrapped. The `fetch`/XHR wrappers also delay a request that follows a response by a few milliseconds, only inside a persona tab. `e2e:signin` phase J pins what works, with a plain-tab control. |
| `chrome.cookies.getAll` returns nothing on Chrome 154 | n/a | verified | Every filter shape returns `[]`, while `chrome.cookies.get({url, name})` returns the same cookie. Importing a login therefore reads cookie names off the tab's own request header and looks each one up. Works, but it is a workaround around a browser bug. |
| Cookie size and header limits are not enforced | silent | verified | A very large jar could produce a `Cookie` header a server rejects. No truncation, no warning. |
| No cross-extension rule conflict handling | silent | assumed | Another extension modifying the `Cookie` header can win or lose by rule priority. Untested with any other extension installed. |
| Redirects across domains may not extend the session's domain set | silent | assumed | The domain set grows from observed cookies and the host of each captured response. An SSO hop that sets nothing may not register. |
| Sign-in through a website Tabsona is not allowed on uses the browser's login | popup alert, toolbar `!`, badge | verified | Header rules apply only on allowed hosts, so a request to an un-allowed identity provider (AuthKit, Google, Okta) carries the browser's cookies and the provider signs the persona tab in as the browser's user; its `Set-Cookie` also lands in the browser's jar. Seen when an allowed host redirects a bound tab there, and filed under the persona's site so every host of a chain is listed; the popup's pinned alert offers Allow and Allow all. Each later host of a chain is seen only after the one before it is allowed, since no response from an un-allowed host reaches the extension. A sign-in reached by a plain link or form, not a redirect, is not noticed. With **Allow on all sites** none of this applies: every host is covered. `e2e:signin`. |
| A cookie set on a redirect misses the very next request | silent | verified | Capture is observation: the response is reported to the extension after the fact, and a redirect's follow-up request is issued by Chrome's network stack immediately, with no extension step in between that could be waited for (MV3 removed the blocking `webRequest` that could). So a response that sets a cookie AND redirects (a provider's sign-in POST, an OAuth callback, a `/CheckCookie` hop) sends its follow-up without the cookie, and arrives signed out or "cookies disabled". A cookie set by a `fetch`/XHR response is not affected (the page's next request is held until the rule is in force, see above), and a later navigation carries it. Repeating the step works; `e2e:signin` counts the retries and prints the redirect case as informational. |
| Signing in with Google (or another identity provider) inside a persona | fixed by an opt-in list: **Use my normal login on** | verified | Google sets its flow cookie on a redirect and expects it back on the very next request, and an extension cannot attach a cookie to a redirect's follow-up (see the row above); Google's own sign-in also refreshes its cookies from inside the browser, out of reach of any per-tab rule. The fix is not isolating Google but letting it use the browser's own login: the gate page, the popup's sign-in alert and Settings → **Use my normal login on** offer **Use my normal Google login here** / **Restore default sites** (`accounts.google.com`, `accounts.youtube.com`), nothing is on the list until you add it, and no new permission or banner is involved. What that shares: the website sees the browser's login, so Google lets you pick the account in its own chooser, an account added there is added to the browser too, and two personas get different Google accounts only if you pick different ones in the chooser. What stays separate: the app's own session, set after the OAuth callback on the app's host. The badge on a listed website says **uses your normal login (your choice)**, never separate. A stricter mode that keeps Google per persona would need the `debugger` permission and is not planned for this extension. Measured in `spike/probe-redirect-cookie.mjs`; the list is proven in `e2e:signin` phases P, P2 and P3. The full story, step by step, is in [how-it-works.md](how-it-works.md#signing-in-with-google-and-other-identity-providers). |

## Product and operational

| Limit | Shown | Status | Impact |
|---|---|---|---|
| Site access needs a manual permission click | n/a | by design | `chrome.permissions.request` opens Chrome's own dialog and must come from a click: once for every website (**Allow on all sites**), or once per website. Cannot be automated — and a headless attempt hangs silently rather than failing. |
| With Allow on all sites, a persona tab is signed out of every other website | n/a | by design | The strip rule then applies on every host, so a persona tab never sends the browser's login anywhere: a Google or GitHub page it reaches starts signed out in that tab. That is the point (it is what keeps an SSO chain separate), and the welcome, the Settings ⓘ and the button's help all say so before the click. Tabs outside a persona are unchanged. |
| Storage capture runs every 15 seconds | silent | verified | Plus on page load, before unbind, and before a tab moves to another session. A browser crash can lose up to one interval of a session's page storage. |
| A new session starts signed out, and that reads as broken | n/a | verified | An empty session must strip the browser's cookies or the tab inherits the existing login. Users read this as a button that did nothing. Mitigated with an "Empty" chip, an explanation, and a badge reading "sign in to save" — but it remains the product's sharpest edge. |
| Moving a tab between sessions reloads it | n/a | verified | The tab bounces through `about:blank` to force a real document load, because a same-URL change is a fragment navigation and the page shim would never re-run. In-page state is lost. |
| Restore reloads the tab | n/a | verified | The saved slice is injected and the tab reloaded so the app boots with its tokens. Scroll position, open dialogs and unsent forms are lost. |
| Chrome only | n/a | verified | Firefox has a first-class containers API and would need a different engine; Safari's `declarativeNetRequest` cannot modify the `Cookie` header at all. |
| Incognito is untested | silent | assumed | Never run in an incognito window. Chrome keeps a separate cookie store there, so behaviour is unknown. |
| Multiple windows are untested | silent | assumed | Bindings are per tab id and should be window-agnostic, but no run has used two windows. |
| Not published to the Chrome Web Store | n/a | verified | Load-unpacked only. Store review would likely question the broad optional host permission. |
| No automated test of the grant flow | n/a | verified | The end-to-end suites pre-grant the origin in the built manifest, because Chrome's permission dialog needs a human click (`e2e:signin` grants `*://*/*` the same way for Allow on all sites). The buttons themselves, and the re-scoping on a runtime `permissions.onAdded`, are only manually verified. |
| A code path only real data reaches is a path no test covers | n/a | verified | The data migration only runs when old data exists, so fresh-profile runs never entered it — and a bug inside it killed the worker on a real upgrade. Now covered, but the shape generalises: seed the state a path needs, or it is untested. |
| Headless runs start the worker once; real reloads do not | n/a | verified | Reloading at `chrome://extensions` runs the worker module *and* fires `onInstalled`, so two boots race. That produced a duplicate-registration error no headless run could reproduce. Now covered, but a single-start harness cannot see restart-shaped bugs in general. |

## What would fix the big three

**Service-worker bypass — needs a different engine.** No extension API attributes a service worker's fetch to a tab. The two real options are the `chrome.debugger` engine (`Fetch.continueRequest` sees every request, at the cost of a visible infobar) or a native host driving real browser contexts.

**IndexedDB — done for the page (2026-10-04).** Database names are rewritten to `<sessionId>::<name>` on the real prototypes; what remains is IndexedDB opened inside workers, which would need the worker's script source proxied.

**Cross-origin iframes — the marker has to reach the child.** The session id would have to travel on something a cross-origin child can read. Nothing currently does. Worth measuring how often auth actually lives in such a frame before building for it.

## Deliberately not doing

Decisions, not gaps, recorded so they are not re-litigated:

- **Fingerprint spoofing, proxy per session, ban evasion.** This is a developer tool for testing your own apps. That entire category is what anti-detect browsers sell, and competing there would change the product.
- **Cloud sync of sessions.** Sessions hold live credentials. They stay on the machine.
- **Isolating tabs you did not ask to isolate.** An unbound tab must behave exactly like an ordinary tab — the shim returns immediately when no session marker is present, so the extension's presence is not observable on ordinary pages.
