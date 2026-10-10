# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-10-10

### Fixed

- **Google's "Cookies are disabled" inside a persona.** A script's `document.cookie` now belongs to the persona: a write is stored in the session (not the browser's shared jar) and a read returns the persona's own cookies, so a provider's test-cookie check passes. A `fetch` or XHR sent right after a cookie write, or right after a response that set one, now waits until that cookie is in force instead of leaving without it. Still not covered: a navigation started straight after a cookie is set, and a cookie set on a redirect (see `docs/limits.md`). New relay content script (`relay.js`) carries the page's cookie writes and the form-POST notice from `document_start` in every frame.
- **Allowing a website after a form was stopped no longer sends it a request with every parameter missing.** The sign-in gate resumed a stopped form POST as a plain visit to its address, so a provider such as Google answered "Required parameter is missing: response_type". A stopped form is now recognised, the gate page says it cannot be resent, and **Allow and go back** returns the tab to the page holding the form so you press its button again; **Open in a normal tab** is not offered for it, since it would fail the same way. A stopped link still resumes to the byte-identical address. The ordinary tab that **Open in a normal tab** creates is also taken out of the persona's tab group.
- **A page with no title no longer shows the persona marker twice** ("💚 💚") until the app sets one. The browser trims `document.title`, so the marker written with its trailing space read back without it and was added again; marking now recognises the bare marker and an empty title becomes the marker alone.
- **Tabs opened one at a time join the persona's tab group again.** Opening one session, adding a site, "another login", "use this tab" and moving a login now put the tab in its persona's Chrome tab group, joining the group already open in that window instead of leaving the tab loose (only Open all grouped before). A failure to group is now logged instead of silently ignored.
- **A persona tab no longer quietly signs in as your normal browser user through a sign-in website Tabsona is not allowed on.** Apps that sign in through another website (AuthKit, Google, Okta) sent a fresh, signed-out persona tab to that provider with your browser's own login there, so it came straight back as you: forgetting a login and adding the site again still opened as the browser's admin. Chrome applies Tabsona's rules only on websites you have allowed, so this cannot be fixed silently; instead Tabsona now says so where it cannot be missed. A sign-in is usually a chain of websites (for AuthKit: `api.workos.com`, then the custom auth domain, then `*.authkit.app`), and every one of them is now listed under the app that started it, so allowing the first no longer hides the rest. While any open persona tab signs in through a website that is not allowed, the popup shows a red alert pinned to the top that stays until they are allowed, plus a **Sign-in websites to allow** section with an **Allow** per website and an **Allow all** that asks Chrome once for every one; the toolbar icon shows `!`; and the in-page badge reports the leak. Allowing only grants access: it never opens a tab or adds anything to a persona. Hovering "not separated" explains what it means. Once the whole chain is allowed, each persona signs in as its own user there too.
- **Forgetting a login, or deleting its persona, while a tab is open now releases that tab properly.** It reloads on your normal browser login with the forgotten login's page data removed, instead of staying half in a persona that no longer exists: sending your browser's cookies while still reading the old login's saved page data. "Leave persona" releases the tab the same way, keeping the persona's login.

### Added

- **Use my normal login on chosen websites, so Google sign-in works inside a persona.** Google sets its flow cookie on a redirect and refreshes its login from inside the browser, so no per-tab rule can keep it separate; instead a persona tab now reaches the websites on a new list with the browser's own login, while the app's own login stays per persona. Where you choose it: the question page a persona tab shows when it is stopped at a Google website offers **Use my normal Google login here** (it adds `accounts.google.com` and `accounts.youtube.com` and carries on to where the tab was going; a stopped form goes back to the form like any other); the popup's sign-in alert offers the same; and **Settings → Use my normal login on** lists the websites with Add and Remove, a one-click **Restore default sites**, and a box for any other website (a country domain such as `accounts.google.co.in`). Nothing is on the list until you add it, and there is no new permission or banner. A listed website is never reported as a leak: no sign-in alert, no warning, nothing saved from it, and the badge on it says **uses your normal login (your choice)** in blue, never "isolated" (new help ⓘ in Settings and on the badge explains the trade-off: the website sees your browser's login, shared with your other tabs). Under the hood it is one tab-scoped `allow` rule per listed website above every cookie rule and the gate, plus the persona's storage and cookie shims not running there. The complete rule priority order is pinned by a unit test and documented in `docs/how-it-works.md`.
- **A persona tab now stops before it visits a website Tabsona is not allowed on, and asks in place.** Without "Allow on all sites", a sign-in that passed through other websites used to carry your normal browser login to them, come back as you, and only then raise an alert one website at a time. Now the tab is stopped before anything is sent and shows a page: "*app* signs you in through *host*" with **Allow and continue** (resumes at the exact url), **Allow on all sites** and **Open in a normal tab**; a link to an unrelated website gets the same question. Only persona tabs are ever stopped, and not at all while all sites is allowed. A sign-in chain you have seen is remembered per site and asked for in one prompt. If a login still slipped through a website that could not be guarded, it is not saved: the persona is marked "signed in through an unprotected website" with **Start over signed out**.
- **Allow on all sites, asked once.** A first install opens the library on a welcome that asks "Let Tabsona keep logins separate on every website?" with **Allow on all sites** (one Chrome prompt for every website) or **I'll choose sites myself** (remembered, so it is not asked again). The same choice is a permanent row in **Settings → Websites**, with Allow and Remove, and a one-line suggestion under the popup's sign-in alert. With it on, a persona whose sign-in passes through other websites (a WorkOS chain went through four) opens signed out and is separated end to end with no prompt per host. The trade-off is stated before the click: a persona tab then sends your normal login to no website at all, so a Google or GitHub page it reaches starts signed out there; tabs outside a persona are unchanged. The manifest is unchanged: `*://*/*` was already the optional host permission, and nothing is granted until you confirm Chrome's prompt.
- **Allow a website without adding it to a persona.** Library → Sites has an **Allow a website** box: type a host or URL and Chrome asks for access, and nothing opens. Meant for the sign-in websites a persona's site redirects through.

