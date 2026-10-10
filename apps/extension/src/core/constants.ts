// Named constants for every closed-set value and magic number. A bare string or a
// literal number in logic is a defect: it cannot be renamed safely, cannot be grepped
// with confidence, and carries no why.

import type { RuleResourceType } from '@/domain/types';

/** Carrier key AND url-hash marker telling a page which session its tab is. */
export const SESSION_MARKER = '__tabsona';

/** Separates the session id from the app's key inside a namespaced storage key. */
export const NAMESPACE_SEPARATOR = '::';

/** Id prefixes. Distinct so an id is recognisable on sight in storage and in logs, and
 *  so a persona id can never be mistaken for a session id while debugging. */
export const PERSONA_ID_PREFIX = 'p_';
export const SESSION_ID_PREFIX = 's_';

/**
 * Resource types a per-tab cookie rule must cover.
 *
 * `main_frame`/`sub_frame` carry navigations; `xmlhttprequest` carries the app's API
 * calls, where auth usually matters most; `websocket` and `other` catch the rest.
 * Omitting any one leaks the shared jar through that channel.
 */
export const RULE_RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'xmlhttprequest', 'websocket', 'other',
] as const satisfies readonly RuleResourceType[];

/**
 * Response types worth harvesting Set-Cookie from.
 *
 * Deliberately NOT every type: harvesting broadly causes session churn that breaks
 * CSRF tokens, which is why the prior art narrowed to navigations plus XHR.
 */
export const CAPTURE_RESOURCE_TYPES = ['main_frame', 'xmlhttprequest'] as const;

/** Rule ids live in a reserved band so they cannot collide with any rule this
 *  extension might add later. Ids are assigned sequentially from here on every sync;
 *  nothing may rely on a rule keeping its id across syncs. */
export const RULE_ID_BASE = 1_000;

/**
 * Priority layering of a bound tab's rules.
 *
 * Within one extension, once a higher-priority `modifyHeaders` rule has edited a header,
 * lower-priority rules cannot touch it. So each tab gets a priority-1 STRIP rule that
 * removes `Cookie` from every request, and higher-priority rules that set the session's
 * cookies for the hosts that own them. A host the session holds nothing for falls
 * through to the strip, so neither the shared jar nor another host's cookies ever
 * reach it.
 *
 * Priority = tier × TIER_SPAN + host labels × LABEL_SPAN + path length (capped), so an
 * exact-host rule always beats a parent-domain rule, a deeper domain beats a shallower
 * one, and a longer cookie path beats a shorter one, which is the precedence a browser
 * applies when it picks cookies.
 */
export const STRIP_RULE_PRIORITY = 3;
/** Parent-domain rules: a `Domain=` cookie reaching a subdomain the session never visited. */
export const DOMAIN_RULE_TIER = 1;
/** Exact-host rules: everything the session holds for that host. */
export const HOST_RULE_TIER = 2;
/** Larger than any LABEL_SPAN term (a hostname has at most 127 labels). */
export const PRIORITY_TIER_SPAN = 1_000_000;
/** Larger than the capped path term. */
export const PRIORITY_LABEL_SPAN = 1_000;
/** Cap on the path term, so a pathological cookie path cannot spill into the label term. */
export const MAX_PATH_PRIORITY = PRIORITY_LABEL_SPAN - 1;

/** The schemes a cookie rule is generated for. Both, because `Secure` cookies may go
 *  only over https (except on localhost), so the header can differ per scheme. */
export const RULE_SCHEMES = ['http', 'https'] as const;

/** Measured: without confirming the rule before navigating, isolation failed one run
 *  in three, because a first request that leaves rule-less rides the shared jar. */
export const RULE_CONFIRM_TIMEOUT_MS = 5_000;
/** Polled tightly: every millisecond here delays a tab the user is waiting on. */
export const RULE_CONFIRM_POLL_MS = 25;

/** A crash loses at most this much of a session's page storage. */
export const STORAGE_CAPTURE_INTERVAL_MS = 15_000;

