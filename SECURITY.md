# Security policy

## What this extension holds

Tabsona stores **live credentials** — session cookies (including HttpOnly ones) and page-storage tokens — in `chrome.storage.local`, on your machine. Nothing is sent anywhere. There is no server, no telemetry, and no sync.

An **export file contains those credentials in plain text**. Treat it like a password file.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/khanakia/tabsona/security/advisories/new) on this repository. Please do not open a public issue for a vulnerability.

Include the class of problem, the conditions needed to reach it, and what an attacker gains. A clear description of the weakness is more useful than a working exploit, and safer to transmit.

I will acknowledge within a week and tell you plainly whether I can fix it — some limitations below are inherent to the Chrome extension model and cannot be.

## Known limitations, by design

These are not vulnerabilities to report; they are documented holes the extension surfaces on its own badge. The complete list, with each entry marked verified-in-code or merely assumed, is in [`docs/limits.md`](docs/limits.md).

- **Service-worker fetches bypass isolation.** They carry no tab id, so they match no per-tab rule and reach the shared cookie jar. No extension API can attribute them to a tab.
- **IndexedDB is detected, not isolated.** An app keeping auth there will cross-contaminate between sessions.
- **Cross-origin iframes** cannot learn which session they belong to.
- **Browser fingerprint is identical across personas.** This is a developer tool for testing your own applications. Fingerprint spoofing, proxy-per-session and ban evasion are explicitly out of scope — if you need those, you need a different category of product.

## Scope

In scope: anything that causes one persona's credentials to reach another persona, or to leak off the machine; anything that lets a web page read or influence stored sessions; privilege issues in the extension's own messaging surface.

Out of scope: the documented limitations above, and attacks that require the user to install a malicious extension or hand over their export file.
