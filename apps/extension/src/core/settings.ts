// Pure: turn whatever is in storage into a valid Settings object.

import { BADGE_CORNERS, DEFAULT_SETTINGS, type BadgeCorner, type Settings, type SettingKey } from '@/domain/messages';

/** Narrow an untrusted value to a corner. */
export function isBadgeCorner(value: unknown): value is BadgeCorner {
  return typeof value === 'string' && BADGE_CORNERS.some((c) => c === value);
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
  return {
    useTabGroups: flag('useTabGroups'),
    openPersonaInNewWindow: flag('openPersonaInNewWindow'),
    showPageBadge: flag('showPageBadge'),
    markPageTitles: flag('markPageTitles'),
    badgePosition: isBadgeCorner(corner) ? corner : DEFAULT_SETTINGS.badgePosition,
  };
}