/** How long to wait for the page shim to appear before giving up on a restore. */
export const SHIM_WAIT_TIMEOUT_MS = 6_000;
export const SHIM_WAIT_POLL_MS = 100;


/**
 * chrome.storage keys.
 *
 * `BINDINGS` lives in `chrome.storage.session` (lifetime of the browser run, because a
 * tab id means nothing after a restart); the rest live in `chrome.storage.local` and
 * must survive one. Changing any of these strings orphans existing user data — migrate
 * instead, the way `migrateFromV1` does.
 */
export const STORAGE_KEY_PERSONAS = 'personas';
export const STORAGE_KEY_SESSIONS = 'sessions';
export const STORAGE_KEY_SETTINGS = 'settings';
export const STORAGE_KEY_BINDINGS = 'bindings';
/** Set once the v1 → v2 migration has run, so it never runs twice. */
export const STORAGE_KEY_SCHEMA = 'schemaVersion';
/** Dragged badge positions by site. Its own key, not part of settings: it grows with
 *  every site a badge is dragged on, and settings stay a small fixed shape. */
export const STORAGE_KEY_BADGE_PLACEMENTS = 'badgePlacements';
/**
 * Sign-in hosts seen per site (core/signin.ts), in `chrome.storage.local`: the chain an
 * app signs in through is a fact about the app, not about this browser run, and keeping
 * it is what lets the gate page ask for EVERY host of a known chain in one prompt the
 * next time any persona opens that site, instead of one prompt per hop. Replaces the
 * run-scoped `signInHops` key of 0.3, which a browser restart cleared.
 */
export const STORAGE_KEY_SIGNIN_CHAINS = 'signInChains';
/** Navigations the gate stopped, by tab id (core/gate.ts, `GatePending`). In
 *  `chrome.storage.session`: a tab id means nothing after a restart, but the gate page
 *  must still find its record after a worker teardown or a reload of the page. */
export const STORAGE_KEY_GATE_PENDING = 'gatePending';
/** The last form POST each bound tab submitted, by tab id (core/gate.ts, `FormHint`).
 *  Session-scoped like the other per-tab records. Holds the form's target url and method
 *  only, never its fields: those can be a password. */
export const STORAGE_KEY_FORM_HINTS = 'formHints';
/** How long after a form POST a blocked navigation to its action still counts as that
 *  POST. A click-to-block takes milliseconds; the margin covers a worker that has to wake
 *  up to receive the notice, and stays short enough that a later, unrelated stop on the
 *  same path is not mistaken for it. */
export const FORM_HINT_MAX_AGE_MS = 15_000;
/** The form method the gate cannot replay (`HTMLFormElement.method`, lower-case). */
export const FORM_METHOD_POST = 'post';
/** The last http(s) page each bound tab committed, by tab id. Session-scoped like the
 *  bindings; read by "Open in a normal tab" to put the persona tab back where it was. */
export const STORAGE_KEY_LAST_PAGES = 'lastPages';
/** Open leak windows by tab id (core/gate.ts, `LeakWindows`). Session-scoped: a window
 *  is about one tab's sign-in in progress, and lasts minutes at most. */
export const STORAGE_KEY_LEAK_WINDOWS = 'leakWindows';
/** Bumped only when stored data needs converting. `migrateFromV1` reads it to decide
 *  whether it has already run, so it must never be lowered. */
export const SCHEMA_VERSION = 2;

/**
 * Every colour a persona can have — one entry per Chrome tab-group colour.
 *
 * Why a fixed palette rather than any colour: the persona's colour shows in four places
 * (popup dot, in-page badge, Chrome tab group, page-title marker) and the tab group
 * accepts only these nine names. A free colour picker would make the tab group a guess.
 *
 * Invariants: `hex` values are what is stored on a persona, so existing entries must
 * never change their hex (stored personas would stop matching); `emoji` is the title
 * marker — hearts, because they are the only emoji set with all nine colours (there is
 * no cyan, pink or grey square).
 */
