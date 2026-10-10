// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ACTION_HELP, EXPLAIN } from '@/ui/help';
import { SettingsPanel } from '../SettingsPanel';
import { DEFAULT_SETTINGS, type Settings } from '@/domain/messages';

/** No module mocks: the panel renders from a plain settings object. */
/** The "Allow on all sites" props, off and inert unless a test says otherwise. */
const allSites = {
  allSitesAllowed: false, onAllowAllSites: () => undefined, onRemoveAllSites: () => undefined,
  passThroughHosts: [], onAddPassThrough: () => undefined, onRemovePassThrough: () => undefined,
};

const renderPanel = (over: Partial<Settings> = {}, onChange = vi.fn()) => {
  render(<SettingsPanel settings={{ ...DEFAULT_SETTINGS, ...over }} onChange={onChange} onForgetDragged={() => undefined} sample={{ name: 'Consultant', color: '#10b981' }} {...allSites} />);
  return onChange;
};

describe('SettingsPanel', () => {
  it('groups settings by what they affect', () => {
    renderPanel();
    for (const title of ['Websites', 'Use my normal login on', 'Badge on pages', 'Page titles', 'Tabs']) expect(screen.getByRole('region', { name: title })).toBeTruthy();
  });

  it('has a nav entry for every card, in order, and highlights the first by default', () => {
    renderPanel();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Websites', 'Use my normal login on', 'Badge on pages', 'Page titles', 'Tabs']);
    expect(buttons[0]?.getAttribute('aria-current')).toBe('true');
    expect(buttons.filter((b) => b.getAttribute('aria-current') === 'true')).toHaveLength(1);
  });

  it('a nav click highlights that card and reports it to the host', () => {
    const onGroupSelect = vi.fn();
    render(<SettingsPanel settings={DEFAULT_SETTINGS} onChange={() => undefined} onForgetDragged={() => undefined} sample={{ name: 'Consultant', color: '#10b981' }} {...allSites} onGroupSelect={onGroupSelect} />);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Page titles' }));
    expect(onGroupSelect).toHaveBeenCalledWith('titles');
    expect(within(nav).getByRole('button', { name: 'Page titles' }).getAttribute('aria-current')).toBe('true');
    expect(within(nav).getByRole('button', { name: 'Websites' }).getAttribute('aria-current')).toBeNull();
  });

  it('starts on the card a deep link names', () => {
    render(<SettingsPanel settings={DEFAULT_SETTINGS} onChange={() => undefined} onForgetDragged={() => undefined} sample={{ name: 'Consultant', color: '#10b981' }} {...allSites} focusGroup="badge" />);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Badge on pages' }).getAttribute('aria-current')).toBe('true');
  });

  it('gives each card an id the nav can scroll to', () => {
    renderPanel();
    for (const g of ['websites', 'normal-login', 'badge', 'titles', 'tabs']) expect(document.getElementById(`settings-${g}`)).not.toBeNull();
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

  it('offers one tab-group switch, reported as useTabGroups', () => {
    const onChange = renderPanel({ useTabGroups: true });
    const toggle = screen.getByRole('switch', { name: 'Open tabs in a tab group' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ useTabGroups: false });
  });

  it('hides the badge options while the badge is switched off', () => {
    renderPanel({ showPageBadge: false });
    expect(screen.queryByRole('radiogroup', { name: 'Corner' })).toBeNull();
  });

  it('asks for seconds only once auto-hide is on, and commits on Enter', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SettingsPanel settings={DEFAULT_SETTINGS} onChange={onChange} onForgetDragged={() => undefined} sample={{ name: 'Consultant', color: '#10b981' }} {...allSites} />);
    expect(screen.queryByLabelText('Seconds before the badge hides')).toBeNull();
    rerender(<SettingsPanel settings={{ ...DEFAULT_SETTINGS, autoHideBadge: true }} onChange={onChange} onForgetDragged={() => undefined} sample={{ name: 'Consultant', color: '#10b981' }} {...allSites} />);
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

  it('shows "Allow on all sites" as off with an Allow button, and reports the click', () => {
    const onAllowAllSites = vi.fn();
    render(<SettingsPanel settings={DEFAULT_SETTINGS} onChange={vi.fn()} onForgetDragged={() => undefined} sample={{ name: 'Consultant', color: '#10b981' }} {...allSites} onAllowAllSites={onAllowAllSites} />);
    const row = screen.getByRole('region', { name: 'Websites' });
    expect(row.textContent).toContain('Off: Tabsona works only on websites you allowed one by one.');
    expect(within(row).queryByRole('button', { name: ACTION_HELP.removeAllSites.label })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: ACTION_HELP.allowAllSites.label }));
    expect(onAllowAllSites).toHaveBeenCalledTimes(1);
  });

  it('shows it as on with Remove once every website is allowed', () => {
    const onRemoveAllSites = vi.fn();
    render(<SettingsPanel settings={DEFAULT_SETTINGS} onChange={vi.fn()} onForgetDragged={() => undefined} sample={{ name: 'Consultant', color: '#10b981' }} {...allSites} allSitesAllowed onRemoveAllSites={onRemoveAllSites} />);
    const row = screen.getByRole('region', { name: 'Websites' });
    expect(row.textContent).toContain('On: every website.');
    expect(within(row).queryByRole('button', { name: ACTION_HELP.allowAllSites.label })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: ACTION_HELP.removeAllSites.label }));
    expect(onRemoveAllSites).toHaveBeenCalledTimes(1);
  });

  it('explains the trade-off honestly behind the section ⓘ: no browser login reaches ANY website', () => {
    expect(EXPLAIN.settingsSites.touches).toContain('never sends your normal browser login to ANY website');
    expect(EXPLAIN.settingsSites.touches).toContain('Google or GitHub');
  });
});
