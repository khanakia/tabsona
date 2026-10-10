// The typed wire between the surfaces and the service worker.
//
// A discriminated union rather than loose strings: an unhandled op is a compile error
// in the worker's switch, and a surface cannot invent an op that does not exist.
// Contracts enforced by convention fail silently; this one does not.

import type {
  LayerCoverage, PersonaId, PersonaView, SessionId, Site, TabId,
} from './types';

export type Request =
  | { readonly op: 'getState' }
  | { readonly op: 'createPersona'; readonly name: string }
  /** Patch a persona. One op rather than a rename op plus a describe op, so adding a
   *  third editable field later does not add a third message. */
  | {
    readonly op: 'updatePersona';
    readonly personaId: PersonaId;
    readonly name?: string;
    readonly description?: string;
    /** A palette hex (see PERSONA_PALETTE); anything else is ignored by the worker. */
    readonly color?: string;
  }
  | { readonly op: 'deletePersona'; readonly personaId: PersonaId }
  | { readonly op: 'duplicatePersona'; readonly personaId: PersonaId; readonly name?: string }
  | { readonly op: 'openPersona'; readonly personaId: PersonaId }
  /** Capture the CURRENT tab's real login into a persona. `replace` confirms an
   *  overwrite when that persona already holds a session for the site. */
  /**
   * Import the current tab's login into a persona.
   *
   * `mode` is the user's call, not ours:
   *  - `move` takes the login OUT of the browser's jar, so the identity has one home.
   *  - `copy` leaves the browser signed in too. Both then share ONE server-side session,
   *    so signing out in either kills both — real, and sometimes exactly what is wanted.
   */
  | {
    readonly op: 'saveCurrentTab';
    readonly personaId: PersonaId;
    readonly mode: 'move' | 'copy';
    readonly replace?: boolean;
  }
  /** Put the CURRENT tab into a persona with a BLANK session — no import. The browser's
   *  own login is left alone, so a plain tab elsewhere stays signed in. */
  | { readonly op: 'useTabIn'; readonly personaId: PersonaId }
  /** Open a signed-out tab for a new site inside a persona, so the user can log in. */
  | { readonly op: 'addSite'; readonly personaId: PersonaId; readonly url: string }
  /** Another login for a site that already has one: a new persona, named after the
   *  site, holding one empty session, opened signed out. */
  | { readonly op: 'anotherLogin'; readonly url: string; readonly name?: string }
  | { readonly op: 'openSession'; readonly sessionId: SessionId; readonly where: 'new-tab' | 'this-tab' }
  | { readonly op: 'renameSession'; readonly sessionId: SessionId; readonly label: string }
  | { readonly op: 'deleteSession'; readonly sessionId: SessionId }
  | { readonly op: 'moveSession'; readonly sessionId: SessionId; readonly toPersonaId: PersonaId }
  | { readonly op: 'saveNow'; readonly tabId: TabId }
  | { readonly op: 'unbindTab'; readonly tabId: TabId }
  | { readonly op: 'tabStatus'; readonly tabId: TabId }
  | { readonly op: 'coverageReport' }
  | { readonly op: 'exportData' }
  | { readonly op: 'importData'; readonly json: string }
  | { readonly op: 'setSetting'; readonly key: SettingKey; readonly value: boolean }
  | { readonly op: 'setBadgePosition'; readonly position: BadgeCorner }
  | { readonly op: 'resetBadgePlacements' }
  | { readonly op: 'updateSettings'; readonly patch: SettingsPatch }
  /** What the gate page shows for the tab it replaced. */
  | { readonly op: 'gateInfo'; readonly tabId: TabId }
  /** Resume the stopped navigation, after the gate page's own Allow click was granted. */
  | { readonly op: 'gateContinue'; readonly tabId: TabId }
  /** Open the stopped url in an ordinary tab and put the persona tab back where it was. */
  | { readonly op: 'gateOpenNormally'; readonly tabId: TabId }
  /** Page script wrote `line` with `document.cookie` at `url`. Sent by the badge script on
   *  the shim's behalf; the reply means the cookie is stored AND its rule is installed. */
  | { readonly op: 'cookieWrite'; readonly url: string; readonly line: string }
  /** Reply once everything the worker has seen set a cookie is stored and in force. */
  | { readonly op: 'cookieSettle' }
  /** Clear a leaked sign-in: the session's cookies and page data go, its tabs reload. */
  | { readonly op: 'startOver'; readonly sessionId: SessionId };