export const PERSONA_PALETTE = [
  { id: 'blue', hex: '#3b82f6', emoji: '💙', label: 'Blue' },
  { id: 'green', hex: '#10b981', emoji: '💚', label: 'Green' },
  { id: 'yellow', hex: '#f59e0b', emoji: '💛', label: 'Yellow' },
  { id: 'red', hex: '#ef4444', emoji: '❤️', label: 'Red' },
  { id: 'purple', hex: '#8b5cf6', emoji: '💜', label: 'Purple' },
  { id: 'pink', hex: '#ec4899', emoji: '🩷', label: 'Pink' },
  { id: 'cyan', hex: '#14b8a6', emoji: '🩵', label: 'Cyan' },
  { id: 'orange', hex: '#f97316', emoji: '🧡', label: 'Orange' },
  { id: 'grey', hex: '#6b7280', emoji: '🩶', label: 'Grey' },
] as const;

/** One palette entry. */
export type PaletteEntry = (typeof PERSONA_PALETTE)[number];

/** Colours new personas cycle through, in order. Grey is left out: it reads as
 *  "disabled", so it is only ever a deliberate choice. */
export const PERSONA_COLORS = PERSONA_PALETTE.filter((c) => c.id !== 'grey').map((c) => c.hex);

/** How long to wait for a provoked request to reveal a tab's Cookie header when
 *  enumerating cookies is unavailable. See engine/import.ts for why that happens. */
export const COOKIE_PROBE_TIMEOUT_MS = 4_000;

/**
 * Hosts browsers treat as a secure context even over plain HTTP.
 *
 * Load-bearing for this project rather than a nicety: development happens on
 * `localhost` and `*.localhost`, and withholding `Secure` cookies there would make the
 * tool useless exactly where it is used most.
 */
export const SECURE_PROTOCOL = 'https:';
export const LOCALHOST_HOST = 'localhost';
export const LOCALHOST_SUFFIX = '.localhost';

/** A cookie expiring within this window is treated as already gone, so a session is
 *  not reported as usable seconds before it stops working. */
export const EXPIRY_GRACE_MS = 30_000;

/**
 * Where Tabsona lives outside the extension, for the About links and the manifest's
 * homepage. Named once so the popup, the library page and the manifest cannot disagree.
 */
export const PROJECT_LINKS = {
  /** The author's site: every Khanakia tool is listed at /apps. */
  website: 'https://khanakia.com',
  apps: 'https://khanakia.com/apps',
  github: 'https://github.com/khanakia/tabsona',
  /** How it works, limits and the privacy policy (GitHub Pages). */
  docs: 'https://khanakia.github.io/tabsona/',
  issues: 'https://github.com/khanakia/tabsona/issues',
  store: 'https://chromewebstore.google.com/detail/njpkmpklnjepcbconpnchdhbiljjjeoj',
} as const;

/**
 * The one host pattern that covers every website: what "Allow on all sites" asks Chrome
 * for, in a single prompt. It must stay identical to the manifest's
 * `optional_host_permissions` entry, because Chrome only grants at runtime what the
 * manifest lists as optional; asking for anything wider is refused outright.
 */
export const ALL_SITES_PATTERN = '*://*/*';

/** Chrome's other spelling of "every website" (it also covers file:// and ftp://). A grant
 *  of it covers every http(s) site too, so it counts as an all-sites grant wherever one is
 *  read. Never requested by Tabsona; recognised because a policy or older build can hold it. */
export const ALL_URLS_PATTERN = '<all_urls>';

/** The library page inside the extension package, as `chrome.runtime.getURL` takes it.
 *  Named once because the popup's links and the first-run welcome both open it. */
export const OPTIONS_PAGE_PATH = 'src/surfaces/options/index.html';

/** The gate page inside the extension package: where a persona tab is sent when it was
 *  about to visit a website Tabsona is not allowed on. Takes the tab id in GATE_TAB_PARAM. */
export const GATE_PAGE_PATH = 'src/surfaces/gate/index.html';
/** Query parameter carrying the stopped tab's id to the gate page. The record itself stays
 *  in the worker's storage, so nothing the page could be handed in a url is trusted. */
