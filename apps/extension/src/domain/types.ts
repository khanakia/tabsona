// Domain vocabulary. ZERO imports by design: every other layer may depend on this
// file and it must never depend on anything — not chrome.*, not React, not storage.
// That is what lets the pure logic in ../core be unit-tested in Node with no mocks.

/** Opaque ids. Distinct types so one can never be passed where the other is meant. */
export type PersonaId = string;
export type SessionId = string;
export type TabId = number;

/** A site, canonicalised to an origin (`https://sync.localhost`).
 *  Origin rather than registrable domain: it matches how the browser partitions
 *  storage, which is the thing actually being isolated. A session may still SPAN
 *  several hosts via `domains`. */
export type Site = string;
export type Origin = string;

/**
 * A cookie's IDENTITY is not its name.
 *
 * Two cookies with the same name are different cookies if they differ in domain,
 * path, or partition key. Flattening to `name=value` replays a cookie onto paths and
 * subdomains it was never scoped to, loses expiry, and under CHIPS collapses every
 * partition of one cookie into a single record — which presents as random logouts.
 */
export interface CookieRecord {
  readonly name: string;
  readonly value: string;
  /** Host, or the `Domain=` value with any leading dot normalised away. */
  readonly domain: string;
  /** True when `Domain=` was absent: must NOT be sent to subdomains. */
  readonly hostOnly: boolean;
  readonly path: string;
  /** Epoch ms, or null for a session cookie that dies with the browser session. */
  readonly expiresAt: number | null;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite: 'strict' | 'lax' | 'none' | null;
  /** CHIPS partition. null when unpartitioned. Part of identity, never ignored. */
  readonly partitionKey: string | null;
}

export type StorageArea = 'local' | 'session';
export type StorageSlice = Readonly<Record<string, string>>;

/** Which isolation strategy a session runs on. */
export type EngineKind = 'cookie+storage' | 'token-injection';

/**
 * One saved login, for one site, inside one persona.
 *
 * `(personaId, site)` is unique: a persona is a single coherent identity across a
 * stack, so two roles on the same app means two personas. That is what makes
 * "open this persona" unambiguous.
 */
export interface Session {
  readonly id: SessionId;
  /** Mutable: a session can be moved between personas, which is a real operation. */
  personaId: PersonaId;
  readonly site: Site;
  /** Human label, seeded from the page title at save time, then editable. Real app
   *  titles usually already carry the user or tenant ("Dashboard · Sync"). */
  label: string;
  /** A session may span several hosts: real SSO uses an auth subdomain plus an API
   *  domain, so pinning to one host breaks it. */
  domains: string[];
  cookies: CookieRecord[];
  storage: Record<Origin, Partial<Record<StorageArea, StorageSlice>>>;
  readonly engine: EngineKind;
  bearerToken: string | null;
  savedAt: number;
  lastUsedAt: number;
  /**
   * Set when this session's tab signed in while it was passing through a website Tabsona
   * is not allowed on: the login that came back may be the BROWSER's user, so what was
   * captured in that window was NOT saved (core/gate.ts, `leakWindowFor`). Cleared by
   * "Start over signed out". Absent on every session written before 0.4, which is the
   * right reading: nothing was ever marked.
   */
  leakedThrough?: LeakedSignIn;
}

/** A sign-in that went through unguarded websites, as recorded on its session. */
export interface LeakedSignIn {
  /** The websites Tabsona was not allowed on, sorted. Never empty. */
  readonly hosts: readonly Origin[];
  /** When the leaked login was refused, epoch ms. */
  readonly at: number;
}

/** Who you are across a set of apps. The unit a user actually thinks in. */
export interface Persona {
  readonly id: PersonaId;
  name: string;
  /** Free text: what this persona is FOR. A name alone stops being enough once there
   *  are a dozen of them and "admin" could mean three different stacks. */
  description: string;
  /** Accent colour; drives the badge and the Chrome tab group. */
  color: string;
  readonly createdAt: number;
  lastUsedAt: number;
}

/**
 * What a session is worth right now.
 *
 * `empty` exists because an empty session deliberately starts a tab SIGNED OUT, which
 * reads as a broken button unless every surface says so. It was the single most
 * confusing thing about v1.
 */
export type SessionState = 'signed-in' | 'empty' | 'expired' | 'unknown';

/** tabId -> sessionId. Lives in chrome.storage.session, never in worker memory. */
export type TabBindings = Readonly<Record<string, SessionId>>;

// --- coverage ---------------------------------------------------------------

/** `shared` is a layer the USER chose to leave on their normal browser login (a
 *  pass-through host, core/passthrough.ts): neither isolated nor a leak, and never reported
 *  as either. */