/** On/off settings a user can flip. Closed set so a typo cannot create a phantom setting. */
export type SettingKey =
  | 'useTabGroups' | 'openPersonaInNewWindow' | 'showPageBadge' | 'markPageTitles' | 'autoHideBadge'
  | 'chooseSitesMyself';

/**
 * How the badge first appears on a page: the persona's name, or just a coloured dot.
 * Only the starting state — clicking the badge on a page still switches between the two.
 */
export type BadgeStyle = 'label' | 'dot';

/** Every badge style, in the order the settings control offers them. */
export const BADGE_STYLES: readonly BadgeStyle[] = ['label', 'dot'];

/** Bounds for "hide the badge after N seconds". One second is the shortest a person can
 *  still read it in; past a minute the badge is effectively always there anyway. */
export const BADGE_HIDE_SECONDS_MIN = 1;
export const BADGE_HIDE_SECONDS_MAX = 60;
/** Long enough to read which persona this is, short enough to be out of the way. */
export const BADGE_HIDE_SECONDS_DEFAULT = 5;

/**
 * The sections of the full library page, so a surface can open it on the right one
 * (`#settings`). A closed set: an unknown hash falls back to the first section.
 */
export type OptionsSection = 'personas' | 'sites' | 'settings' | 'coverage' | 'data';
export const OPTIONS_SECTIONS: readonly OptionsSection[] = ['personas', 'sites', 'settings', 'coverage', 'data'];

/**
 * Where the in-page persona badge sits.
 *
 * A setting because no single corner is safe: apps put header buttons top-right, chat
 * widgets bottom-right, and the badge must never be the thing hiding a control.
 */
export type BadgeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Every corner, in the order the settings control offers them. */
export const BADGE_CORNERS: readonly BadgeCorner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

/** Everything a user can configure. On/off switches plus the badge corner. */
export interface Settings extends Readonly<Record<SettingKey, boolean>> {
  readonly badgePosition: BadgeCorner;
  readonly badgeStyle: BadgeStyle;
  /** Used only while `autoHideBadge` is on. Always within the MIN..MAX bounds above. */
  readonly badgeHideSeconds: number;
}

/** A partial change to settings, validated by the worker before it is stored. */
export type SettingsPatch = Partial<Settings>;

/** What every setting is before the user changes it, and the fallback for any stored
 *  value that is missing or invalid (see core/settings.ts). */
export const DEFAULT_SETTINGS: Settings = {
  // On by default: a native Chrome tab group makes "which tabs are which persona"
  // visible in Chrome's own tab strip, which no badge of ours can do.
  useTabGroups: true,
  openPersonaInNewWindow: false,
  // On by default: the in-page badge is where a tab says which persona it is and
  // whether it is fully separate. Off is for people who rely on tab groups instead.
  showPageBadge: true,
  // Bottom-right: out of the way of navigation, which apps put top and left. Top-right,
  // the original fixed spot, covered real header buttons.
  badgePosition: 'bottom-right',
  badgeStyle: 'label',
  // Off by default: the badge is the in-page safety signal, so hiding it is the user's
  // call. When on, the title marker and toolbar icon still say whose tab it is.
  autoHideBadge: false,
  badgeHideSeconds: BADGE_HIDE_SECONDS_DEFAULT,
  // On by default: the tab strip and window title are where people look when they have
  // six tabs on one app open, and a coloured marker there says whose each one is.
  markPageTitles: true,
  // Off until the user answers the first-run welcome with "I'll choose sites myself".
  // While off (and every website is not yet allowed) the library page shows that welcome;
  // once on, it never asks again. Allowing every website hides the welcome on its own.
  chooseSitesMyself: false,
};

