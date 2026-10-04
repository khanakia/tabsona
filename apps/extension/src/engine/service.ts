// Orchestration: the operations the surfaces call, in the order that actually works.

import { STORAGE_CAPTURE_INTERVAL_MS } from '@/core/constants';
import { withSessionMarker } from '@/core/namespace';
import { applyCookies } from '@/core/cookies';
import {
  createPersona, createSession, duplicatePersona as clonePersona,
  nameForAnotherLogin, sessionForSite, siteOf, toPersonaViews,
  isPaletteColor,
} from '@/core/personas';
import { computeCoverage } from '@/core/coverage';
import {
  loadBindings, loadLibrary, loadSettings, mutateLibrary, mutateSession,
  saveBindings, saveLibrary, withLock,
} from './repo';
import { awaitRuleForTab, syncRules } from './rules-sync';
import { awaitShim, captureTabStorage, restoreTabStorage } from './storage';
import { hasCredentials, importLoginFromTab, type ImportedLogin } from './import';
import { groupTabsForPersona, restyleGroupsForPersona } from './tabgroups';
import { renderAllBadges, renderBadge, statusForTab } from './badge';
import { grantedOriginPatterns } from './permissions';
import { observationsFor, observedOrigins } from './observations';
import type { AppState, OriginCoverage, Response } from '@/domain/messages';
import type { PersonaId, Session, SessionId, TabId } from '@/domain/types';

/** Shown instead of navigating when a tab's cookie rule cannot be confirmed. Opening a
 *  tab that would silently leak is worse than refusing to open one. */
const REFUSED_PAGE = `data:text/html,${encodeURIComponent(
  '<title>Not isolated</title><body style="font:14px system-ui;padding:24px">'
  + '<h3>Refused to open this tab</h3><p>The per-tab cookie rule could not be confirmed, '
  + 'so this tab would have leaked the shared login. Nothing was navigated.</p>')}`;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// --- reading ----------------------------------------------------------------

export async function getState(): Promise<AppState> {
  const [lib, bindings, settings, origins] = await Promise.all([
    loadLibrary(), loadBindings(), loadSettings(), grantedOriginPatterns(),
  ]);
  const tab = await activeTab();
  return {
    personas: toPersonaViews(lib.personas, lib.sessions, bindings),
    tab: await statusForTab(tab?.id ?? null),
    allowedOrigins: origins,
    settings,
  };
}

export function coverageReport(): OriginCoverage[] {
  return observedOrigins().map((origin) => ({
    origin,
    coverage: computeCoverage('cookie+storage', observationsFor(origin)),
  }));
}

// --- personas ---------------------------------------------------------------

export async function newPersona(name: string): Promise<PersonaId> {
  return mutateLibrary((lib) => {
    const persona = createPersona({ name, existingCount: lib.personas.length });
    lib.personas.push(persona);
    return persona.id;
  });
}

/**
 * Patch a persona's editable fields.
 *
 * A blank NAME falls back to the existing one, because a persona with no name is
 * unusable; a blank DESCRIPTION is kept, because clearing it is a legitimate edit.
 * Distinguishing "not supplied" from "supplied as empty" is the whole reason both
 * fields are optional rather than nullable.
 */
/** The editable fields of a persona. Every field optional: a patch changes only what it names. */
export interface PersonaPatch {
  name?: string;
  description?: string;
  /** Must be a palette hex; anything else is ignored rather than stored. */
  color?: string;
}

/**
 * Edit a persona, then make every open tab of it reflect the change at once — the tab
 * group's name and colour, and each page's badge and title marker — so a recolour is
 * not something that shows up only after the next reload.
 */
export async function updatePersona(personaId: PersonaId, patch: PersonaPatch): Promise<void> {
  const updated = await mutateLibrary((lib) => {
    const p = lib.personas.find((x) => x.id === personaId);
    if (!p) return null;
    if (patch.name !== undefined) p.name = patch.name.trim() || p.name;
    if (patch.description !== undefined) p.description = patch.description.trim();
    if (patch.color !== undefined && isPaletteColor(patch.color)) p.color = patch.color.toLowerCase();
    const sessionIds = new Set(lib.sessions.filter((s) => s.personaId === personaId).map((s) => s.id));
    return { persona: { ...p }, sessionIds };
  });
  if (!updated) return;
  const bindings = await loadBindings();
  const tabIds = Object.entries(bindings)
    .filter(([, sessionId]) => updated.sessionIds.has(sessionId))
    .map(([tabId]) => Number(tabId));
  await restyleGroupsForPersona(updated.persona, tabIds);
  await renderAllBadges();
}

