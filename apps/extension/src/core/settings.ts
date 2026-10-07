// Pure: turn whatever is in storage into a valid Settings object.

import {
  BADGE_CORNERS, BADGE_HIDE_SECONDS_MAX, BADGE_HIDE_SECONDS_MIN, BADGE_STYLES, DEFAULT_SETTINGS, OPTIONS_SECTIONS,
  type BadgeCorner, type BadgeStyle, type OptionsSection, type Settings, type SettingKey,
} from '@/domain/messages';

/** Narrow an untrusted value to a corner. */
export function isBadgeCorner(value: unknown): value is BadgeCorner {
  return typeof value === 'string' && BADGE_CORNERS.some((c) => c === value);
}

/** Narrow an untrusted value to a badge style. */
export function isBadgeStyle(value: unknown): value is BadgeStyle {
  return typeof value === 'string' && BADGE_STYLES.some((s) => s === value);
}

/** Whole seconds within the allowed bounds, or null for anything that is not a number. */
export function clampHideSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(BADGE_HIDE_SECONDS_MAX, Math.max(BADGE_HIDE_SECONDS_MIN, Math.round(value)));
}

/** Narrow an untrusted value to a library section. */
export function isOptionsSection(value: unknown): value is OptionsSection {
  return typeof value === 'string' && OPTIONS_SECTIONS.some((s) => s === value);
}

/** The library section a URL hash names (`#settings`), or the first section otherwise. */
export function sectionFromHash(hash: string): OptionsSection {
  const name = hash.replace(/^#/, '');
  return isOptionsSection(name) ? name : 'personas';
}

/**
 * Settings read back from storage, with every field validated.
 *
 * Storage is untrusted: it may predate a setting (older install), or hold a value a
 * future version wrote. Each field falls back to its default on its own, so one bad
 * value never resets the user's other choices. Written as an explicit literal so the
 * compiler refuses to build when a new setting is declared but not validated here.
 */
export function normalizeSettings(raw: unknown): Settings {
  const read = (key: string): unknown =>
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[key] : undefined;
  const flag = (key: SettingKey): boolean => {
    const v = read(key);
    return typeof v === 'boolean' ? v : DEFAULT_SETTINGS[key];
  };
  const corner = read('badgePosition');
  const style = read('badgeStyle');
  return {
    useTabGroups: flag('useTabGroups'),
    openPersonaInNewWindow: flag('openPersonaInNewWindow'),
    showPageBadge: flag('showPageBadge'),
    markPageTitles: flag('markPageTitles'),
    autoHideBadge: flag('autoHideBadge'),
    badgePosition: isBadgeCorner(corner) ? corner : DEFAULT_SETTINGS.badgePosition,
    badgeStyle: isBadgeStyle(style) ? style : DEFAULT_SETTINGS.badgeStyle,
    badgeHideSeconds: clampHideSeconds(read('badgeHideSeconds')) ?? DEFAULT_SETTINGS.badgeHideSeconds,
  };
}
