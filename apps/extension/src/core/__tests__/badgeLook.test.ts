import { describe, expect, it } from 'vitest';
import { ACTION_BADGE_ALERT, actionBadgeText } from '../badgeLook';

describe('actionBadgeText — the toolbar icon', () => {
  it('shows the persona’s first letters on a separated tab', () => {
    expect(actionBadgeText('Acme admin', false)).toBe('Acm');
  });

  it('leads with ! while a sign-in website is not separated, and still fits', () => {
    // A user missed the popup's warning; the toolbar is visible without a click.
    const text = actionBadgeText('Acme admin', true);
    expect(text.startsWith(ACTION_BADGE_ALERT)).toBe(true);
    expect(text).toBe('!Ac');
  });

  it('is empty for a tab in no persona', () => {
    expect(actionBadgeText(null, true)).toBe('');
  });
});