export const GATE_TAB_PARAM = 'tab';

/**
 * Priorities of the gate's rules, and why they sit BELOW every cookie rule.
 *
 * Chrome's DNR: an `allow` rule cancels every matching `modifyHeaders` rule of the same
 * or LOWER priority, silently. The gate needs an `allow` per granted host (to let the tab
 * through its own block), so if that allow sat at or above the priority-1 cookie STRIP, a
 * granted host would stop receiving the strip and the per-host SET rules and the tab would
 * ride the browser's shared jar: the exact leak the extension exists to prevent.
 *
 * So the layering, lowest to highest:
 *   1 GATE_BLOCK_PRIORITY    block every http(s) main_frame navigation of a bound tab
 *   2 GATE_ALLOW_PRIORITY    allow it for a granted host (beats the block)
 *   3 STRIP_RULE_PRIORITY    Cookie / Set-Cookie strip (modifyHeaders), above the allow
 *   > 1_000_000              per-host / per-domain cookie SET rules (tier x span)
 * The allow only needs to beat the block; every modifyHeaders rule outranks it, so none
 * is cancelled. Proven by the isolation / cookieonly / twologins e2e suites.
 */
export const GATE_BLOCK_PRIORITY = 1;
export const GATE_ALLOW_PRIORITY = 2;

/** What `webNavigation.onErrorOccurred` reports for a navigation a declarativeNetRequest
 *  rule blocked. Another extension blocking a request reports the same string, which is
 *  why the gate also checks that the target is a host Tabsona is not allowed on. */
export const BLOCKED_BY_CLIENT_ERROR = 'net::ERR_BLOCKED_BY_CLIENT';

/**
 * How long after a persona tab passed through a website Tabsona is not allowed on its
 * captured cookies and page storage are treated as LEAKED rather than saved.
 *
 * Long enough to cover a person typing a password on a provider's page (the case where
 * the tab lands on the unguarded host), short enough that a real sign-in later in the
 * same tab, after the host has been allowed, is saved normally. Five minutes is how long
 * a sign-in form is usually left open before the provider's own state expires.
 */
export const LEAK_WINDOW_MS = 5 * 60_000;

/** At most this many hosts are remembered per site's sign-in chain. Real chains are 2-4
 *  hops; the cap only stops an app that redirects everywhere from growing storage forever. */
export const MAX_SIGNIN_CHAIN_HOSTS = 16;

// --- page cookies (document.cookie) and the request barrier ---------------------------

/** Prefix of the page-side mirror of a session's page-visible cookies, in the REAL
 *  localStorage of the origin, keyed by session id. Outside the shim's namespace on
 *  purpose: the storage proxy only sees `<session>::` keys, so the app never enumerates
 *  it, and the session snapshot (which dumps that namespace) never carries it. It exists
 *  because `document.cookie` is read SYNCHRONOUSLY at document_start, before any message
 *  could arrive from the worker. */
export const COOKIE_MIRROR_KEY_PREFIX = '__tabsona_cookies:';
/** `window.postMessage` envelope keys between the MAIN-world shim and the ISOLATED badge
 *  script, which alone has chrome.runtime. */
export const MSG_COOKIE_WRITE = '__tabsonaCookieWrite';
export const MSG_COOKIE_SETTLE = '__tabsonaCookieSettle';
export const MSG_COOKIE_ACK = '__tabsonaCookieAck';
/** After a response completes in the page, a request sent within this window first waits
 *  for the worker to finish storing whatever that response set. A cookie reaches the
 *  next request only once its rule is installed (~15 ms measured), and page script can
 *  send that request in microseconds. Zero would restore the race; long would delay
 *  requests that cannot depend on a cookie. */
export const COOKIE_BARRIER_RECENT_MS = 150;
/** The longest a request waits for the worker's acknowledgement before it is sent anyway.
 *  A dead or asleep worker must never be able to stall a page's network. */
export const COOKIE_BARRIER_TIMEOUT_MS = 1500;