### Changed

- **Settings is a page of cards with a section list on the left.** Websites, Use my normal login on, Badge on pages, Page titles and Tabs are each a card with a title, a one-line description and its ⓘ; the list on the left jumps to a card and follows the scroll, and collapses to chips along the top on a narrow window (under 640px). `#settings/badge` (any card name) opens that card directly; `#settings` works as before. Text and controls use the page's standard 12px size throughout: the "Use my normal login on" card had been set larger than the rest.
- **"Restore default sites" is always there.** The card shows Tabsona's default sign-in sites (`accounts.google.com`, `accounts.youtube.com`) with whether each is on your list, and the button, renamed from "Add Google's sign-in sites", re-adds only the ones you removed; with all present it stays visible but disabled and says so. The list still starts empty on a fresh install, so nothing is switched on without a click.
- **The library's Sites list shows an every-website grant as "All websites"**, first, instead of a raw pattern, and its header says "allowed on every website".
- **Hover cards are bigger and easier to read.** The full-text card shown on a truncated line is wider, set in 13px with more padding, and never wider than the window.
- **Known limit documented: signing in with Google inside a persona.** Google sets its flow cookie on a redirect, which an extension cannot carry onto the redirect's follow-up, so its sign-in can end on "Something went wrong" or "Cookies are disabled". `docs/limits.md` says so and gives the workaround (email and password, or a normal tab for the Google step); letting identity-provider hosts use the browser's own login is planned (now shipped, see Added).
- **The tab-group setting is reworded** to "Open tabs in a tab group": on, every tab a persona opens joins one group per persona; off, tabs open individually. It is the one switch for every way of opening, and its ⓘ help says so.

## [0.3.0] - 2026-10-07

### Added

- **Settings have their own tab**, opened straight from the popup's ⚙ button (a separate library button opens the persona list). They used to sit at the bottom of "Sites", where nobody looked.
- **Badge style:** show the persona's name or just a coloured dot by default; clicking the badge on a page still switches between the two.
- **A live badge preview** at the top of Settings: your persona's badge on a mock page, in the chosen corner and style; click it to shrink it, and "Replay hide" shows auto-hide play out. It shares one definition of the badge's look with the real one, so the two cannot drift.
- **ⓘ help on every section** of the library page (Personas, Sites, Settings groups, Coverage, Data): rest on it or tab to it for what that part is for and what it does to your logins.
- **Auto-hide the badge** after a number of seconds you choose (1–60, default 5). It stays while the pointer is on it; the title marker and toolbar icon keep saying whose tab it is.

- **About links:** the library page's footer and the popup's guide link to khanakia.com, the help pages and the issue tracker; the extension's homepage (shown on Chrome's extension details page) is now khanakia.com/apps.

### Changed

- The badge's default corner is now **bottom-right**. A corner you already picked is kept.

### Fixed

- The end-to-end harness dropped the `#fragment` of any URL it opened, so a page opened at `…#settings` arrived without it.

## [0.2.0] - 2026-10-04

### Added

