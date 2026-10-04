import { describe, expect, it } from 'vitest';
import { withTitleMark, withoutTitleMark } from '../titleMark';
import { normalizePlacements, pixelsToPlacement, placementFrom, placementToPixels } from '../placement';

describe('title mark', () => {
  it('puts the marker in front once, however often it is applied', () => {
    // The content script re-applies on every title change the app makes.
    const once = withTitleMark('Dashboard', '💙');
    expect(once).toBe('💙 Dashboard');
    expect(withTitleMark(once, '💙')).toBe(once);
  });

  it('strips it back to exactly the app\'s title, and stripping twice is harmless', () => {
    expect(withoutTitleMark('💙 Dashboard', '💙')).toBe('Dashboard');
    expect(withoutTitleMark('Dashboard', '💙')).toBe('Dashboard');
  });

  it('swaps one persona\'s marker for another without stacking them', () => {
    expect(withTitleMark(withoutTitleMark('💙 Dashboard', '💙'), '❤️')).toBe('❤️ Dashboard');
  });

  it('marks an empty title too, so an untitled tab still says whose it is', () => {
    expect(withTitleMark('', '💚')).toBe('💚 ');
  });
});

describe('badge placement', () => {
  const viewport = { width: 1000, height: 800 };
  const badge = { width: 100, height: 20 };

  it('round-trips a drop position through stored fractions', () => {
    const p = pixelsToPlacement(450, 390, viewport, badge);
    expect(placementToPixels(p, viewport, badge)).toEqual({ left: 450, top: 390 });
  });

  it('keeps the badge fully on-screen in a smaller window', () => {
    const p = pixelsToPlacement(900, 780, viewport, badge); // dragged to the far corner
    const small = placementToPixels(p, { width: 400, height: 300 }, badge);
    expect(small.left + badge.width).toBeLessThanOrEqual(400);
    expect(small.top + badge.height).toBeLessThanOrEqual(300);
  });

  it('clamps a drop dragged past the window edge', () => {
    expect(pixelsToPlacement(-50, 5000, viewport, badge)).toEqual({ x: 0, y: 1 });
  });

  it('rejects anything that is not a pair of numbers, and clamps the rest', () => {
    expect(placementFrom({ x: '1', y: 0 })).toBeNull();
    expect(placementFrom({ x: Number.NaN, y: 0 })).toBeNull();
    expect(placementFrom({ x: 2, y: -1 })).toEqual({ x: 1, y: 0 });
  });

  it('drops invalid stored entries without losing the valid ones', () => {
    expect(normalizePlacements({ 'http://a.test': { x: 0.5, y: 0.5 }, 'http://b.test': 'left' }))
      .toEqual({ 'http://a.test': { x: 0.5, y: 0.5 } });
    expect(normalizePlacements(null)).toEqual({});
  });
});