/**
 * The in-page badge was dragged to a new spot on `origin`. One-way, like ShimReadyNotice:
 * the worker stores it and redraws every tab on that site; nothing is sent back.
 * `x` and `y` are fractions of the free space — see core/placement.ts.
 */
export interface BadgeMovedNotice {
  readonly op: 'badgeMoved';
  readonly origin: string;
  readonly x: number;
  readonly y: number;
}

/** The badge was double-clicked on `origin`: forget its dragged spot. One-way. */
export interface BadgeResetNotice {
  readonly op: 'badgeReset';
  readonly origin: string;
}

/**
 * The shim's self-report, relayed by the ISOLATED-world badge script.
 *
 * Deliberately NOT a member of `Request`: it is one-way, expects no response, and is
 * handled by its own listener. Folding it into the request union would force every
 * exhaustive switch to carry a case that never returns anything.
 */
export interface ShimReadyNotice extends ShimFacts {
  readonly op: 'shimReady';
  readonly origin: string;
}

/**
 * A form on a persona tab's page is being POSTed. One-way, like ShimReadyNotice.
 *
 * Why the worker is told at all: a navigation the gate stops is reported with its url and
 * NOTHING ELSE (`webNavigation.onErrorOccurred` carries no method or body), so a stopped
 * form POST looks exactly like a stopped link, and resuming it as a GET sends the
 * provider a request with every parameter missing. Only the page that holds the form can
 * say it is a POST. Carries the target and method, never the fields (a password may be
 * among them).
 */
export interface FormSubmitNotice {
  readonly op: 'formSubmit';
  readonly origin: string;
  /** The form's resolved target url, as the browser will request it. */
  readonly action: string;
  /** Lower-case: what `HTMLFormElement.method` returns. */
  readonly method: string;
}

/**
 * What the page shim observed and achieved on one page — the only evidence the badge
 * accepts. Declared once because it crosses three boundaries (MAIN-world shim →
 * ISOLATED-world badge → worker, plus the worker's own executeScript pull), and four
 * hand-copied shapes of it had already drifted to differ by field.
 */
export interface ShimFacts {
  /** The page opened an IndexedDB database. */
  readonly usesIndexedDb: boolean;
  /** Every IndexedDB entry point that takes a database name is translated per session. */
  readonly idbNamespaced: boolean;
  /** The page started a dedicated Worker, whose own `indexedDB` the shim cannot reach. */
  readonly usesWorker: boolean;
  /** A service worker controls the page; its fetches carry no tab id. */
  readonly hasServiceWorker: boolean;
}

/** What the current tab is, as the popup footer needs it. */
export interface TabStatus {
  readonly tabId: TabId | null;
  readonly url: string | null;
  readonly site: Site | null;
  /** False for chrome:// and about: pages, where nothing can be offered. */
  readonly isWebPage: boolean;
  /** Whether the extension may isolate this site yet. */
  readonly siteAllowed: boolean;
  readonly sessionId: SessionId | null;
  readonly personaId: PersonaId | null;
  readonly personaName: string | null;
  readonly color: string | null;
  readonly isEmpty: boolean;
  readonly coverage: readonly LayerCoverage[];
  readonly summary: string;
  /** Websites this site's sign-in sent the tab to that Tabsona is NOT allowed on yet.
   *  Each one is offered as an "Allow" button: until it is allowed, the browser's own
   *  login on that website is used and can sign this tab in as the wrong person. */
  readonly unguardedSignInSites: readonly string[];
  /** Websites this tab's session signed in through while Tabsona was not allowed on
   *  them. The login that came back was NOT saved, and "Start over signed out" clears
   *  what is left. Empty for every session that never leaked. */
  readonly leakedSignInSites: readonly string[];
}