export type CoverageStatus = 'covered' | 'leaking' | 'unknown' | 'not-applicable' | 'shared';

export type StateLayer =
  | 'cookies' | 'localStorage' | 'sessionStorage' | 'indexedDB'
  | 'serviceWorker' | 'sharedWorker' | 'crossOriginFrames'
  /** Sign-in through ANOTHER website (an SSO provider) the extension holds no permission
   *  for. Header rules never apply there, so that hop uses the browser's own login. */
  | 'signInSites'
  /** The host is on the user's "use my normal login" list: nothing is kept separate. */
  | 'normalLogin';

/** What the badge renders. Coverage is DATA, never prose in a comment: a tool that
 *  looks isolated while leaking turns every later bug into a question about whether
 *  the tool lied. */
export interface LayerCoverage {
  readonly layer: StateLayer;
  readonly status: CoverageStatus;
  readonly detail: string;
}

// --- rules ------------------------------------------------------------------

export type RuleResourceType =
  | 'main_frame' | 'sub_frame' | 'xmlhttprequest' | 'websocket' | 'other';

export interface HeaderEdit {
  readonly header: string;
  readonly operation: 'set' | 'remove';
  readonly value?: string;
}

/** A per-tab cookie rule in the domain's own terms. The engine translates it into
 *  `chrome.declarativeNetRequest.Rule`; keeping the shape ours is what lets
 *  `core/rules.ts` be a pure function tested with no chrome stub. */
export interface TabRule {
  readonly id: number;
  readonly priority: number;
  readonly tabId: TabId;
  /** RE2 pattern the request URL must match, or null for every request the tab makes.
   *  Null only on the tab's STRIP rule; every rule that SETS a header is scoped to the
   *  hosts that own it, or one host's cookies would be sent to every other host. */
  readonly urlRegex: string | null;
  readonly resourceTypes: readonly RuleResourceType[];
  readonly requestHeaders: readonly HeaderEdit[];
  /** Response-header edits. Used to strip `Set-Cookie` so a session's login never
   *  reaches the browser's own jar — see core/rules.ts for why that matters. */
  readonly responseHeaders: readonly HeaderEdit[];
}

/**
 * One rule of the sign-in gate (core/gate.ts), in the domain's own terms.
 *
 * - `block`: every http(s) top-level navigation of ONE bound tab. Needs no host
 *   permission, which is the whole point: it is the only rule that can act on a host
 *   Tabsona is not allowed on.
 * - `allow`: top-level navigations of the bound tabs to one granted pattern, so the
 *   persona's own sites (and every host the user allowed) still load.
 */
export type GateRule =
  | { readonly kind: 'block'; readonly id: number; readonly tabId: TabId; readonly urlFilter: string }
  | { readonly kind: 'allow'; readonly id: number; readonly tabIds: readonly TabId[]; readonly urlRegex: string };

/**
 * One rule of the pass-through exemption (core/passthrough.ts): a tab-scoped `allow` for
 * the bound tabs and one pass-through host, at PASS_THROUGH_ALLOW_PRIORITY. It cancels the
 * cookie strip, the per-host SET rules and the gate block for that host, so a persona tab
 * reaches it exactly like a plain tab does.
 */
export interface PassThroughRule {
  readonly id: number;
  readonly tabIds: readonly TabId[];
  readonly urlRegex: string;
}

/** What the gate page and the popup offer for a website that could be reached with the
 *  browser's own login: the whole Google preset (plus the stopped host when it is another
 *  Google domain), or just the one host. */
export interface PassThroughOffer {
  readonly kind: 'google' | 'host';
  /** List entries to add, none of them already on the list. Never empty. */
  readonly hosts: readonly string[];
}

// --- view projections -------------------------------------------------------

/** One session as the UI sees it. Never carries cookie or token VALUES. */
export interface SessionView {
  readonly id: SessionId;
  /** Mutable: a session can be moved between personas, which is a real operation. */
  personaId: PersonaId;
  readonly site: Site;
  readonly label: string;
  readonly state: SessionState;
  readonly cookieCount: number;
  readonly storageKeyCount: number;
  readonly domains: readonly string[];
  readonly openTabCount: number;
  readonly savedAt: number;
  readonly lastUsedAt: number;
  /** Cookie NAMES and storage KEYS, for the expanded row. Never values. */
  readonly cookieNames: readonly string[];
  readonly storageKeys: readonly string[];
  /** When the soonest-expiring cookie expires, for the `expired` explanation. */
  readonly expiresAt: number | null;
}

export interface PersonaView {
  readonly id: PersonaId;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly sessions: readonly SessionView[];
  readonly openTabCount: number;
  readonly lastUsedAt: number;
}
