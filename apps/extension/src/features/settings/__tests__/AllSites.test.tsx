// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AllSitesWelcome } from '../AllSites';
import { ACTION_HELP, EXPLAIN } from '@/ui/help';

/** No module mocks: rendered from plain props, `vi` only for spies. */

describe('AllSitesWelcome — the first-run question', () => {
  it('asks once, with the two answers the user chose between', () => {
    render(<AllSitesWelcome allowed={false} onAllow={() => undefined} onDecline={() => undefined} />);
    const card = screen.getByRole('region', { name: EXPLAIN.welcome.label });
    expect(card.textContent).toContain('Let Tabsona keep logins separate on every website?');
    expect(screen.getByRole('button', { name: ACTION_HELP.allowAllSites.label })).toBeTruthy();
    expect(screen.getByRole('button', { name: ACTION_HELP.chooseSitesMyself.label })).toBeTruthy();
  });

  it('reports Allow and "I’ll choose sites myself" as separate events', () => {
    const onAllow = vi.fn();
    const onDecline = vi.fn();
    render(<AllSitesWelcome allowed={false} onAllow={onAllow} onDecline={onDecline} />);
    fireEvent.click(screen.getByRole('button', { name: ACTION_HELP.allowAllSites.label }));
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: ACTION_HELP.chooseSitesMyself.label }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('says what changes for tabs outside a persona and inside one, before anyone clicks', () => {
    render(<AllSitesWelcome allowed={false} onAllow={() => undefined} onDecline={() => undefined} />);
    const card = screen.getByRole('region', { name: EXPLAIN.welcome.label });
    expect(card.textContent).toContain('Tabs outside a persona keep your normal login everywhere');
    expect(card.textContent).toContain('every website starts signed out');
  });

  it('renders nothing once every website is allowed', () => {
    render(<AllSitesWelcome allowed onAllow={() => undefined} onDecline={() => undefined} />);
    expect(screen.queryByRole('region', { name: EXPLAIN.welcome.label })).toBeNull();
  });
});