/** Deleting a persona takes its sessions and their tab bindings with it, or orphaned
 *  rules would outlive the thing they belong to. */
export async function deletePersona(personaId: PersonaId): Promise<void> {
  await withLock(async () => {
    const lib = await loadLibrary();
    const doomed = new Set(lib.sessions.filter((s) => s.personaId === personaId).map((s) => s.id));
    lib.personas = lib.personas.filter((p) => p.id !== personaId);
    lib.sessions = lib.sessions.filter((s) => s.personaId !== personaId);
    await saveLibrary(lib);

    const bindings = { ...(await loadBindings()) };
    for (const [tabId, sessionId] of Object.entries(bindings)) {
      if (doomed.has(sessionId)) delete bindings[tabId];
    }
    await saveBindings(bindings);
  });
  await syncRules();
}

export async function duplicatePersona(personaId: PersonaId, name?: string): Promise<PersonaId | null> {
  return mutateLibrary((lib) => {
    const source = lib.personas.find((p) => p.id === personaId);
    if (!source) return null;
    const { persona, sessions } = clonePersona(source, lib.sessions, {
      ...(name === undefined ? {} : { name }),
      existingCount: lib.personas.length,
    });
    lib.personas.push(persona);
    lib.sessions.push(...sessions);
    return persona.id;
  });
}

// --- sessions ---------------------------------------------------------------

export async function renameSession(sessionId: SessionId, label: string): Promise<void> {
  await mutateSession(sessionId, (s) => { s.label = label.trim() || s.label; });
}

export async function deleteSession(sessionId: SessionId): Promise<void> {
  await withLock(async () => {
    const lib = await loadLibrary();
    lib.sessions = lib.sessions.filter((s) => s.id !== sessionId);
    await saveLibrary(lib);
    const bindings = { ...(await loadBindings()) };
    for (const [tabId, id] of Object.entries(bindings)) if (id === sessionId) delete bindings[tabId];
    await saveBindings(bindings);
  });
  await syncRules();
}

/** Moving a session respects the one-per-site rule in the destination. */
export async function moveSession(sessionId: SessionId, toPersonaId: PersonaId): Promise<Response> {
  return mutateLibrary((lib): Response => {
    const session = lib.sessions.find((s) => s.id === sessionId);
    if (!session) return { ok: false, error: 'no such session' };
    const clash = sessionForSite(lib.sessions, toPersonaId, session.site);
    if (clash && clash.id !== sessionId) {
      return { ok: false, needsConfirm: 'replace-session', site: session.site };
    }
    session.personaId = toPersonaId;
    return { ok: true };
  });
}

// --- the four verbs ---------------------------------------------------------

async function bind(tabId: TabId, sessionId: SessionId): Promise<void> {
  await withLock(async () => {
    const bindings = { ...(await loadBindings()) };
    bindings[String(tabId)] = sessionId;
    await saveBindings(bindings);
  });
  await syncRules();
}

export async function unbindTab(tabId: TabId): Promise<void> {
  await captureTabStorage(tabId).catch(() => false);
  await withLock(async () => {
    const bindings = { ...(await loadBindings()) };
    delete bindings[String(tabId)];
    await saveBindings(bindings);
  });
  await syncRules();
  await renderBadge(tabId);
}

/**
 * Put an existing tab into a session and navigate it there correctly.
 *
 * Shared by every verb, because getting ANY step out of order produces partial
 * isolation, which is worse than none:
 *
 *  1. capture the OUTGOING session's storage, or moving a tab discards everything it
 *     stored since the last periodic capture
 *  2. bind, install the rule, and CONFIRM it — measured: without confirmation a first
 *     request leaves rule-less, rides the shared jar, and the tab arrives already
 *     signed in, after which isolation never recovers for that tab
 *  3. bounce through about:blank to force a REAL document load. Changing only the
 *     `#fragment` of the same URL is a same-document navigation, so the MAIN-world
 *     shim never re-runs and keeps the PREVIOUS namespace — cookies move, storage
 *     does not
 *  4. navigate carrying the session marker, restore the slice, reload so the app boots
 *     with its tokens
 */
