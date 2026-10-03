// Keeps Chrome's live DNR session rules in step with our state, and — critically —
// CONFIRMS a rule exists before anyone navigates.

import { RULE_CONFIRM_POLL_MS, RULE_CONFIRM_TIMEOUT_MS } from '@/core/constants';
import { buildSessionRules, ruleIdForTab } from '@/core/rules';
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
    },
  };
}

/** Tab urls are read live, because which cookies apply depends on where a tab IS. */
async function currentTabUrls(): Promise<Record<string, string>> {
  const tabs = await chrome.tabs.query({});
  const out: Record<string, string> = {};
  for (const t of tabs) if (t.id !== undefined && t.url) out[String(t.id)] = t.url;
  return out;
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
  const [lib, bindings, tabUrls] = await Promise.all([
    loadLibrary(), loadBindings(), currentTabUrls(),
  ]);
  const byId = Object.fromEntries(lib.sessions.map((s) => [s.id, s]));
  const domainRules = buildSessionRules({ sessions: byId, bindings, tabUrls });
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: domainRules.map(toChromeRule),
  });
  return domainRules.length;
}

/**
 * Block until this tab's rule is observably installed.
 *
 * NOT paranoia — measured. With a fixed sleep instead of this confirmation, isolation
 * failed one run in three: a first request that leaves rule-less rides the shared jar,
 * the tab arrives already signed in, and isolation never recovers for that tab.
 *
 * Returns false on timeout so the caller can REFUSE to navigate rather than open a tab
 * that will silently leak.
 */
export async function awaitRuleForTab(tabId: TabId): Promise<boolean> {
  const wanted = ruleIdForTab(tabId);
  const deadline = Date.now() + RULE_CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    if (rules.some((r) => r.id === wanted)) return true;
    await new Promise((r) => setTimeout(r, RULE_CONFIRM_POLL_MS));
  }
  return false;
}
