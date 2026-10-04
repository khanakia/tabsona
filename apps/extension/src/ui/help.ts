// What every action does, in plain words, declared once.
//
// The popup used to label actions with bare icons or insider phrases ("Sign in fresh,
// in…", a log-out arrow that did not log anyone out), and a user reported they could not
// tell whether a control would copy a login, open a tab, or change their normal browser
// login. Every action now answers the same three questions, from this one table, so the
// wording cannot drift between the button, its help card and its menu entry.

import type { StateLayer } from '@/domain/types';

/**
 * Where a website keeps data, named for someone who has never opened DevTools. Used only
 * when a layer is NOT kept separate, so the warning says what leaks in words the reader
 * can act on.
 */
export const LAYER_PLAIN: Readonly<Record<StateLayer, string>> = {
  cookies: 'login cookies',
  localStorage: 'saved page data',
  sessionStorage: 'per-tab page data',
  indexedDB: 'offline database',
  serviceWorker: 'background worker',
  sharedWorker: 'shared background worker',
  crossOriginFrames: 'content embedded from other websites',
};

/**
 * Every user-facing action the popup and the library offer. A closed set so a control
 * cannot ship without help: `ACTION_HELP` is a `Record` over it, so adding an id here
 * without its explanation is a type error, not a missing tooltip found later.
 */
export type ActionId =
  | 'newPersona' | 'openLibrary' | 'howItWorks'
  | 'openAll' | 'addSite' | 'renamePersona' | 'changeColor' | 'duplicatePersona' | 'deletePersona'
  | 'openSession' | 'openSessionHere' | 'anotherAccountForSite' | 'renameSession' | 'deleteSession'
  | 'allowSite' | 'addToPersona' | 'useTabSignedOut' | 'newPersonaFromLogin' | 'moveLogin' | 'copyLogin'
  | 'anotherAccountHere' | 'addSiteToPersona' | 'anotherAccountNewPersona'
  | 'saveNow' | 'leavePersona';

/**
 * One action's explanation.
 *
 * Written for someone who has never heard of cookies: what you will SEE happen, and what
 * it does to everything else. Invariants for anyone editing the table: `label` is a verb
 * phrase naming the outcome, short enough for a button; `what` is one sentence about
 * what visibly happens (does a tab open? is it signed in?); `touches` says what happens
 * to the user's normal browser login and their other tabs, because that is the question
 * every confused user was actually asking; `gotcha` exists only when a choice has a
 * consequence people would not guess.
 */
export interface ActionHelp {
  readonly label: string;
  readonly what: string;
  readonly touches: string;
  readonly gotcha?: string;
}

/** The explanation of every action, keyed by ActionId. A `Record` over the closed set, so
 *  an action declared without its explanation fails to compile. */
export const ACTION_HELP: Readonly<Record<ActionId, ActionHelp>> = {
  newPersona: {
    label: 'New persona',
    what: 'Creates a persona: one identity, like “Acme admin”, that keeps its own logins for any number of websites.',
    touches: 'Nothing else changes. It starts empty.',
  },
  openLibrary: {
    label: 'Open full library',
    what: 'Opens a full page to manage every persona, the websites Tabsona may use, and settings.',
    touches: 'Nothing changes until you edit something there.',
  },
  howItWorks: {
    label: 'How it works',
    what: 'Shows the three steps to save a login once and reopen it signed in.',
    touches: 'Nothing changes.',
  },
  openAll: {
    label: 'Open all',
    what: 'Opens every website in this persona, each in a new tab, already signed in.',
    touches: 'Your other tabs and your normal browser login stay exactly as they are.',
  },
  addSite: {
    label: 'Add website',
    what: 'Adds a website to this persona and opens it in a new tab, signed out, so you can sign in once.',
    touches: 'From then on the persona remembers that login. Your normal browser login is not touched.',
  },
  renamePersona: {
    label: 'Rename & describe',
    what: 'Changes the persona’s name and the note saying what it is for.',
    touches: 'Logins and open tabs are not affected.',
  },
  changeColor: {
    label: 'Change colour',
    what: 'Picks the colour that marks this persona everywhere: its badge on pages, the heart in front of its tab titles, and its Chrome tab group.',
    touches: 'Open tabs update straight away. Logins are not affected.',
  },
  duplicatePersona: {
    label: 'Duplicate',
    what: 'Makes a copy of this persona, saved logins included.',
    touches: 'Both copies start signed in as the same user.',
    gotcha: 'They share one sign-in on each website: signing out in either signs out both.',
  },
  deletePersona: {
    label: 'Delete persona',
    what: 'Deletes this persona and every login saved in it.',
    touches: 'Its open tabs go back to your normal browser login. Websites are not signed out.',
    gotcha: 'This cannot be undone.',
  },
  openSession: {
    label: 'Open',
    what: 'Opens this website in a new tab, signed in as this persona.',
    touches: 'Your other tabs and your normal browser login stay as they are.',
  },
  openSessionHere: {
    label: 'Open here',
    what: 'Switches the tab you are looking at to this website, signed in as this persona.',
    touches: 'Only that one tab changes.',
  },
  anotherAccountForSite: {
    label: 'Add another account',
    what: 'Creates a new persona and opens this website in a new tab, signed out, so you can sign in as someone else.',
    touches: 'This persona keeps its login. Your normal browser login is not touched.',
  },
  renameSession: {
    label: 'Rename',
    what: 'Changes the name shown for this saved login.',
    touches: 'The login itself is not affected.',
  },
  deleteSession: {
    label: 'Forget this login',
    what: 'Removes this saved login from the persona.',
    touches: 'The website is not signed out. Open tabs using it go back to your normal browser login.',
    gotcha: 'To use it again you will have to sign in again.',
  },
  allowSite: {
    label: 'Allow this website',
    what: 'Chrome asks your permission for Tabsona to work on this website.',
    touches: 'Nothing changes until you allow it, and only for this website.',
  },
  addToPersona: {
    label: 'Add to persona',
    what: 'Choose how this tab joins a persona: signed out, or by moving or copying the login you are using now.',
    touches: 'Each choice below says what it does to your normal browser login.',
  },
  useTabSignedOut: {
    label: 'Use this tab, signed out',
    what: 'This tab joins the persona with no login, so you can sign in here as someone new.',
    touches: 'Your normal browser login and your other tabs stay as they are.',
  },
  newPersonaFromLogin: {
    label: 'New persona with my login',
    what: 'Creates a persona named after this website and moves the login you are using into it.',
    touches: 'This tab stays signed in, now as the persona.',
    gotcha: 'Your normal browser is signed out of this website afterwards.',
  },
  moveLogin: {
    label: 'Move my login',
    what: 'Gives the login you are using to the persona. This tab stays signed in, now as the persona.',
    touches: 'Your normal browser is signed out of this website.',
    gotcha: 'Other normal tabs on this website will show you signed out.',
  },
  copyLogin: {
    label: 'Copy my login',
    what: 'Gives the persona the same login and keeps you signed in normally too.',
    touches: 'Nothing is signed out.',
    gotcha: 'Both share one sign-in: signing out in either place signs out both.',
  },
  anotherAccountHere: {
    label: 'Another account',
    what: 'Opens this website in a new tab, signed out, so you can sign in as someone else.',
    touches: 'This tab keeps its login. Your normal browser login is not touched.',
  },
  addSiteToPersona: {
    label: 'Add to',
    what: 'Adds this website to that persona and opens it in a new tab, signed out.',
    touches: 'This tab and your normal browser login are not touched.',
  },
  anotherAccountNewPersona: {
    label: 'In a new persona',
    what: 'Creates a new persona and opens this website in it, in a new tab, signed out.',
    touches: 'This tab and your normal browser login are not touched.',
  },
  saveNow: {
    label: 'Save now',
    what: 'Saves this tab’s login into the persona right now.',
    touches: 'Tabsona also saves on its own every few seconds and on every page load, so you rarely need this.',
  },
  leavePersona: {
    label: 'Leave persona',
    what: 'This tab goes back to your normal browser login.',
    touches: 'The persona keeps its saved login. Nothing is signed out.',
  },
};

