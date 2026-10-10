import { describe, expect, it } from 'vitest';
import { planPersonaGroups, type TabPlacement } from '../tabgroups';

const NONE = -1;
const tab = (tabId: number, windowId: number, groupId = NONE): TabPlacement => ({ tabId, windowId, groupId });

describe('planPersonaGroups', () => {
  it('makes a new group when the persona has no grouped tab in that window', () => {
    expect(planPersonaGroups([tab(1, 10)], [], NONE))
      .toEqual([{ windowId: 10, tabIds: [1], joinGroupId: null }]);
  });

  it('joins the group a sibling already sits in, so one persona is one group', () => {
    // The reported bug: opening one more site of a persona left the tab ungrouped.
    expect(planPersonaGroups([tab(2, 10)], [tab(1, 10, 77)], NONE))
      .toEqual([{ windowId: 10, tabIds: [2], joinGroupId: 77 }]);
  });

  it('ignores ungrouped siblings', () => {
    expect(planPersonaGroups([tab(2, 10)], [tab(1, 10, NONE)], NONE))
      .toEqual([{ windowId: 10, tabIds: [2], joinGroupId: null }]);
  });

  it('never joins a group in another window — groups do not span windows', () => {
    expect(planPersonaGroups([tab(2, 20)], [tab(1, 10, 77)], NONE))
      .toEqual([{ windowId: 20, tabIds: [2], joinGroupId: null }]);
  });

  it('plans one group per window when the opened tabs span windows', () => {
    const plans = planPersonaGroups([tab(1, 10), tab(2, 20), tab(3, 10)], [tab(9, 20, 5)], NONE);
    expect(plans).toEqual([
      { windowId: 10, tabIds: [1, 3], joinGroupId: null },
      { windowId: 20, tabIds: [2], joinGroupId: 5 },
    ]);
  });

  it('does not treat a newly opened tab as its own sibling', () => {
    // A tab already in a group must not make the batch "join" the group it is in.
    expect(planPersonaGroups([tab(1, 10, 44)], [tab(1, 10, 44)], NONE))
      .toEqual([{ windowId: 10, tabIds: [1], joinGroupId: null }]);
  });

  it('plans nothing for nothing opened', () => {
    expect(planPersonaGroups([], [tab(1, 10, 77)], NONE)).toEqual([]);
  });
});
