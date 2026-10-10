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
  signInSites: 'sign-in through another website',
  normalLogin: 'your normal browser login',
};

/**
 * Every user-facing action the popup and the library offer. A closed set so a control
 * cannot ship without help: `ACTION_HELP` is a `Record` over it, so adding an id here
 * without its explanation is a type error, not a missing tooltip found later.
 */
export type ActionId =
  | 'newPersona' | 'openLibrary' | 'openSettings' | 'howItWorks'
  | 'openAll' | 'addSite' | 'renamePersona' | 'changeColor' | 'duplicatePersona' | 'deletePersona'
  | 'openSession' | 'openSessionHere' | 'anotherAccountForSite' | 'renameSession' | 'deleteSession'
  | 'allowSite' | 'addToPersona' | 'useTabSignedOut' | 'newPersonaFromLogin' | 'moveLogin' | 'copyLogin'
  | 'anotherAccountHere' | 'addSiteToPersona' | 'anotherAccountNewPersona'
  | 'saveNow' | 'leavePersona' | 'allowSignInSite' | 'allowAllSignInSites' | 'allowSiteOnly'
  | 'allowAllSites' | 'removeAllSites' | 'chooseSitesMyself'
  | 'allowAndContinue' | 'openNormally' | 'startOver'
  | 'useNormalGoogleLogin' | 'useNormalLogin' | 'addGoogleSignInSites' | 'removeNormalLogin' | 'addNormalLogin';

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
    what: 'Opens a full page listing every persona and saved login, the websites Tabsona may use, and what it measured on each.',
    touches: 'Nothing changes until you edit something there.',
  },
  openSettings: {
    label: 'Settings',
    what: 'Opens the settings: the badge on pages (corner, dot or name, hide after a few seconds), page-title colours and tab groups.',
    touches: 'Nothing changes until you flip a setting.',
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
    touches: 'Its open tabs reload on your normal browser login. Websites are not signed out.',
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
    touches: 'The website is not signed out. Open tabs using it reload on your normal browser login.',
    gotcha: 'To use it again you will have to sign in again.',
  },
  allowSignInSite: {
    label: 'Allow',
    what: 'This website signs you in through another website. Allowing that one lets Tabsona keep its login separate too.',
    touches: 'Until then, a persona tab stops before it visits that website and asks you there, so it never arrives signed in as you.',
  },
  allowAllSignInSites: {
    label: 'Allow all',
    what: 'Chrome asks once for every sign-in website listed here. Allowing only grants Tabsona access: no tab opens and nothing is added to a persona.',
    touches: 'Next time a persona signs in to this site, it goes straight through. A website the sign-in has not reached yet is asked about in the tab, when the persona gets there.',
  },
  allowSiteOnly: {
    label: 'Allow a website',
    what: 'Gives Tabsona access to a website without opening it or adding it to a persona — for a sign-in website (an SSO provider) that a persona’s site redirects through.',
    touches: 'Chrome asks for your permission. Nothing else changes until a persona tab visits that website.',
  },
  allowAndContinue: {
    label: 'Allow and continue',
    what: 'Chrome asks for access to the website(s) listed, then this tab carries on to exactly where it was going, now with the persona’s own login there.',
    touches: 'Only grants Tabsona access: tabs that are not in a persona keep your normal browser login on that website.',
  },
  openNormally: {
    label: 'Open in a normal tab',
    what: 'Opens the website in a new ordinary tab, signed in as you, and puts this persona tab back on the page it was on.',
    touches: 'Nothing is allowed and the persona is unchanged. The new tab is not part of any persona.',
  },
  startOver: {
    label: 'Start over signed out',
    what: 'Clears this persona’s login and saved page data for the site, then reloads its tabs signed out so you can sign in again — this time Tabsona asks before any website it is not allowed on.',
    touches: 'Your normal browser login and every other persona are untouched.',
  },
  useNormalGoogleLogin: {
    label: 'Use my normal Google login here',
    what: 'Google’s own sign-in pages open the way they do in any other tab: you pick the Google account in Google’s account chooser. Then the tab carries on to exactly where it was going.',
    touches: 'Only Google’s sign-in websites use your normal browser login. The app’s own login stays separate for this persona. Google itself, though, is shared with your other tabs: an account you add there is added to your browser too.',
    gotcha: 'Pick the account you want in the chooser. Two personas get different Google accounts only if you pick different ones.',
  },
  useNormalLogin: {
    label: 'Use my normal login here',
    what: 'This website opens with your normal browser login, as it would in any other tab, instead of the persona’s own. Then the tab carries on to exactly where it was going.',
    touches: 'Only this website. The persona’s login on its own websites stays separate.',
    gotcha: 'This website cannot tell the persona from you: whatever it signs in, your other tabs see too. Remove it in Settings at any time.',
  },
  addGoogleSignInSites: {
    label: 'Restore default sites',
    what: 'Adds back accounts.google.com and accounts.youtube.com, the two websites Google signs you in through, to the list of websites that use your normal login. Only the ones missing are added; your own entries are not touched.',
    touches: 'A persona tab then signs in to Google the way any tab does and lets you pick the account. The app’s own login stays separate per persona.',
    gotcha: 'Google’s login is shared with your browser: an account added in a persona tab is added to your other tabs too.',
  },
  addNormalLogin: {
    label: 'Add',
    what: 'Adds a website to the list that uses your normal login, even from a persona tab. Type its address, such as accounts.google.co.in.',
    touches: 'Only that website. Everything else in the persona stays separate.',
  },
  removeNormalLogin: {
    label: 'Remove from list',
    what: 'Takes this website off the list. A persona tab then keeps its own login there again, or stops and asks first.',
    touches: 'Your normal browser login is not changed.',
  },
  allowAllSites: {
    label: 'Allow on all sites',
    what: 'Chrome asks once to let Tabsona work on every website. From then on a persona keeps its login separate wherever its tabs go, including the sign-in websites an app sends you through, with no prompt per website.',
    touches: 'Tabs that are not in a persona do not change: they keep your normal browser login everywhere. A persona tab, though, never sends your normal login to ANY website, so a Google, GitHub or other link it follows starts signed out in that tab.',
    gotcha: 'Chrome words it as “read and change all your data on all websites”. Tabsona sends nothing anywhere and leaves tabs outside a persona alone: its page script loads there but changes nothing. You can remove it in Settings at any time.',
  },
  removeAllSites: {
    label: 'Remove',
    what: 'Takes back “all websites”. Tabsona then works only on the websites you allowed one by one, which stay allowed.',
    touches: 'A persona tab that is about to visit a website you have not allowed stops and asks you first, so nothing is sent as you. The tab shows a question page with a button to allow it and carry on.',
  },
  chooseSitesMyself: {
    label: 'I’ll choose sites myself',
    what: 'Allow websites only as they come up. When a persona tab is about to visit a website you have not allowed, it stops and asks you, right in that tab, before anything is sent.',
    touches: 'Nothing is allowed yet. Each question has Allow and continue (it remembers a sign-in that passes through several websites and asks for all of them at once), Open in a normal tab, and Allow on all sites. This question is not asked again; the choice stays in Settings.',
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
  /** The tab is on a website the user chose to reach with their normal login. */
  readonly usesNormalLogin?: boolean;
}): ActionHelp {
  if (status.usesNormalLogin) {
    return {
      label: 'Uses your normal login',
      what: 'This website is on your “use my normal login” list, so this persona tab opens it with your browser’s own login, by your choice. Nothing is kept separate here.',
      touches: 'The persona’s login on its own websites stays separate. Whatever this website signs in is shared with your other tabs.',
      gotcha: 'Remove the website in Settings if you want it separate again.',
    };
  }
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

/** The library page's sections and settings groups that carry an ⓘ. A closed set, so a
 *  section added to the page without an explanation fails to compile where it is used. */
/**
 * What "not separated" means on a sign-in website, in full — the popover behind the
 * short line, which a narrow popup truncated to "not sep…" with no way to read the rest.
 */
export const SIGN_IN_NOT_SEPARATED: ActionHelp = {
  label: 'Sign-in not separated',
  what: 'This persona’s website sends you to another website to sign in (an SSO provider such as WorkOS, Auth0 or Google). Tabsona is not allowed on that website, so it cannot keep the persona’s login there apart from yours.',
  touches: 'A persona tab stops before it goes there and asks you in the tab. This list is the fallback for what that stop cannot catch: a sign-in that happens inside the page (a frame or a background request) uses your normal login on that website.',
  gotcha: 'Allow these websites (Allow only grants access; it opens no tab). A login that already came back through one is not saved: the persona offers Start over signed out.',
};

/** The current-tab warning for a session whose sign-in went through an unguarded website:
 *  the login was refused, and the persona is not signed in as itself until it starts over. */
export const SIGN_IN_LEAKED: ActionHelp = {
  label: 'Signed in through an unprotected website',
  what: 'This persona’s sign-in passed through a website Tabsona was not allowed on, which may have signed it in as your normal browser login. Tabsona did not save that login.',
  touches: 'Start over signs this persona out on the site and lets it sign in again, stopping before any website Tabsona is not allowed on.',
};

export type ExplainId =
  | 'personas' | 'sites' | 'coverage' | 'data'
  | 'settingsBadge' | 'settingsTitles' | 'settingsTabs' | 'settingsSites' | 'settingsNormalLogin' | 'welcome';

/**
 * What each part of the library page is for, in the same three-question shape as
 * ACTION_HELP: what it is, what it does to your logins, and the one thing to watch.
 * Shown behind the ⓘ beside each section title.
 */
export const EXPLAIN: Readonly<Record<ExplainId, ActionHelp>> = {
  personas: {
    label: 'Personas',
    what: 'A persona is one identity, like “Acme admin”, with one saved login per website. Opening it opens every one of its websites in its own tabs, already signed in.',
    touches: 'Personas live only in this browser. Nothing is sent anywhere.',
  },
  sites: {
    label: 'Allowed websites',
    what: 'Tabsona only works on websites you allow: every website at once (Settings → Allow on all sites), or one by one from the popup or the box below. Chrome shows its own prompt each time, so it always takes your click.',
    touches: 'Removing a website here stops Tabsona working there. Saved logins for it are kept.',
  },
  coverage: {
    label: 'What is kept separate',
    what: 'For each website, which kinds of saved data Tabsona actually kept separate per persona — measured on real pages, never assumed.',
    touches: 'Covered: kept separate. Leaking: shared with the website’s other tabs. Unknown: not seen in use yet.',
    gotcha: 'A website showing “Leaking” may let one persona’s tab affect another’s.',
  },
  data: {
    label: 'Back up and restore',
    what: 'Export saves every persona and its logins to a file. Import adds them back, merging with what is already here.',
    touches: 'Importing never deletes anything you already have.',
    gotcha: 'The file holds working logins. Keep it somewhere private.',
  },
  settingsBadge: {
    label: 'Badge on pages',
    what: 'The small label on every persona tab, saying whose tab it is and whether it is fully separate. You can move it, shrink it to a dot, or let it hide itself.',
    touches: 'It only shows information. It never changes a login.',
  },
  settingsTitles: {
    label: 'Page titles',
    what: 'Puts the persona’s coloured heart in front of each tab’s title, so the tab strip shows whose tab is whose even when the badge is hidden.',
    touches: 'Only the tab title changes. Nothing is sent to the website.',
  },
  settingsSites: {
    label: 'Websites',
    what: 'Where Tabsona may work. “Allow on all sites” covers every website with one Chrome prompt, so an app that signs in through other websites (WorkOS, Auth0, Google) is separated end to end. Without it, you allow websites one by one.',
    touches: 'With it on, a persona tab never sends your normal browser login to ANY website, including Google or GitHub pages it goes to: each starts signed out in that tab. Tabs outside a persona are not changed.',
    gotcha: 'Removing it keeps every website you allowed one by one.',
  },
  welcome: {
    label: 'Let Tabsona keep logins separate on every website?',
    what: 'Many apps sign you in through another website (WorkOS, Auth0, Google). Tabsona can only keep a persona’s login separate on websites Chrome lets it touch, so allowing every website once means a persona never comes back signed in as you through one of them.',
    touches: 'Tabs outside a persona keep your normal login everywhere. Inside a persona tab, every website starts signed out, so a Google or GitHub link there asks you to sign in again.',
    gotcha: 'Prefer to decide per website? Choose sites yourself: the popup asks when an app’s sign-in needs another website. Either way, Settings can change it later.',
  },
  settingsNormalLogin: {
    label: 'Use my normal login on',
    what: 'Websites a persona tab reaches with your browser’s own login, even though everything else in the persona is kept separate. Meant for sign-in providers such as Google, which cannot sign in from a separate login: the persona’s own website still gets its own login.',
    touches: 'On these websites a persona tab is not separate. Google lets you pick the account, and an account added there is added to your browser too. Nothing is on the list until you add it.',
    gotcha: 'Listed websites are the only ones affected. The badge on them says “uses your normal login”, never “separate”.',
  },
  settingsTabs: {
    label: 'Tabs',
    what: 'How a persona’s tabs are arranged. With “Open tabs in a tab group” on, every way a tab joins a persona (Open all, opening one site, another login, adding a site, using this tab or moving its login) puts it in that persona’s Chrome tab group, joining the one already open in the window. Off, tabs open individually. Optionally, Open all uses a window of its own.',
    touches: 'Arrangement only. Logins are not affected.',
  },
};
