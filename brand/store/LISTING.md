# Chrome Web Store listing

Copy for the developer dashboard. Keep this in step with the manifest — the Store takes the item name straight from `manifest.name`.

## Name (from `manifest.name`, max 75)

```
Tabsona — multi-account tabs & saved logins
```

43 characters; roughly 45 are visible in search results, so nothing is truncated.

## Summary (from `manifest.description`, max 132)

```
Give each tab its own login. Save a set of signed-in sites as a persona and reopen the whole set in one click.
```

110 characters.

## Category

Developer Tools. Deliberately not Productivity: the audience is developers testing their own applications, and the category sets the expectation reviewers read the listing against.

## Description

```
Testing six roles across your own apps means six Chrome profiles, six windows, or six browsers. Tabsona gives each tab its own login instead.

A PERSONA is who you are across a set of apps — admin, tenant-A, staging. It holds one saved login per site. Click Open all and the whole scenario opens: three tabs, three apps, the right identity in each, grouped in a Chrome tab group.

WHAT IT DOES
• Each tab keeps its own cookies and its own page storage
• Save a login and reopen it later — sessions outlive their tabs
• Open a whole persona in one click
• Two accounts on one site, live at the same time
• Duplicate a persona, logins included, to spin up another tenant
• Export and import personas

WHY IT IS DIFFERENT
Most multi-login extensions isolate cookies only, so the moment an app keeps its token in localStorage — which most modern apps do — both tabs show the same user and nothing tells you. Tabsona isolates page storage too, and when it cannot fully isolate a site it SAYS SO on the tab rather than letting you assume.

Isolation is not all-or-nothing. A service worker, an IndexedDB token or a cross-origin frame can defeat it on a given site. Tabsona measures what it actually achieved per site and shows it, because a tool that looks isolated while leaking is worse than no tool.

WHAT IT IS NOT
This is a developer tool for testing your own applications. It does not spoof your browser fingerprint, does not route traffic through proxies, and is not built for evading bans or platform rules. Every persona shares your real browser fingerprint.

PRIVACY
Everything stays on your machine in local extension storage. No server, no account, no telemetry, nothing is uploaded. Site access is granted one site at a time, by you, through Chrome's own permission prompt.

Open source: https://github.com/khanakia/tabsona
```

## Permission justifications

The dashboard asks for one line per permission. Vague answers are the most common cause of a rejection, so each names the exact feature it enables.

| Permission | Justification |
|---|---|
| `declarativeNetRequest` | Replaces the Cookie header on tabs the user has placed in a persona, so each tab sends its own saved login, and strips Set-Cookie from those responses so a persona's login does not leak into the browser's shared cookie jar. |
| `webRequest` | Read-only observation of response headers on user-approved sites, to capture the Set-Cookie a site issues into the persona that tab belongs to. No blocking and no modification is performed through this API. |
| `cookies` | Reads the cookies of a site the user explicitly chooses to save into a persona, and removes them from the browser's own jar when the user chooses Move rather than Copy. |
| `storage` | Stores personas, saved sessions and settings locally. Nothing is transmitted. |
| `tabs` | Maps each tab to the persona it belongs to and opens a persona's sites as tabs. |
| `scripting` | Injects the storage isolation script and the in-page badge on sites the user has approved. |
| `webNavigation` | Detects a tab opened from a link inside a persona's tab, so it stays in that persona instead of falling back to the shared login. |
| `tabGroups` | Places the tabs opened from one persona into a named Chrome tab group. |
| `host_permissions` (optional, `*://*/*`) | Requested per site, at runtime, only when the user presses "Allow this site". No site is accessed until they do. |

## Assets

| File | Where it goes |
|---|---|
| `../../apps/extension/icons/icon128.png` | Store icon |
| `small-promo-440x280.png` | Small promo tile |
| `marquee-1400x560.png` | Marquee (only shown if featured) |
| `screenshot-1-popup.png` | Screenshot 1 — the library and what each session holds |
| `screenshot-2-library.png` | Screenshot 2 — the full options page |
| `screenshot-3-sites.png` | Screenshot 3 — site access and settings |

Screenshots are captured from the real built extension by `task screenshots`; the surrounding frame is staged, every pixel inside it is the product.

## Before submitting

- The repo is public, so the "Open source" link in the description resolves.
- A privacy policy URL is required because the extension handles user data. The Privacy section above states the position; it needs a hosted page.
- Single purpose statement: "Isolate and manage multiple logins per tab for the sites the user chooses."