async function enterSession(tabId: TabId, sessionId: SessionId, url: string): Promise<TabId | null> {
  const bindings = await loadBindings();
  const previous = bindings[String(tabId)];
  if (previous && previous !== sessionId) {
    await captureTabStorage(tabId).catch(() => false);
  }

  await bind(tabId, sessionId);
  if (!await awaitRuleForTab(tabId)) return null;

  await chrome.tabs.update(tabId, { url: 'about:blank' });
  await waitForTabIdle(tabId);

  const target = new URL(url);
  await chrome.tabs.update(tabId, { url: withSessionMarker(target.toString(), sessionId) });

  if (await awaitShim(tabId)) {
    const restored = await restoreTabStorage(tabId, sessionId, target.origin);
    if (restored) await chrome.tabs.reload(tabId);
  }

  await mutateSession(sessionId, (s) => { s.lastUsedAt = Date.now(); });
  return tabId;
}

async function waitForTabIdle(tabId: TabId): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || tab.status === 'complete') return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** VERB: open a session — in a new tab, or in the one the user is looking at. */
export async function openSession(
  sessionId: SessionId,
  where: 'new-tab' | 'this-tab',
): Promise<TabId> {
  const lib = await loadLibrary();
  const session = lib.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error('no such session');

  let tabId: TabId;
  if (where === 'this-tab') {
    const tab = await activeTab();
    if (tab?.id === undefined) throw new Error('no active tab');
    tabId = tab.id;
  } else {
    // Park on about:blank so the tab has an id to bind BEFORE it requests the origin.
    const created = await chrome.tabs.create({ url: 'about:blank', active: true });
    if (created.id === undefined) throw new Error('Chrome did not return a tab id');
    tabId = created.id;
  }

  const entered = await enterSession(tabId, sessionId, session.site);
  if (entered === null) {
    await chrome.tabs.update(tabId, { url: REFUSED_PAGE });
    throw new Error('rule not confirmed; refused to navigate');
  }
  await mutateLibrary((l) => {
    const p = l.personas.find((x) => x.id === session.personaId);
    if (p) p.lastUsedAt = Date.now();
  });
  return tabId;
}

/**
 * VERB: open a whole persona — every session as a tab.
 *
 * Sequential, not parallel: each tab's rule must be confirmed before that tab may
 * navigate, and confirmation is what stops leaks. Roughly a second per tab, which is
 * honest rather than fast. Empty sessions open too, signed out, because they are the
 * cue to sign in rather than an error.
 */
export async function openPersona(personaId: PersonaId): Promise<number> {
  const [lib, settings] = await Promise.all([loadLibrary(), loadSettings()]);
  const persona = lib.personas.find((p) => p.id === personaId);
  if (!persona) throw new Error('no such persona');
  const sessions = lib.sessions.filter((s) => s.personaId === personaId);
  if (sessions.length === 0) return 0;

  if (settings.openPersonaInNewWindow) {
    await chrome.windows.create({ url: 'about:blank', focused: true }).catch(() => undefined);
  }

  const opened: TabId[] = [];
  for (const session of sessions) {
    const created = await chrome.tabs.create({ url: 'about:blank', active: false });
    if (created.id === undefined) continue;
    const entered = await enterSession(created.id, session.id, session.site);
    if (entered === null) {
      await chrome.tabs.update(created.id, { url: REFUSED_PAGE }).catch(() => undefined);
      continue;
    }
    opened.push(created.id);
  }

  if (settings.useTabGroups) await groupTabsForPersona(persona, opened);
  await mutateLibrary((l) => {
    const p = l.personas.find((x) => x.id === personaId);
    if (p) p.lastUsedAt = Date.now();
  });
  return opened.length;
}

/**
 * VERB: save the CURRENT tab's login into a persona — by MOVING it, not copying it.
 *
 * THE BUG THIS SHAPE FIXES, in the user's words: "I'm signed in on site1.com and added
 * it to group 1. If I open site1.com in a normal tab it's already logged in as the same
 * session — so if I log out there, group 1 is logged out too."
 *
 * Exactly so. A copy leaves ONE server-side session shared between the browser's own jar
 * and the persona: signing out anywhere invalidates it everywhere and the saved persona
 * silently becomes worthless. "Added to group 1" has to mean it now LIVES in group 1.
 *
 * Nothing is lost by moving: the credentials are already in the persona, and the tab the
 * user is looking at is re-entered into that persona, so it stays signed in.
 *
 * Refuses rather than filing an empty session: a hollow entry the user later finds
 * useless costs more trust than an honest "nothing to save here".
 */