/**
 * How long the pointer must rest before a help card opens.
 *
 * Long enough that sweeping the cursor across a row does not flash a card over every
 * control, short enough that someone hesitating over a button gets the answer before they
 * give up. Keyboard focus opens it the same way, so the help is not mouse-only.
 */
export const HELP_CARD_DELAY_MS = 300;

/**
 * What the "isolated" status on the current tab means, for this tab right now.
 *
 * Built from the tab's state rather than fixed text because the honest answer differs:
 * an empty session has nothing to protect yet, and a leaking layer must be named, never
 * hidden behind a reassuring green shield (project rule: degradation is surfaced).
 */
export function isolationHelp(status: {
  readonly isEmpty: boolean;
  readonly leakingLayers: readonly StateLayer[];
}): ActionHelp {
  if (status.isEmpty) {
    return {
      label: 'Not signed in yet',
      what: 'This tab belongs to the persona but has no login saved. Sign in here once and Tabsona saves it.',
      touches: 'Your normal browser login is not used in this tab.',
    };
  }
  if (status.leakingLayers.length > 0) {
    return {
      label: 'Partly separate',
      what: 'This tab uses the persona’s own login, kept apart from your normal browser.',
      touches: 'Most of this website’s data is kept separate.',
      gotcha: `Not kept separate: ${status.leakingLayers.map((l) => LAYER_PLAIN[l]).join(', ')}. Another tab on this website may still affect it.`,
    };
  }
  return {
    label: 'Separate',
    what: 'This tab uses only the persona’s login.',
    touches: 'Your normal browser and other personas cannot see or change it.',
  };
}

/**
 * A yes/no question the user must answer before something that cannot be undone.
 *
 * Rendered by `ConfirmDialog`, never by `window.confirm`: a native dialog cannot be
 * styled, blocks the page, and is dismissed by browser chrome rather than the app.
 */
export interface ConfirmRequest {
  readonly title: string;
  readonly body: string;
  /** Names the outcome ("Delete persona"), never a bare "OK". */
  readonly confirmLabel: string;
  /** Styles the confirm button as destructive. */
  readonly destructive: boolean;
}

/** Deleting a persona: its saved logins go with it. */
export function confirmDeletePersona(name: string): ConfirmRequest {
  return {
    title: `Delete “${name}”?`,
    body: `${ACTION_HELP.deletePersona.what} ${ACTION_HELP.deletePersona.touches}`,
    confirmLabel: ACTION_HELP.deletePersona.label,
    destructive: true,
  };
}

/** Forgetting one saved login. */
export function confirmForgetLogin(): ConfirmRequest {
  return {
    title: 'Forget this saved login?',
    body: `${ACTION_HELP.deleteSession.touches} ${ACTION_HELP.deleteSession.gotcha ?? ''}`.trim(),
    confirmLabel: ACTION_HELP.deleteSession.label,
    destructive: true,
  };
}

/** Saving a login into a persona that already holds one for that site. */
export function confirmReplaceLogin(personaName: string, site: string): ConfirmRequest {
  return {
    title: `Replace the saved login for ${site}?`,
    body: `“${personaName}” already has a saved login for this website. It will be replaced with the one you are using now.`,
    confirmLabel: 'Replace login',
    destructive: true,
  };
}
