// Named constants for every closed-set value and magic number. A bare string or a
// literal number in logic is a defect: it cannot be renamed safely, cannot be grepped
// with confidence, and carries no why.

import type { RuleResourceType } from '@/domain/types';

/** Carrier key AND url-hash marker telling a page which session its tab is. */
export const SESSION_MARKER = '__mstabs';

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
 *  extension might add later. */
export const RULE_ID_BASE = 1_000;

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
/** Bumped only when stored data needs converting. `migrateFromV1` reads it to decide
 *  whether it has already run, so it must never be lowered. */
export const SCHEMA_VERSION = 2;

/** Accent colours offered to new personas. The badge is the primary safety signal,
 *  so consecutive personas must never look alike. */
export const PERSONA_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
] as const;

/** Chrome's tab-group palette. Mapped from the persona colour so the group in the tab
 *  strip matches the dot in the popup. */
export const TAB_GROUP_COLORS = [
  'blue', 'green', 'yellow', 'red', 'purple', 'pink', 'cyan', 'orange',
] as const;

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