export async function saveCurrentTab(
  personaId: PersonaId,
  mode: 'move' | 'copy' = 'move',
  replace = false,
): Promise<Response> {
  const tab = await activeTab();
  if (tab?.id === undefined) return { ok: false, error: 'no active tab' };
  const tabId = tab.id;

  const login = await importLoginFromTab(tabId);
  if (!login) return { ok: false, error: 'this page cannot hold a login' };
  if (!hasCredentials(login)) {
    return { ok: false, error: 'no cookies or stored data found — are you signed in here?' };
  }

  const site = siteOf(login.site);
  if (!site) return { ok: false, error: 'not an http(s) site' };

  const result = await mutateLibrary((lib): Response => {
    const persona = lib.personas.find((p) => p.id === personaId);
    if (!persona) return { ok: false, error: 'no such persona' };

    const existing = sessionForSite(lib.sessions, personaId, site);
    if (existing && !replace) return { ok: false, needsConfirm: 'replace-session', site };

    const target: Session = existing ?? createSession({
      personaId, site, label: login.title || site,
    });
    target.cookies = applyCookies([], login.cookies);
    target.storage = { [login.origin]: { local: login.local, session: login.session } };
    target.domains = [...new Set([...login.domains, new URL(site).hostname])].sort();
    target.label = login.title || target.label;
    target.savedAt = Date.now();
    target.lastUsedAt = Date.now();
    if (!existing) lib.sessions.push(target);
    persona.lastUsedAt = Date.now();
    return { ok: true, sessionId: target.id };
  });

  if (!result.ok || !('sessionId' in result)) return result;

  if (mode === 'move') {
    // Take it out of the shared jar, then put this tab inside the persona so the user
    // stays signed in — now as the persona rather than as the browser.
    await clearSharedLogin(tabId, login);
    await enterSession(tabId, result.sessionId, site);
  }
  // `copy` deliberately touches neither: the browser keeps its login and this tab stays
  // plain. The two then share ONE server-side session, so signing out in either kills
  // both — which is why the caller has to ask for it rather than get it by default.

  return result;
}

/**
 * Remove an origin's login from the BROWSER's own jar and page storage.
 *
 * Deletes cookies BY NAME from the set the import just discovered: `chrome.cookies`
 * cannot be enumerated on Chrome 154 (`getAll` returns [] for every filter), so there is
 * no list to iterate. Removing only what was imported is also the right scope — a cookie
 * this origin holds that the tab was not sending is none of our business.
 */
async function clearSharedLogin(tabId: TabId, login: ImportedLogin): Promise<void> {
  // Build the removal URL from the ORIGIN the tab is on, not from the cookie's domain.
  // A cookie records no port, so `http://${c.domain}${c.path}` loses it — and
  // `http://localhost/` does not address a cookie stored for `localhost:8787`. Chrome
  // then reports no error and the cookie quietly survives, which is how this looked
  // fixed while a fresh tab was still signed in.
  const results = await Promise.all(login.cookies.map(async (c) => {
    const url = `${login.origin}${c.path}`;
    await chrome.cookies.remove({ url, name: c.name }).catch(() => null);
    // Confirm, because a silent failure here leaves the session shared — the exact bug
    // this function exists to prevent. `get` works where `getAll` does not.
    const survivor = await chrome.cookies.get({ url, name: c.name }).catch(() => null);
    return survivor === null ? null : c.name;
  }));

  const stubborn = results.filter((name): name is string => name !== null);
  if (stubborn.length > 0) {
    console.warn('[tabsona] could not clear from the shared jar:', stubborn.join(', '));
  }

  // The page's real, un-namespaced storage. Safe to wipe: this tab has no shim yet, so
  // what it holds is the browser's own copy, which the persona now owns.
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      try { window.localStorage.clear(); } catch { /* blocked */ }
      try { window.sessionStorage.clear(); } catch { /* blocked */ }
    },
  }).catch(() => undefined);
}

