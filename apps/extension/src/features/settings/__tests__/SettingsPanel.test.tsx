// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsPanel } from '../SettingsPanel';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/messages';

/** No module mocks: the panel renders from a plain settings object. */
const renderPanel = (over: Partial<Settings> = {}, onChange = vi.fn()) => {
  render(<SettingsPanel settings={{ ...DEFAULT_SETTINGS, ...over }} onChange={onChange} onForgetDragged={() => undefined} sample={{ name: 'Consultant', color: '#10b981' }} />);
  return onChange;
};

describe('SettingsPanel', () => {
  it('groups settings by what they affect', () => {
    renderPanel();
    for (const title of ['Badge on pages', 'Page titles', 'Tabs']) expect(screen.getByRole('region', { name: title })).toBeTruthy();
  });

  it('shows the current corner and style as selected', () => {
    renderPanel({ badgePosition: 'bottom-right', badgeStyle: 'dot' });
    expect(screen.getByRole('radio', { name: 'Bottom right' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Dot only' }).getAttribute('aria-checked')).toBe('true');
  });

  it('reports a style or corner pick as a settings patch', () => {
    const onChange = renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Dot only' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Top left' }));
    expect(onChange.mock.calls).toEqual([[{ badgeStyle: 'dot' }], [{ badgePosition: 'top-left' }]]);
  });

  it('hides the badge options while the badge is switched off', () => {
    renderPanel({ showPageBadge: false });
    expect(screen.queryByRole('radiogroup', { name: 'Corner' })).toBeNull();
  });

  it('asks for seconds only once auto-hide is on, and commits on Enter', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SettingsPanel settings={DEFAULT_SETTINGS} onChange={onChange} onForgetDragged={() => undefined} sample={{ name: 'Consultant', color: '#10b981' }} />);
    expect(screen.queryByLabelText('Seconds before the badge hides')).toBeNull();
    rerender(<SettingsPanel settings={{ ...DEFAULT_SETTINGS, autoHideBadge: true }} onChange={onChange} onForgetDragged={() => undefined} sample={{ name: 'Consultant', color: '#10b981' }} />);
    const field = screen.getByLabelText('Seconds before the badge hides');
    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ badgeHideSeconds: 12 });
  });

  it('does not store a half-typed number on the way', () => {
    // Typing "15" passes through "1"; only Enter or leaving the field commits.
    const onChange = renderPanel({ autoHideBadge: true });
    fireEvent.change(screen.getByLabelText('Seconds before the badge hides'), { target: { value: '1' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
