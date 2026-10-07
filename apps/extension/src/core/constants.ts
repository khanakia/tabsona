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
export const STRIP_RULE_PRIORITY = 1;
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