/**
 * VERB: use the CURRENT tab in a persona, with a blank session.
 *
 * The primary way to build a persona, and the one that leaves everything else alone:
 * this tab joins the persona signed OUT, you sign in there, and the browser's own login
 * — and any other plain tab using it — is untouched.
 *
 * Distinct from `saveCurrentTab`, which imports what you are already signed in as.
 */
export async function useTabIn(personaId: PersonaId): Promise<TabId> {
  const tab = await activeTab();
  if (tab?.id === undefined || !tab.url) throw new Error('no active tab');
  const site = siteOf(tab.url);
  if (!site) throw new Error('not an http(s) site');

  const sessionId = await mutateLibrary((lib) => {
    const existing = sessionForSite(lib.sessions, personaId, site);
    if (existing) return existing.id;
    const created = createSession({ personaId, site });
    lib.sessions.push(created);
    return created.id;
  });

  // Keep the exact page the user is on, not just the origin.
  const entered = await enterSession(tab.id, sessionId, tab.url);
  if (entered === null) throw new Error('rule not confirmed; refused to navigate');
  return tab.id;
}

/**
 * VERB: another login for a site you already have one for.
 *
 * Two logins for one site means two personas — that is the model. But the user is
 * standing at a session row thinking "I need a second account here", and making them
 * create a persona, find a tab on the right site and press + is a path nobody guesses.
 * This is that whole journey in one action: a new persona, named after the site, holding
 * one empty session, opened signed out and ready to sign in.
 */
export async function anotherLoginForSite(url: string, name?: string): Promise<TabId> {
  const site = siteOf(url);
  if (!site) throw new Error('not an http(s) site');

  const { personaId, sessionId } = await mutateLibrary((lib) => {
    const persona = createPersona({
      name: name?.trim() || nameForAnotherLogin(site, lib.personas, lib.sessions),
      existingCount: lib.personas.length,
    });
    const session = createSession({ personaId: persona.id, site });
    lib.personas.push(persona);
    lib.sessions.push(session);
    return { personaId: persona.id, sessionId: session.id };
  });

  void personaId;
  return openSession(sessionId, 'new-tab');
}

/** VERB: add a site to a persona — opens a signed-out tab so the user can sign in. */
export async function addSite(personaId: PersonaId, url: string): Promise<TabId> {
  const site = siteOf(url);
  if (!site) throw new Error('not an http(s) site');

  const sessionId = await mutateLibrary((lib) => {
    const existing = sessionForSite(lib.sessions, personaId, site);
    if (existing) return existing.id;
    const created = createSession({ personaId, site });
    lib.sessions.push(created);
    return created.id;
  });

  return openSession(sessionId, 'new-tab');
}

// --- data -------------------------------------------------------------------

export async function exportData(): Promise<string> {
  const lib = await loadLibrary();
  return JSON.stringify({ version: 2, exportedAt: Date.now(), ...lib }, null, 2);
}

export async function importData(json: string): Promise<Response> {
  let parsed: { personas?: unknown; sessions?: unknown };
  try { parsed = JSON.parse(json) as typeof parsed; }
  catch { return { ok: false, error: 'that file is not valid JSON' }; }
  if (!Array.isArray(parsed.personas) || !Array.isArray(parsed.sessions)) {
    return { ok: false, error: 'that file is not a Tabsona export' };
  }
  // Merged, not replaced: an import must never silently delete what is already there.
  await mutateLibrary((lib) => {
    const known = new Set(lib.personas.map((p) => p.id));
    for (const p of parsed.personas as typeof lib.personas) if (!known.has(p.id)) lib.personas.push(p);
    const knownSessions = new Set(lib.sessions.map((s) => s.id));
    for (const s of parsed.sessions as typeof lib.sessions) if (!knownSessions.has(s.id)) lib.sessions.push(s);
  });
  return { ok: true };
}

/** Periodic capture, so a crash loses at most one interval of a session. */
export function startPeriodicCapture(): void {
  setInterval(() => {
    void (async () => {
      const bindings = await loadBindings();
      for (const tabId of Object.keys(bindings)) {
        await captureTabStorage(Number(tabId)).catch(() => false);
      }
    })();
  }, STORAGE_CAPTURE_INTERVAL_MS);
}
