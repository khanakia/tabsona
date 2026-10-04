// What a session is actually worth, right now.
//
// This exists because the sharpest complaint about v1 was "no way to know which
// session really had any cookies stored at all". Every surface derives its wording
// from here, so the answer is computed once and cannot drift between them.

import { EXPIRY_GRACE_MS } from './constants';
import type { Session, SessionState } from '@/domain/types';

/** Every storage key this session holds, across every origin and area. */
export function storageKeyNames(session: Session): string[] {
  const keys = new Set<string>();
  for (const areas of Object.values(session.storage)) {
    for (const slice of Object.values(areas)) {
      for (const key of Object.keys(slice ?? {})) keys.add(key);
    }
  }
  return [...keys].sort();
}

/** True when nothing has ever been captured. Such a session deliberately starts a tab
 *  SIGNED OUT, which looks broken unless the UI says so. */
export function isEmpty(session: Session): boolean {
  if (session.bearerToken) return false;
  if (session.cookies.length > 0) return false;
  return storageKeyNames(session).length === 0;
}

/**
 * State for display.
 *
 * `expired` means every cookie it had has aged out — the session exists but will not
 * sign you in. Reported separately from `empty` because the remedy differs: an empty
 * session needs a first login, an expired one needs a fresh one.
 *
 * A session whose credentials live only in page storage is `unknown` rather than
 * `signed-in`: tokens there carry no expiry we can read, so claiming it still works
 * would be a guess. Being honest here is the whole point of the state.
 */
export function sessionStateOf(session: Session, now: number = Date.now()): SessionState {
  if (isEmpty(session)) return 'empty';

  const cookies = session.cookies;
  if (cookies.length > 0) {
    const live = cookies.filter((c) => c.expiresAt === null || c.expiresAt > now + EXPIRY_GRACE_MS);
    if (live.length === 0) return 'expired';
    return 'signed-in';
  }

  // Storage-only session (the sync.localhost shape: a JWT in localStorage, no cookie).
  return 'unknown';
}

/** One line of plain English for the row, matching the state exactly. */
export function describeState(view: {
  state: SessionState;
  cookieCount: number;
  storageKeyCount: number;
}): string {
  switch (view.state) {
    case 'empty':
      return 'nothing saved yet — sign in once';
    case 'expired':
      return 'login ended — sign in again';
    case 'signed-in':
    case 'unknown': {
      const parts: string[] = [];
      if (view.cookieCount > 0) parts.push(`${view.cookieCount} cookie${view.cookieCount === 1 ? '' : 's'}`);
      if (view.storageKeyCount > 0) parts.push(`${view.storageKeyCount} key${view.storageKeyCount === 1 ? '' : 's'}`);
      return parts.join(' · ') || 'saved';
    }
    default: {
      const never: never = view.state;
      return String(never);
    }
  }
}