- **The in-page persona badge can be moved, shrunk and switched off.** It now sits bottom-left by default (top-right covered apps' header buttons), a click shrinks it to a dot and back, and Options → Settings has "Show the persona badge on pages" and a corner picker. Changes apply to open tabs immediately.
- **Drag the badge anywhere.** The spot is remembered per site (apps put their buttons in different places) and survives reloads; double-click puts it back in the corner, and Options can reset every site at once.
- **Pick each persona's colour** from nine swatches — one per Chrome tab-group colour, so the badge, the popup dot and the tab group always match. Open tabs and their tab group recolour immediately.
- **Page titles carry the persona's colour** as a heart in front of the title (`💙 Dashboard`), kept in place when the app changes its title; switchable in Options.
- **IndexedDB kept per persona.** The page shim translates database names to `<session>::<name>` (`open`, `deleteDatabase`, `databases()`, `IDBDatabase.name`), so offline-first apps keep separate data per persona. Databases opened inside a worker stay shared and the badge reports it.
- **A popup that explains itself.** Every button shows what it will do and what it does to your normal browser login, on hover or keyboard focus. "Add to persona" asks how (signed out, move or copy) before which persona, footer actions carry words instead of bare icons, and a three-step guide appears until the first persona exists.
- **Styled confirmations** before deleting a persona, forgetting a login or replacing a saved login, and a confirmation line after actions that are otherwise silent.
- **Storage lab** fixture apps (cookie, localStorage and IndexedDB logins) with an end-to-end suite and a plain-tab control per layer.

### Fixed

- A persona's description, and a saved login's page title, are cut off to fit the popup; hovering (or tabbing to) a cut-off line now opens a card with the whole text. Lines that fit stay quiet.
- Session rows show the full site address (`ifpghub.localhost:3000`) on its own line; the page title moved to the line below, where it is the part that gets cut off. Persona names likewise get the whole first line, with the site and tab counts underneath.
- Opening a persona on an app that redirects signed-out users (AuthKit, OAuth) no longer lands on its login page. Cookie rules were computed from the URL the tab was on, which is `about:blank` when it is bound, so the first request left without the cookie.
- A persona's cookies are no longer sent to every host its page loads. Rules are now scoped per host and cookie path, and hosts the persona holds nothing for receive no cookie at all.
- "Add website" now adds the address you typed; the popup used the current tab's site instead and the library page did nothing.

## [0.1.0] - 2026-10-03

### Added

- **Personas** — a named identity across a set of apps, holding at most one saved login per site. Opening a persona opens every site as a tab, each signed in, grouped in a native Chrome tab group.
- **Per-tab cookie isolation** via `declarativeNetRequest` session rules, with capture through observational `webRequest` so HttpOnly cookies are seen.
- **Per-session page-storage isolation** — a MAIN-world shim namespaces `localStorage` by session id, which is what makes save and restore possible.
- **Four ways to build a session** — add a site by URL, use the current tab with a blank session, or move/copy the login you are already using.
- **Honest coverage reporting** — the badge states which layers are actually isolated on each origin, from observations rather than intentions.
- **Save, restore and duplicate** sessions, with cookie identity preserved (`name`, `domain`, `path`, `partitionKey`).
- **Options page** — full library, allowed sites, per-origin coverage report, export and import.
- End-to-end suites driving the built extension in a real Chrome, each with a control run proving the scenario collides without the extension.
- **Chrome Web Store packaging** — `task package` builds, validates and zips an upload, and `task preflight` fails the pack on any Store hard requirement: a development host permission in the manifest, an over-length field, a bad version, a `key`/`update_url`, a manifest reference to a missing file, an icon whose real PNG size disagrees with its declared size, remotely hosted code, or an over-size package.
- **Privacy policy and project site** at `docs/`, served by GitHub Pages, so the policy lives with the code that implements it.
- **Secret scanning.** A `.githooks/pre-commit` guard runs gitleaks on the staged diff and refuses compiled binaries and `.env` files; it fails closed when gitleaks is missing. `task secrets:scan` audits the full history and is the first step of `task check`. Activate per clone with `task hooks:install`.
- **Chrome Web Store client** — `task cws:auth`, `cws:create`, `cws:upload`, `cws:status`, `cws:publish`, on plain `fetch` with no third-party CLI. Its `.env` handling and upload polling are unit-tested.
- **Screenshots** — five frames captured from the real built extension, at both sizes the Store accepts (1280×800 and 640×400), shown in the README.

### Fixed

- Saving a login now **moves** it out of the browser's shared jar by default. A copy left one server-side session shared between the browser and the persona, so signing out anywhere invalidated it everywhere.
- Signing into a session tab no longer signs the whole browser in — `Set-Cookie` is stripped from responses on bound tabs.
- A blank new tab no longer joins a persona. Session inheritance now listens to `webNavigation.onCreatedNavigationTarget`, which fires only for a tab opened from a link.
- Concurrent service-worker boots no longer produce `Duplicate script ID`, and concurrent rule syncs no longer collide.
- The published manifest no longer requests `http://localhost:8787/*`. The fixture origin had been baked in for the end-to-end suites; each suite now grants it into the *built* manifest instead, and the preflight gate fails if a development origin ever reappears.
- The storage shim's `length` descriptor is configurable, so `Object.keys(localStorage)` no longer throws inside an isolated page.