/**
 * One app whose sign-in, in a persona tab that is open right now, passed through websites
 * Tabsona is not allowed on. Until those are allowed, the browser's own login there is
 * used, so the persona can come back signed in as the browser's user.
 */
export interface SignInAlert {
  /** The persona's site the sign-in started from, e.g. `https://staging-app.example.com`. */
  readonly site: Site;
  /** Every un-allowed host in its sign-in chain seen so far, sorted. Never empty. */
  readonly hosts: readonly string[];
}

/**
 * Why the gate stopped a persona tab, which decides the gate page's wording:
 * - `sign-in`: the host is in this site's known sign-in chain (a provider);
 * - `own-site`: the persona's own site, which Tabsona has not been allowed on yet;
 * - `link`: anywhere else — a link out, a redirect seen for the first time.
 */
export type GateReason = 'sign-in' | 'own-site' | 'link';

/** What the gate page needs to ask its question. Built by the worker from its own record
 *  of the stopped navigation; the page is handed only a tab id. */
export interface GateInfo {
  readonly tabId: TabId;
  /** The exact url the tab was going to. */
  readonly url: string;
  /** Its origin: the website Tabsona is not allowed on. */
  readonly host: string;
  /** The persona's site the tab belongs to. */
  readonly site: Site;
  readonly personaName: string;
  readonly color: string;
  readonly reason: GateReason;
  /** Every origin one "Allow and continue" asks for, stopped host first, already-allowed
   *  ones removed. For a sign-in this is the whole known chain, so a chain seen once is
   *  allowed in ONE prompt; otherwise just the stopped host. */
  readonly hostsToAllow: readonly string[];
  /** The stopped navigation was a form POST, which cannot be resent: continuing takes the
   *  tab back to the page holding the form so the user presses its button again, and
   *  "Open in a normal tab" is not offered (it would send the provider a bare GET). */
  readonly viaForm: boolean;
}

export interface AppState {
  readonly personas: readonly PersonaView[];
  readonly tab: TabStatus;
  readonly allowedOrigins: readonly string[];
  /** Sign-in chains leaking through un-allowed hosts, across every open persona tab — not
   *  only the active one, because the popup's alert must not depend on which tab is in
   *  front. Empty when nothing needs allowing. */
  readonly signInAlerts: readonly SignInAlert[];
  /** "Allow on all sites" is in force (the all-sites pattern is granted), read live from Chrome. When
   *  true no website needs allowing one by one, so nothing offers it again. */
  readonly allSitesAllowed: boolean;
  readonly settings: Settings;
}

export interface OriginCoverage {
  readonly origin: Origin2;
  readonly coverage: readonly LayerCoverage[];
}
type Origin2 = string;

export type Response =
  | { readonly ok: true; readonly state: AppState }
  | { readonly ok: true; readonly personaId: PersonaId }
  | { readonly ok: true; readonly sessionId: SessionId }
  | { readonly ok: true; readonly tabId: TabId }
  | { readonly ok: true; readonly status: TabStatus }
  | { readonly ok: true; readonly report: readonly OriginCoverage[] }
  | { readonly ok: true; readonly json: string }
  | { readonly ok: true; readonly opened: number }
  | { readonly ok: true; readonly gate: GateInfo | null }
  | { readonly ok: true }
  /** `needsConfirm` is not an error: the caller must ask the user, then retry with
   *  `replace: true`. Modelling it separately stops a destructive overwrite being
   *  one indistinguishable failure among many. */
  | { readonly ok: false; readonly needsConfirm: 'replace-session'; readonly site: Site }
  | { readonly ok: false; readonly error: string };
