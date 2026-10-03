// Pure: turn sessions + tab bindings into declarativeNetRequest session rules.
// No chrome.* calls — only the rule OBJECTS, so every decision below is testable.

import { RULE_ID_BASE, RULE_RESOURCE_TYPES } from './constants';
import { serializeCookieHeader } from './cookies';
import type { HeaderEdit, Session, SessionId, TabBindings, TabId, TabRule } from '@/domain/types';

/** Everything needed to decide what every bound tab should send. Passed in rather than
 *  read, so this module stays pure and testable with plain objects. */
export interface RuleInput {
  readonly bindings: TabBindings;
  readonly sessions: Readonly<Record<SessionId, Session>>;
  /** The URL each bound tab is currently on, used to pick the right cookies.
   *  A tab with no known URL still gets a rule — a STRIP rule — because the safe
   *  default is "send nothing" rather than "send the shared jar". */
  readonly tabUrls: Readonly<Record<string, string>>;
  readonly now?: number;
}

/** Rule ids are offset into a reserved band so they cannot collide with any other
 *  rule this extension may add later. Tab ids are unique, so this stays 1:1. */
export function ruleIdForTab(tabId: TabId): number {
  return RULE_ID_BASE + tabId;
}

/**
 * Build one rule per bound tab.
 *
 * Two shapes, and the second is the non-obvious half:
 *
 * - session HAS matching cookies -> `set` the whole Cookie header. DNR cannot
 *   patch a header, only replace it, so the full value is reconstructed per tab.
 * - session has NO matching cookies -> `remove` the Cookie header. Without this the
 *   tab would ride the shared jar's existing login and arrive already signed in,
 *   making a second session impossible.
 *
 * A `token-injection` session additionally sets Authorization, which is the one
 * fully reliable path for apps we control: no jar, no race, no shim.
 */
export function buildSessionRules(input: RuleInput): TabRule[] {
  const now = input.now ?? Date.now();
  const rules: TabRule[] = [];

  for (const [tabIdStr, sessionId] of Object.entries(input.bindings)) {
    const tabId = Number(tabIdStr);
    if (!Number.isInteger(tabId) || tabId < 0) continue;
    const session = input.sessions[sessionId];
    if (!session) continue;

    const url = input.tabUrls[tabIdStr];
    const cookieValue = url ? serializeCookieHeader(session.cookies, url, now) : '';

    const requestHeaders: HeaderEdit[] = [
      cookieValue
        ? { header: 'cookie', operation: 'set', value: cookieValue }
        : { header: 'cookie', operation: 'remove' },
    ];

    if (session.engine === 'token-injection' && session.bearerToken) {
      requestHeaders.push({
        header: 'authorization',
        operation: 'set',
        value: `Bearer ${session.bearerToken}`,
      });
    }

    rules.push({
      id: ruleIdForTab(tabId),
      priority: 1,
      tabId,
      resourceTypes: RULE_RESOURCE_TYPES,
      requestHeaders,
      // STRIP Set-Cookie on the way back.
      //
      // Without this, signing into a session tab ALSO signs the whole browser in: the
      // request rule rewrites what we send, but the response still writes to the shared
      // jar, so a plain tab silently becomes whoever the persona just signed in as.
      // Measured — a plain tab signed in as alice became bob the moment a session tab
      // signed in as bob.
      //
      // Safe for us: the session's own copy comes from observational webRequest, which
      // reads the response independently of what declarativeNetRequest does to it.
      responseHeaders: [{ header: 'set-cookie', operation: 'remove' }],
    });
  }

  return rules;
}
