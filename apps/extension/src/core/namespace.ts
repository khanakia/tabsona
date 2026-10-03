// How a session's storage namespace is derived, and how a tab learns which session
// it belongs to. Pure; imports the domain model and constants only.

import { NAMESPACE_SEPARATOR, SESSION_MARKER } from './constants';
import type { SessionId } from '@/domain/types';

/**
 * The prefix every storage key of a session is written under.
 *
 * KEYED BY SESSION, NOT BY TAB — this is the single decision that makes save and
 * restore possible. Every shipped extension examined stores its namespace in
 * `sessionStorage`, which is per-tab by nature, so the namespace dies with the tab
 * and a restored session can never find the app's tokens again. Here the namespace
 * is a pure function of the session id, so any tab bound to that session resolves
 * to the same storage.
 */
export function namespacePrefix(sessionId: SessionId): string {
  return `${sessionId}${NAMESPACE_SEPARATOR}`;
}

/** True when a raw storage key belongs to this session. */
export function isOwnKey(rawKey: string, sessionId: SessionId): boolean {
  return rawKey.startsWith(namespacePrefix(sessionId));
}

/** Strip the namespace, giving the key as the app believes it to be. */
export function unqualify(rawKey: string, sessionId: SessionId): string | null {
  const prefix = namespacePrefix(sessionId);
  return rawKey.startsWith(prefix) ? rawKey.slice(prefix.length) : null;
}

/** Add the namespace, giving the key as it is really stored. */
export function qualify(appKey: string, sessionId: SessionId): string {
  return `${namespacePrefix(sessionId)}${appKey}`;
}

/**
 * Attach the session marker to a URL's hash so the shim can resolve its session
 * synchronously at `document_start`.
 *
 * The hash is used because it is never sent to the server and is available to the
 * shim before any app script runs. The shim strips it immediately so an app's
 * router never sees a fragment it does not understand.
 */
export function withSessionMarker(url: string, sessionId: SessionId): string {
  const u = new URL(url);
  const existing = u.hash.replace(/^#/, '');
  const marker = `${SESSION_MARKER}=${encodeURIComponent(sessionId)}`;
  u.hash = existing ? `${existing}&${marker}` : marker;
  return u.toString();
}

/** Read a session id out of a hash, if the marker is present. */
export function sessionFromHash(hash: string): SessionId | null {
  const m = new RegExp(`(?:^#|^|&)${SESSION_MARKER}=([^&]+)`).exec(hash || '');
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/** Remove the marker from a hash, returning what the app should see. */
export function stripSessionMarker(hash: string): string {
  const cleaned = (hash || '')
    .replace(new RegExp(`(?:^#|&)${SESSION_MARKER}=[^&]*`), '')
    .replace(/^&/, '#');
  return cleaned === '#' ? '' : cleaned;
}
