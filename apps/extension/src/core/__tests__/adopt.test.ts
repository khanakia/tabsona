import { describe, expect, it } from 'vitest';
import { planAdoption, strandedFor } from '../adopt';

const known = new Set(['s1', 's2']);

describe('planAdoption', () => {
  it('adopts an unbound tab whose session still exists', () => {
    const plan = planAdoption([{ tabId: 5, sessionId: 's1' }], {}, known);
    expect(plan.adopt).toEqual([{ tabId: 5, sessionId: 's1' }]);
    expect(plan.release).toEqual([]);
  });

  it('releases an unbound tab whose session is gone', () => {
    const plan = planAdoption([{ tabId: 5, sessionId: 'gone' }], {}, known);
    expect(plan.adopt).toEqual([]);
    expect(plan.release).toEqual([{ tabId: 5, sessionId: 'gone' }]);
  });

  it('never touches a tab that already has a binding, even a conflicting one', () => {
    const plan = planAdoption(
      [{ tabId: 5, sessionId: 's1' }, { tabId: 6, sessionId: 'gone' }],
      { '5': 's2', '6': 's1' }, known);
    expect(plan).toEqual({ adopt: [], release: [] });
  });

  it('splits a mixed set and keeps order', () => {
    const plan = planAdoption(
      [{ tabId: 1, sessionId: 's2' }, { tabId: 2, sessionId: 'x' }, { tabId: 3, sessionId: 's1' }],
      {}, known);
    expect(plan.adopt.map((m) => m.tabId)).toEqual([1, 3]);
    expect(plan.release.map((m) => m.tabId)).toEqual([2]);
  });
});

describe('strandedFor', () => {
  it('returns carrying tabs of a forgotten session not already released', () => {
    const found = [
      { tabId: 1, sessionId: 's1' }, { tabId: 2, sessionId: 's1' }, { tabId: 3, sessionId: 's2' },
    ];
    expect(strandedFor(found, new Set(['s1']), new Set([1]))).toEqual([{ tabId: 2, sessionId: 's1' }]);
  });

  it('returns nothing when nothing carries the forgotten id', () => {
    expect(strandedFor([{ tabId: 3, sessionId: 's2' }], new Set(['s1']), new Set())).toEqual([]);
  });
});
