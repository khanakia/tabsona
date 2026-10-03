# tabsona

A Chrome extension that gives **each tab its own login session**, grouped into **personas** — a named identity across a set of apps. Open a persona and every site in it opens as a tab, already signed in.

Status: **shipped and gated.** `task check` is the real gate — type-check, unit tests, a build, and nine end-to-end suites driving the built extension in a real Chrome. Read [`docs/how-it-works.md`](docs/how-it-works.md) before changing anything in `src/engine/` or `src/content/`.

## Who this is for

A developer testing their **own** apps across many roles and tenants, mostly on `localhost` and staging. That audience is why this is viable where consumer multi-login extensions are not: anti-detect concerns are out of scope, and UX costs a consumer product could never pay are acceptable here.

Out of scope, permanently: fingerprint spoofing, proxy-per-session, ban evasion, cloud sync of credentials.

## Hard-won facts about Chrome that constrain every design

Do not re-derive these, and do not build a design that ignores one.

- **Chrome has no per-tab cookie store.** `chrome.cookies` `storeId` maps to profile + incognito, giving exactly two jars. Firefox's `contextualIdentities` has no Chrome equivalent.
- **Blocking `webRequest` is gone in MV3, but observational `webRequest` is not.** `onHeadersReceived` registered non-blocking with `['responseHeaders', 'extraHeaders']` still delivers the raw `Set-Cookie` string — **HttpOnly included** — attributed to the exact `details.tabId`. Easy to assume it died with blocking webRequest. It did not, and it is the read half of the engine.
- **`declarativeNetRequest` can `set` or `remove` a header but cannot read one, and cannot patch one.** You reconstruct the whole value or you do nothing. Header modification needs host permissions, and a lower-priority rule loses silently to any matching `allow` rule.
- **`tabIds` conditions only work on session-scoped DNR rules** (`updateSessionRules`) — not static, not dynamic. Per-tab targeting lives there or nowhere.
- **DNR must also strip `Set-Cookie` on the response for bound tabs.** Without it, signing into a session tab also signs the whole browser in, and a plain tab silently becomes whoever the persona just signed in as.
- **`chrome.cookies.getAll` returns `[]` for every filter shape on Chrome 154**, while `chrome.cookies.get({url, name})` returns the same cookie with its HttpOnly flag. Cookies cannot be enumerated; they can be looked up by name. Any assertion built on `getAll` passes whether or not the jar was cleared.
- **A cookie records no port.** Removing via `http://${domain}${path}` yields `http://localhost/`, which does not address a cookie stored for `localhost:8787`. Chrome reports no error and the cookie survives. Build removal URLs from the tab's real origin and confirm with `chrome.cookies.get`.
- **`localStorage`, `IndexedDB` and `CacheStorage` are engine-partitioned per origin with no extension hook to re-partition per tab.** Any isolation there is a shim, and a shim has blind spots. Enumerate them; never claim coverage you have not observed.
- **`sessionStorage` is already per-tab, for free.** Apps keeping their token there need no machinery.
- **A service worker's own fetches carry no tab id**, so they match no per-tab rule and hit the shared jar. Unfixable inside the extension model — detect and surface it, never hide it.
- **Three channels re-sync login state across same-origin tabs behind your back:** `storage` events, `BroadcastChannel`, and `SharedWorker`. Isolating cookies and `localStorage` without neutralising all three means one tab's refresh flips another tab's user.
- **Scope `webRequest` listeners to granted hosts, never `<all_urls>`.** With optional host permissions the broad form logs one warning and then never fires — a silent failure.
- **The MV3 service worker is torn down at will, and several events boot it at once.** Reloading at `chrome://extensions` runs the module body *and* fires `onInstalled`. Every read-then-write chrome API (`registerContentScripts`, `updateSessionRules`) must be serialized, and `registerContentScripts` additionally needs catch-and-retry, because a previous worker generation can write between your read and your write.
- **Never use a dynamic `await import()` in the worker.** Vite wraps it in a preload helper that calls `window.dispatchEvent`, and a service worker has no `window`. Keep `build.modulePreload: false`.
- **The shipped manifest declares no host permissions at all.** Every origin is granted at runtime through Chrome's own prompt. The fixture origin that the end-to-end suites need is injected into the *built* manifest by `task grant`, never into the source — a development origin in a published manifest is both a review finding and a permission the user never agreed to. `task preflight` fails if one reappears.
- **Chrome 154 silently ignores `--load-extension`.** Load unpacked via the CDP `Extensions.loadUnpacked` command instead; `task probe:load` re-checks this if a future Chrome changes it.

## Project rules

1. **Never ship an isolation claim that has not been observed failing.** Every mechanism gets a test that breaks it deliberately and watches the leak appear. Every suite that claims isolation also runs a **control** with no extension, asserting the tabs do collide.
2. **Degradation is surfaced in the page, never swallowed.** If a layer is known-leaky for an origin, the badge says so. A tool that looks isolated while leaking turns every later bug into a question about whether the tool lied.
3. **Behaviour over API readings.** Verify the shared jar by opening an un-isolated tab and asking the *server* who it is — not by reading `chrome.cookies.getAll`.
4. **The isolation engine lives behind one interface**, selectable per session, swappable without touching the UI.
5. **A cookie's identity is `(name, domain, path, partitionKey)`.** Treating it as `(name, value)` is a bug.
6. **No state in the worker's memory.** It lives in `chrome.storage` behind the lock in `engine/repo.ts`.
7. **Test apps belong in the repo.** `spike/fixture/` is a permanent asset — it is the only way the isolation tests stay honest.

## Code standards

Enforced, not aspirational — see `CONTRIBUTING.md` and `src/core/__tests__/boundaries.test.ts`.

- Full type safety. No `any`, `as any`, `@ts-ignore`, or non-null assertions used to dodge a check. A boundary cast is allowed only where the type system cannot express the contract, and carries a comment saying why.
- No bare closed-set literals or magic numbers — named constants in `core/constants.ts`, or a discriminated union.
- Every exported symbol carries a doc comment stating **why** it exists and any invariant callers must respect.
- Layering is asserted by a test over the source: `domain/` imports nothing · `core/` never names a chrome API · exactly one UI module does · presenters never import the client · surfaces never deep-import past a barrel.
- A presenter's test needs **no module mocks**. If one reaches for `vi.mock`, the component is fused and gets split.

## Commands

`task --list` is the index. The ones that matter: `task build`, `task test`, `task check` (the gate), `task package` (a Chrome Web Store upload — runs `task preflight`, which fails the pack on any Store hard requirement), `task e2e:app` (against a real app, credentials from the environment), `task probe:app` (find where an app keeps its login).

## Where things live

- `apps/extension/src/{domain,core,engine,app,features,ui,surfaces,content}` — see `docs/how-it-works.md` for what each layer may import.
- `spike/` — the end-to-end drivers and the two-role fixture app.
- `docs/` — public documentation: `how-it-works.md`, `limits.md`.
- `docsi/` — internal design notes, spike results and decision history. **Local only, git-ignored** — it records every wrong turn and is not published.
