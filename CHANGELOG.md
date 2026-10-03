# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Fixed

- Saving a login now **moves** it out of the browser's shared jar by default. A copy left one server-side session shared between the browser and the persona, so signing out anywhere invalidated it everywhere.
- Signing into a session tab no longer signs the whole browser in — `Set-Cookie` is stripped from responses on bound tabs.
- A blank new tab no longer joins a persona. Session inheritance now listens to `webNavigation.onCreatedNavigationTarget`, which fires only for a tab opened from a link.
- Concurrent service-worker boots no longer produce `Duplicate script ID`, and concurrent rule syncs no longer collide.
- The published manifest no longer requests `http://localhost:8787/*`. The fixture origin had been baked in for the end-to-end suites; each suite now grants it into the *built* manifest instead, and the preflight gate fails if a development origin ever reappears.
- The storage shim's `length` descriptor is configurable, so `Object.keys(localStorage)` no longer throws inside an isolated page.
