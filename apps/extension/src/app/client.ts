// The ONLY module in the UI layer that names `chrome.*`.
//
// Everything above it is a plain React component taking props and emitting events, so
// a presenter can be rendered in a test with no browser extension around it and no
// `vi.mock` of a module path. A boundary test enforces this; it is not a convention.

import type {
  AppState, OriginCoverage, Request, Response, BadgeCorner, OptionsSection, SettingKey, SettingsPatch, TabStatus,
} from '@/domain/messages';
import type { PersonaId, SessionId, TabId } from '@/domain/types';

async function send(req: Request): Promise<Response> {
  const res = (await chrome.runtime.sendMessage(req)) as Response | undefined;
  return res ?? { ok: false, error: 'the extension did not respond' };
}

/** A failed call's message, or null on success. Keeps every caller's shape identical. */
function errorOf(res: Response): string | null {
  if (res.ok) return null;
  if ('needsConfirm' in res) return null; // not a failure — the caller must ask
  return res.error;
}

/**
 * The result of a call that may need the user to decide something.
 *
 * `confirm-replace` is modelled separately from `error` on purpose: overwriting a saved
 * login is destructive, and folding it in with genuine failures would make it one
 * indistinguishable message among many.
 */
export type CallResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'confirm-replace'; readonly site: string };

function toResult(res: Response): CallResult {
  if (res.ok) return { kind: 'ok' };
  if ('needsConfirm' in res) return { kind: 'confirm-replace', site: res.site };
  return { kind: 'error', message: res.error };
}

/**
 * The typed façade over the service worker, and the ONLY module in the UI layer that
 * names `chrome.*`. A boundary test enforces that; see core/__tests__/boundaries.test.ts.
 */
export const client = {
  async getState(): Promise<AppState | null> {
    const res = await send({ op: 'getState' });
    return res.ok && 'state' in res ? res.state : null;
  },

  async tabStatus(tabId: TabId): Promise<TabStatus | null> {
    const res = await send({ op: 'tabStatus', tabId });
    return res.ok && 'status' in res ? res.status : null;
  },

  async coverageReport(): Promise<readonly OriginCoverage[]> {
    const res = await send({ op: 'coverageReport' });
    return res.ok && 'report' in res ? res.report : [];
  },

  createPersona: (name: string) => send({ op: 'createPersona', name }).then(errorOf),
  /** Patch a persona. Omit a field to leave it alone; pass '' to clear a description. */
  updatePersona: (personaId: PersonaId, patch: { name?: string; description?: string; color?: string }) =>
    send({ op: 'updatePersona', personaId, ...patch }).then(errorOf),
  deletePersona: (personaId: PersonaId) => send({ op: 'deletePersona', personaId }).then(errorOf),
  duplicatePersona: (personaId: PersonaId) => send({ op: 'duplicatePersona', personaId }).then(errorOf),
  openPersona: (personaId: PersonaId) => send({ op: 'openPersona', personaId }).then(errorOf),

  openSession: (sessionId: SessionId, where: 'new-tab' | 'this-tab') =>
    send({ op: 'openSession', sessionId, where }).then(errorOf),
  renameSession: (sessionId: SessionId, label: string) =>
    send({ op: 'renameSession', sessionId, label }).then(errorOf),
  deleteSession: (sessionId: SessionId) => send({ op: 'deleteSession', sessionId }).then(errorOf),
  moveSession: (sessionId: SessionId, toPersonaId: PersonaId) =>
    send({ op: 'moveSession', sessionId, toPersonaId }).then(toResult),

  /**
   * Import the current tab's login. `move` takes it out of the browser; `copy` leaves
   * the browser signed in too, at the cost of sharing one server-side session.
   * May need a confirmation when the persona already holds that site.
   */
  saveCurrentTab: (personaId: PersonaId, mode: 'move' | 'copy', replace = false) =>
    send({ op: 'saveCurrentTab', personaId, mode, replace }).then(toResult),

  /** Put the current tab into a persona with a BLANK session — nothing is imported. */
  useTabIn: (personaId: PersonaId) => send({ op: 'useTabIn', personaId }).then(errorOf),

  addSite: (personaId: PersonaId, url: string) => send({ op: 'addSite', personaId, url }).then(errorOf),

  /** A second (or third) login for a site that already has one. */
  anotherLogin: (url: string) => send({ op: 'anotherLogin', url }).then(errorOf),
  saveNow: (tabId: TabId) => send({ op: 'saveNow', tabId }).then(errorOf),
  unbindTab: (tabId: TabId) => send({ op: 'unbindTab', tabId }).then(errorOf),
  setSetting: (key: SettingKey, value: boolean) => send({ op: 'setSetting', key, value }).then(errorOf),
  setBadgePosition: (position: BadgeCorner) => send({ op: 'setBadgePosition', position }).then(errorOf),
  resetBadgePlacements: () => send({ op: 'resetBadgePlacements' }).then(errorOf),
  updateSettings: (patch: SettingsPatch) => send({ op: 'updateSettings', patch }).then(errorOf),
  exportData: async (): Promise<string | null> => {
    const res = await send({ op: 'exportData' });
    return res.ok && 'json' in res ? res.json : null;
  },
  importData: (json: string) => send({ op: 'importData', json }).then(errorOf),

  /**
   * Ask Chrome for access to an origin.
   *
   * MUST be called straight from a click handler: Chrome rejects
   * `permissions.request` without a user gesture, and the service worker can never
   * supply one. It then shows its own confirmation dialog, which the user clicks — a
   * step that cannot be automated and should not be hidden.
   */
  async grantOrigin(origin: string): Promise<boolean> {
    try {
      return await chrome.permissions.request({ origins: [`${origin.replace(/\/$/, '')}/*`] });
    } catch { return false; }
  },

  async revokeOrigin(pattern: string): Promise<boolean> {
    try { return await chrome.permissions.remove({ origins: [pattern] }); }
    catch { return false; }
  },

  /**
   * Open the full library, on a given section. Reuses an already-open library tab so
   * repeated clicks do not pile up tabs; the section travels in the URL hash, which the
   * page follows live (Options listens for `hashchange`).
   */
  async openOptions(section: OptionsSection = 'personas'): Promise<void> {
    const base = chrome.runtime.getURL('src/surfaces/options/index.html');
    const url = `${base}#${section}`;
    // A pattern Chrome rejects must not stop the library from opening: fall back to a new tab.
    const [existing] = await chrome.tabs.query({ url: `${base}*` }).catch(() => []);
    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, { url, active: true });
      if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
  },

  /** Download a blob the user asked for, without needing the downloads permission. */
  downloadText(filename: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
