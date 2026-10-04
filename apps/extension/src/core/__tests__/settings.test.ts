import { describe, expect, it } from 'vitest';
import { isBadgeCorner, normalizeSettings } from '../settings';
import { BADGE_CORNERS, DEFAULT_SETTINGS } from '@/domain/messages';

describe('normalizeSettings', () => {
  it('gives an install with nothing stored the defaults, badge bottom-left', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.badgePosition).toBe('bottom-left');
  });

  it('keeps what an older install stored and fills settings it predates', () => {
    // Stored before showPageBadge and badgePosition existed.
    expect(normalizeSettings({ useTabGroups: false })).toEqual({ ...DEFAULT_SETTINGS, useTabGroups: false });
  });

  it('falls back per field, so one bad value never resets the others', () => {
    const s = normalizeSettings({ openPersonaInNewWindow: true, showPageBadge: 'no', badgePosition: 'middle' });
    expect(s.openPersonaInNewWindow).toBe(true);
    expect(s.showPageBadge).toBe(DEFAULT_SETTINGS.showPageBadge);
    expect(s.badgePosition).toBe(DEFAULT_SETTINGS.badgePosition);
  });

  it('accepts every corner it offers', () => {
    for (const corner of BADGE_CORNERS) expect(normalizeSettings({ badgePosition: corner }).badgePosition).toBe(corner);
  });

  it('treats a non-object as nothing stored', () => {
    expect(normalizeSettings('settings')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('isBadgeCorner', () => {
  it('accepts the four corners and nothing else', () => {
    expect(BADGE_CORNERS.every(isBadgeCorner)).toBe(true);
    expect(isBadgeCorner('top')).toBe(false);
    expect(isBadgeCorner(3)).toBe(false);
  });
});
