// Keeps Chrome's live DNR session rules in step with our state, and — critically —
// CONFIRMS a rule exists before anyone navigates.

import {
  RULE_CONFIRM_POLL_MS, RULE_CONFIRM_TIMEOUT_MS, RULE_RESOURCE_TYPES, STRIP_RULE_PRIORITY,
} from '@/core/constants';
import { buildSessionRules, tabRulesMatch } from '@/core/rules';
import { loadBindings, loadLibrary } from './repo';
import type { HeaderEdit, RuleResourceType, TabId, TabRule } from '@/domain/types';

/**
 * Map our string union to chrome's `ResourceType` enum.
 *
 * chrome's enum is a nominal RUNTIME value, so a plain string literal is not
 * assignable to it. This table is the single translation point, which is also why
 * `core/rules.ts` stays a pure function tested in Node with no chrome stub.
 */
const RESOURCE_TYPE: Record<RuleResourceType, chrome.declarativeNetRequest.ResourceType> = {
  main_frame: chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
  sub_frame: chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
  xmlhttprequest: chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
  websocket: chrome.declarativeNetRequest.ResourceType.WEBSOCKET,
  other: chrome.declarativeNetRequest.ResourceType.OTHER,
};

/** The reverse of RESOURCE_TYPE, for reading installed rules back into our shape. */
const RESOURCE_TYPE_BACK = new Map<string, RuleResourceType>(
  RULE_RESOURCE_TYPES.map((ours) => [RESOURCE_TYPE[ours], ours]),
);

function toChromeHeader(h: HeaderEdit): chrome.declarativeNetRequest.ModifyHeaderInfo {
  return {
    header: h.header,
    operation: h.operation === 'set'
      ? chrome.declarativeNetRequest.HeaderOperation.SET
      : chrome.declarativeNetRequest.HeaderOperation.REMOVE,
    ...(h.value === undefined ? {} : { value: h.value }),
  };
}

function toChromeRule(rule: TabRule): chrome.declarativeNetRequest.Rule {
  return {
    id: rule.id,
    priority: rule.priority,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
      requestHeaders: rule.requestHeaders.map(toChromeHeader),
      responseHeaders: rule.responseHeaders.map(toChromeHeader),
    },
    // tabIds is honoured ONLY on session rules — not static, not dynamic.
    condition: {
      tabIds: [rule.tabId],
      resourceTypes: rule.resourceTypes.map((t) => RESOURCE_TYPE[t]),
      ...(rule.urlRegex === null ? {} : { regexFilter: rule.urlRegex }),
    },
  };
}

function fromChromeHeader(h: chrome.declarativeNetRequest.ModifyHeaderInfo): HeaderEdit {
  return {
    header: h.header,
    operation: h.operation === chrome.declarativeNetRequest.HeaderOperation.SET ? 'set' : 'remove',
    ...(h.value === undefined ? {} : { value: h.value }),
  };
}

/**
 * Read an installed rule back into our shape, so it can be compared with what we meant
 * to install. Returns null for a rule this extension did not write in this shape (no
 * single tab id), which simply never matches.
 */
function fromChromeRule(rule: chrome.declarativeNetRequest.Rule): Omit<TabRule, 'id'> | null {
  const tabId = rule.condition.tabIds?.length === 1 ? rule.condition.tabIds[0] : undefined;
  if (tabId === undefined) return null;
  return {
    priority: rule.priority ?? STRIP_RULE_PRIORITY,
    tabId,
    urlRegex: rule.condition.regexFilter ?? null,
    resourceTypes: (rule.condition.resourceTypes ?? [])
      .map((t) => RESOURCE_TYPE_BACK.get(t))
      .filter((t): t is RuleResourceType => t !== undefined),
    requestHeaders: (rule.action.requestHeaders ?? []).map(fromChromeHeader),
    responseHeaders: (rule.action.responseHeaders ?? []).map(fromChromeHeader),
  };
}

/**
 * Serialized, for the same reason `registerContentScripts` is.
 *
 * `updateSessionRules` is read-then-write: it reads the current rule ids, removes them
 * and adds the new set. Two concurrent calls both read the SAME "existing" list, both
 * remove it, and the second add then collides with the first — Chrome throws
 * "Rule with id N does not have a unique ID" and the whole rule set fails to apply,
 * leaving tabs with no cookie rule and nothing saying so.
 *
 * Easy to hit: opening a persona syncs once per tab while onUpdated and the cookie
 * capture sync too. Same class of bug as the duplicate content-script id; fixed in the
 * same way, because fixing only the instance would leave the shape in place.
 */
let syncing: Promise<number> = Promise.resolve(0);
export function syncRules(): Promise<number> {
  const run = syncing.then(doSyncRules, doSyncRules);
  syncing = run.catch(() => 0);
  return run;
}

async function doSyncRules(): Promise<number> {
  const domainRules = await expectedRules();
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: domainRules.map(toChromeRule),
  });
  return domainRules.length;
}

/** The rules our current state calls for. One place, so sync and confirm cannot drift. */
async function expectedRules(): Promise<TabRule[]> {
  const [lib, bindings] = await Promise.all([loadLibrary(), loadBindings()]);
  const byId = Object.fromEntries(lib.sessions.map((s) => [s.id, s]));
  return buildSessionRules({ sessions: byId, bindings });
}

/**
 * Block until this tab's rules are observably installed AND say what its session says.
 *
 * NOT paranoia — measured. With a fixed sleep instead of this confirmation, isolation
 * failed one run in three: a first request that leaves rule-less rides the shared jar,
 * the tab arrives already signed in, and isolation never recovers for that tab.
 *
 * Compares CONTENT, not ids. Checking only that a rule with the tab's id existed passed
 * on a rule that removed every cookie, so a saved login opened signed out and an app
 * that redirects signed-out users sent the tab to its login page. A rule left over from
 * the tab's previous session would have passed the same way.
 *
 * Returns false on timeout so the caller can REFUSE to navigate rather than open a tab
 * that will silently leak.
 */
export async function awaitRuleForTab(tabId: TabId): Promise<boolean> {
  const deadline = Date.now() + RULE_CONFIRM_TIMEOUT_MS;
  let resynced = false;
  while (Date.now() < deadline) {
    const [expected, installed] = await Promise.all([
      expectedRules(), chrome.declarativeNetRequest.getSessionRules(),
    ]);
    const ours = installed.map(fromChromeRule).filter((r): r is Omit<TabRule, 'id'> => r !== null);
    if (tabRulesMatch(expected, ours, tabId)) return true;
    // State can legitimately move between the caller's sync and this check (a cookie
    // expired, a capture landed). Re-apply once so a stale-but-honest rule set converges
    // instead of timing out and refusing the tab.
    if (!resynced) {
      resynced = true;
      await syncRules().catch((err: unknown) => console.error('[tabsona] rule sync failed:', err));
      continue;
    }
    await new Promise((r) => setTimeout(r, RULE_CONFIRM_POLL_MS));
  }
  return false;
}
