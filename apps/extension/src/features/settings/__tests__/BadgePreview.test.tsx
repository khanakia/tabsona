// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BadgePreview } from '../BadgePreview';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/messages';

/** No module mocks: the preview renders from plain settings and a sample persona. */
const sample = { name: 'Consultant', color: '#10b981' };
const show = (over: Partial<Settings> = {}) => render(<BadgePreview settings={{ ...DEFAULT_SETTINGS, ...over }} sample={sample} />);
afterEach(() => { vi.useRealTimers(); });

describe('BadgePreview', () => {
  it('shows the persona name in the chosen corner', () => {
    show({ badgePosition: 'top-left' });
    const badge = screen.getByRole('button', { name: /Preview badge/ });
    expect(badge.textContent).toBe('Consultant');
    expect(badge.style.top).toBe('8px');
    expect(badge.style.left).toBe('8px');
  });

  it('starts as a dot with "Dot only", and a click shows the name, like on a page', () => {
    show({ badgeStyle: 'dot' });
    const badge = screen.getByRole('button', { name: /shrunk to a dot/ });
    expect(badge.textContent).toBe('');
    fireEvent.click(badge);
    expect(screen.getByRole('button', { name: /Preview badge/ }).textContent).toBe('Consultant');
  });

  it('plays auto-hide for real, and Replay brings it back', () => {
    vi.useFakeTimers();
    show({ autoHideBadge: true, badgeHideSeconds: 2 });
    const badge = () => screen.getByRole('button', { name: /Preview badge/ });
    expect(badge().style.opacity).toBe('1');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(badge().style.opacity).toBe('0');
    fireEvent.click(screen.getByText('Replay hide'));
    expect(badge().style.opacity).toBe('1');
  });

  it('says the badge is off instead of drawing one', () => {
    show({ showPageBadge: false });
    expect(screen.queryByRole('button', { name: /Preview badge/ })).toBeNull();
    expect(screen.getByText('The badge is off.')).toBeTruthy();
  });
});
