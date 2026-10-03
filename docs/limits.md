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
| Service-worker fetches carry no tab id | badge | verified | A service worker's own requests match no per-tab rule and hit the shared cookie jar. Unfixable in the extension model — only a debugger-based or native engine could see them. |
| IndexedDB is detected but not isolated | badge | verified | The shim hooks `indexedDB.open` to notice usage and the badge reports leaking. Apps storing auth in IndexedDB (some Firebase and Supabase setups) will cross-contaminate. |
| Cross-origin iframes cannot learn their session | badge when seen | assumed | The shim runs in every frame, but the session marker travels on the top frame's URL hash, `window.name` and `sessionStorage` — none of which a cross-origin child shares. Never measured. |
| A page that reads `localStorage` before `document_start` | silent | assumed | The shim installs at `document_start`, but anything earlier in the same tick would see the real store. Believed rare; never measured. |
| Dedicated Workers are untouched | silent | verified | The shim does not run inside a Worker, so a worker's own storage and fetches are outside every guard. |
| CacheStorage is untouched | silent | verified | Never namespaced. Rarely carries auth, but an app could cache an authenticated response and serve it to the wrong session. |
| `SharedWorker` is removed wholesale | silent | verified | `delete window.SharedWorker` on every isolated origin, because it re-syncs login state across same-origin tabs behind every other guard. Breaks any app legitimately using one. |
| HTTP Basic auth and client certificates | silent | verified | Not handled at all. Browser-level credentials are shared by every tab. |
| Browser fingerprint is identical across sessions | n/a | by design | Canvas, WebGL, fonts, timezone, screen. Out of scope — this is a developer tool, not an anti-detect browser. |

## Cookie engine

| Limit | Shown | Status | Impact |
|---|---|---|---|
| `partitionKey` is modelled but never populated | silent | verified | `CookieRecord` carries `partitionKey` and cookie identity includes it, but capture always passes null — so under CHIPS all partitions of one cookie collapse into a single record. Presents as random logouts on sites using partitioned cookies. |
| Only `main_frame` and `xmlhttprequest` responses are harvested | silent | verified | Deliberate: harvesting from arbitrary sub-requests causes session churn that breaks CSRF tokens. A `Set-Cookie` arriving on a request classed as another type is missed. |
| Cookies written by `document.cookie` in JavaScript are not captured | silent | verified | Capture reads network `Set-Cookie` headers only. An app that sets its session cookie from script will not have it saved into the session. |
| `chrome.cookies.getAll` returns nothing on Chrome 154 | n/a | verified | Every filter shape returns `[]`, while `chrome.cookies.get({url, name})` returns the same cookie. Importing a login therefore reads cookie names off the tab's own request header and looks each one up. Works, but it is a workaround around a browser bug. |
| Cookie size and header limits are not enforced | silent | verified | A very large jar could produce a `Cookie` header a server rejects. No truncation, no warning. |
| No cross-extension rule conflict handling | silent | assumed | Another extension modifying the `Cookie` header can win or lose by rule priority. Untested with any other extension installed. |
| Redirects across domains may not extend the session's domain set | silent | assumed | The domain set grows from observed cookies and the host of each captured response. An SSO hop that sets nothing may not register. |

## Product and operational

| Limit | Shown | Status | Impact |
|---|---|---|---|
| Every site needs a manual permission click | n/a | by design | `chrome.permissions.request` opens Chrome's own dialog and must come from a click in the popup. Cannot be automated — and a headless attempt hangs silently rather than failing. |
| Storage capture runs every 15 seconds | silent | verified | Plus on page load, before unbind, and before a tab moves to another session. A browser crash can lose up to one interval of a session's page storage. |
| A new session starts signed out, and that reads as broken | n/a | verified | An empty session must strip the browser's cookies or the tab inherits the existing login. Users read this as a button that did nothing. Mitigated with an "Empty" chip, an explanation, and a badge reading "sign in to save" — but it remains the product's sharpest edge. |
| Moving a tab between sessions reloads it | n/a | verified | The tab bounces through `about:blank` to force a real document load, because a same-URL change is a fragment navigation and the page shim would never re-run. In-page state is lost. |
| Restore reloads the tab | n/a | verified | The saved slice is injected and the tab reloaded so the app boots with its tokens. Scroll position, open dialogs and unsent forms are lost. |
| Chrome only | n/a | verified | Firefox has a first-class containers API and would need a different engine; Safari's `declarativeNetRequest` cannot modify the `Cookie` header at all. |
| Incognito is untested | silent | assumed | Never run in an incognito window. Chrome keeps a separate cookie store there, so behaviour is unknown. |
| Multiple windows are untested | silent | assumed | Bindings are per tab id and should be window-agnostic, but no run has used two windows. |
| Not published to the Chrome Web Store | n/a | verified | Load-unpacked only. Store review would likely question the broad optional host permission. |
| No automated test of the grant flow | n/a | verified | The end-to-end suites pre-grant the origin in the built manifest, because Chrome's permission dialog needs a human click. The button itself is only manually verified. |
| A code path only real data reaches is a path no test covers | n/a | verified | The data migration only runs when old data exists, so fresh-profile runs never entered it — and a bug inside it killed the worker on a real upgrade. Now covered, but the shape generalises: seed the state a path needs, or it is untested. |
| Headless runs start the worker once; real reloads do not | n/a | verified | Reloading at `chrome://extensions` runs the worker module *and* fires `onInstalled`, so two boots race. That produced a duplicate-registration error no headless run could reproduce. Now covered, but a single-start harness cannot see restart-shaped bugs in general. |

## What would fix the big three

**Service-worker bypass — needs a different engine.** No extension API attributes a service worker's fetch to a tab. The two real options are the `chrome.debugger` engine (`Fetch.continueRequest` sees every request, at the cost of a visible infobar) or a native host driving real browser contexts.

**IndexedDB — namespace the database name.** The shim already intercepts `indexedDB.open`. Rewriting the database name to `<sessionId>::<name>` is the same trick as the `localStorage` prefix; the work is in `deleteDatabase`, `databases()` and the version-change paths, plus proving it against a real app that stores auth there.

**Cross-origin iframes — the marker has to reach the child.** The session id would have to travel on something a cross-origin child can read. Nothing currently does. Worth measuring how often auth actually lives in such a frame before building for it.

## Deliberately not doing

Decisions, not gaps, recorded so they are not re-litigated:

- **Fingerprint spoofing, proxy per session, ban evasion.** This is a developer tool for testing your own apps. That entire category is what anti-detect browsers sell, and competing there would change the product.
- **Cloud sync of sessions.** Sessions hold live credentials. They stay on the machine.
- **Isolating tabs you did not ask to isolate.** An unbound tab must behave exactly like an ordinary tab — the shim returns immediately when no session marker is present, so the extension's presence is not observable on ordinary pages.
