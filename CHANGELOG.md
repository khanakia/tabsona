# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The in-page persona badge can be moved, shrunk and switched off.** It now sits bottom-left by default (top-right covered apps' header buttons), a click shrinks it to a dot and back, and Options → Settings has "Show the persona badge on pages" and a corner picker. Changes apply to open tabs immediately.
- **Drag the badge anywhere.** The spot is remembered per site (apps put their buttons in different places) and survives reloads; double-click puts it back in the corner, and Options can reset every site at once.
- **Pick each persona's colour** from nine swatches — one per Chrome tab-group colour, so the badge, the popup dot and the tab group always match. Open tabs and their tab group recolour immediately.
- **Page titles carry the persona's colour** as a heart in front of the title (`💙 Dashboard`), kept in place when the app changes its title; switchable in Options.

### Fixed

- A persona's description, and a saved login's page title, are cut off to fit the popup; hovering (or tabbing to) a cut-off line now opens a card with the whole text. Lines that fit stay quiet.
- Session rows show the full site address (`ifpghub.localhost:3000`) on its own line; the page title moved to the line below, where it is the part that gets cut off. Persona names likewise get the whole first line, with the site and tab counts underneath.

## [0.2.0] - 2026-10-04

### Added

- **IndexedDB kept per persona.** The page shim translates database names to `<session>::<name>` (`open`, `deleteDatabase`, `databases()`, `IDBDatabase.name`), so offline-first apps keep separate data per persona. Databases opened inside a worker stay shared and the badge reports it.
- **A popup that explains itself.** Every button shows what it will do and what it does to your normal browser login, on hover or keyboard focus. "Add to persona" asks how (signed out, move or copy) before which persona, footer actions carry words instead of bare icons, and a three-step guide appears until the first persona exists.
- **Styled confirmations** before deleting a persona, forgetting a login or replacing a saved login, and a confirmation line after actions that are otherwise silent.
- **Storage lab** fixture apps (cookie, localStorage and IndexedDB logins) with an end-to-end suite and a plain-tab control per layer.

### Fixed

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
