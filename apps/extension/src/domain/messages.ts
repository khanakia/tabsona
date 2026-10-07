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
  | { readonly op: 'updateSettings'; readonly patch: SettingsPatch };

/** On/off settings a user can flip. Closed set so a typo cannot create a phantom setting. */
export type SettingKey = 'useTabGroups' | 'openPersonaInNewWindow' | 'showPageBadge' | 'markPageTitles' | 'autoHideBadge';

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
}

export interface AppState {
  readonly personas: readonly PersonaView[];
  readonly tab: TabStatus;
  readonly allowedOrigins: readonly string[];
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
  | { readonly ok: true }
  /** `needsConfirm` is not an error: the caller must ask the user, then retry with
   *  `replace: true`. Modelling it separately stops a destructive overwrite being
   *  one indistinguishable failure among many. */
  | { readonly ok: false; readonly needsConfirm: 'replace-session'; readonly site: Site }
  | { readonly ok: false; readonly error: string };
