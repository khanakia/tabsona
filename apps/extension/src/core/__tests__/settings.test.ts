import { describe, expect, it } from 'vitest';
import { clampHideSeconds, hashFor, isBadgeCorner, isSettingsGroup, normalizeSettings, sectionFromHash, settingsGroupFromHash } from '../settings';
import { BADGE_CORNERS, BADGE_HIDE_SECONDS_MAX, BADGE_HIDE_SECONDS_MIN, DEFAULT_SETTINGS, SETTINGS_GROUPS } from '@/domain/messages';

describe('normalizeSettings', () => {
  it('gives an install with nothing stored the defaults: badge bottom-right, name shown, never hidden', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.badgePosition).toBe('bottom-right');
    expect(DEFAULT_SETTINGS.badgeStyle).toBe('label');
    expect(DEFAULT_SETTINGS.autoHideBadge).toBe(false);
  });

  it('keeps a corner the user already chose when the default changes', () => {
    expect(normalizeSettings({ badgePosition: 'top-left' }).badgePosition).toBe('top-left');
  });

  it('clamps the hide delay into bounds and rejects non-numbers', () => {
    expect(normalizeSettings({ badgeHideSeconds: 0 }).badgeHideSeconds).toBe(BADGE_HIDE_SECONDS_MIN);
    expect(normalizeSettings({ badgeHideSeconds: 999 }).badgeHideSeconds).toBe(BADGE_HIDE_SECONDS_MAX);
    expect(normalizeSettings({ badgeHideSeconds: 7.6 }).badgeHideSeconds).toBe(8);
    expect(normalizeSettings({ badgeHideSeconds: '5' }).badgeHideSeconds).toBe(DEFAULT_SETTINGS.badgeHideSeconds);
  });

  it('accepts only known badge styles', () => {
    expect(normalizeSettings({ badgeStyle: 'dot' }).badgeStyle).toBe('dot');
    expect(normalizeSettings({ badgeStyle: 'icon' }).badgeStyle).toBe(DEFAULT_SETTINGS.badgeStyle);
  });

  it('keeps what an older install stored and fills settings it predates', () => {
    // Stored before showPageBadge and badgePosition existed.
    expect(normalizeSettings({ useTabGroups: false })).toEqual({ ...DEFAULT_SETTINGS, useTabGroups: false });
  });

  it('remembers "I’ll choose sites myself", so the first-run welcome is not shown again', () => {
    expect(DEFAULT_SETTINGS.chooseSitesMyself).toBe(false);
    expect(normalizeSettings({ chooseSitesMyself: true }).chooseSitesMyself).toBe(true);
    // Not a stray storage key: a non-boolean falls back like every other flag.
    expect(normalizeSettings({ chooseSitesMyself: 'yes' }).chooseSitesMyself).toBe(false);
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

describe('sectionFromHash', () => {
  it('opens the library on the section the hash names', () => {
    expect(sectionFromHash('#settings')).toBe('settings');
    expect(sectionFromHash('coverage')).toBe('coverage');
  });

  it('falls back to Personas for an empty or unknown hash', () => {
    expect(sectionFromHash('')).toBe('personas');
    expect(sectionFromHash('#admin')).toBe('personas');
  });
});

describe('Settings card hashes', () => {
  it('keeps the old bare #settings link on Settings and names no card', () => {
    expect(sectionFromHash('#settings')).toBe('settings');
    expect(settingsGroupFromHash('#settings')).toBeNull();
  });

  it('reads a card from #settings/<card> without changing the section', () => {
    expect(sectionFromHash('#settings/badge')).toBe('settings');
    expect(settingsGroupFromHash('#settings/badge')).toBe('badge');
    expect(settingsGroupFromHash('#settings/normal-login')).toBe('normal-login');
  });

  it('ignores an unknown card, and a card on any other section', () => {
    expect(settingsGroupFromHash('#settings/nope')).toBeNull();
    expect(settingsGroupFromHash('#sites/badge')).toBeNull();
    expect(sectionFromHash('#sites/badge')).toBe('sites');
  });

  it('round-trips every card through hashFor', () => {
    for (const g of SETTINGS_GROUPS) {
      expect(isSettingsGroup(g)).toBe(true);
      expect(settingsGroupFromHash(hashFor('settings', g))).toBe(g);
    }
    expect(hashFor('settings')).toBe('#settings');
    expect(hashFor('sites', 'badge')).toBe('#sites');
  });
});

describe('clampHideSeconds', () => {
  it('returns null for anything that is not a finite number', () => {
    expect(clampHideSeconds(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampHideSeconds(null)).toBeNull();
  });
});
