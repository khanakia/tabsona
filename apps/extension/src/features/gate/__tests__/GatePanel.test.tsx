// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GatePanel, gateWording } from '../GatePanel';
import { ACTION_HELP } from '@/ui/help';
import type { GateInfo } from '@/domain/messages';

/** No `vi.mock` of any module path: rendered from plain objects, `vi` only for spies. */

afterEach(cleanup);

const base: GateInfo = {
  tabId: 7,
  url: 'https://api.workos.com/user_management/authorize?client_id=x&state=y',
  host: 'https://api.workos.com',
  site: 'https://staging-app.example.com',
  personaName: 's2',
  color: '#10b981',
  reason: 'sign-in',
  hostsToAllow: ['https://api.workos.com'],
  viaForm: false,
};

function renderGate(info: GateInfo, error: string | null = null) {
  const spies = { onAllowAndContinue: vi.fn(), onAllowAllSites: vi.fn(), onOpenNormally: vi.fn() };
  render(<GatePanel info={info} error={error} {...spies} />);
  return spies;
}

describe('gateWording — what the stopped tab says', () => {
  it('a sign-in hop names the app, the provider, the persona and the consequence', () => {
    const w = gateWording(base);
    expect(w.title).toBe('staging-app.example.com signs you in through api.workos.com');
    expect(w.body).toContain('Allow Tabsona on api.workos.com so “s2” gets its own login there');
    expect(w.body).toContain('otherwise you’d arrive signed in as your normal browser login');
  });

  it('a known chain is counted and listed, so one Allow covers all of it', () => {
    const w = gateWording({
      ...base,
      hostsToAllow: ['https://api.workos.com', 'https://auth.example.ai', 'https://tea.authkit.app'],
    });
    expect(w.body).toContain('signs you in through 3 websites: api.workos.com, auth.example.ai, tea.authkit.app.');
    expect(w.body).toContain('Allow Tabsona on them');
  });

  it('a link out says the tab is about to visit the host, and offers a normal tab', () => {
    const w = gateWording({ ...base, reason: 'link', host: 'https://github.com', url: 'https://github.com/x' });
    expect(w.title).toBe('This tab is about to visit github.com');
    expect(w.body).toContain('open it in a normal tab');
  });

  it('the persona\'s own site, not yet allowed, says so', () => {
    const w = gateWording({ ...base, reason: 'own-site', host: base.site, url: `${base.site}/` });
    expect(w.title).toBe('Tabsona is not allowed on staging-app.example.com yet');
  });
});

describe('GatePanel', () => {
  it('shows the persona, the exact url, and Allow asks for the listed hosts', () => {
    const spies = renderGate(base);
    expect(screen.getByText('s2')).toBeTruthy();
    expect(screen.getByText(base.url)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ACTION_HELP.allowAndContinue.label }));
    expect(spies.onAllowAndContinue).toHaveBeenCalledWith(['https://api.workos.com']);
    expect(spies.onOpenNormally).not.toHaveBeenCalled();
  });

  it('a whole chain is ONE button: "Allow all 3 and continue"', () => {
    const hosts = ['https://api.workos.com', 'https://auth.example.ai', 'https://tea.authkit.app'];
    const spies = renderGate({ ...base, hostsToAllow: hosts });
    fireEvent.click(screen.getByRole('button', { name: 'Allow all 3 and continue' }));
    expect(spies.onAllowAndContinue).toHaveBeenCalledTimes(1);
    expect(spies.onAllowAndContinue).toHaveBeenCalledWith(hosts);
  });

  it('offers a plain Continue when everything was allowed meanwhile', () => {
    const spies = renderGate({ ...base, hostsToAllow: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(spies.onAllowAndContinue).toHaveBeenCalledWith([]);
  });

  it('Open in a normal tab and Allow on all sites report their own events', () => {
    const spies = renderGate(base);
    fireEvent.click(screen.getByRole('button', { name: ACTION_HELP.openNormally.label }));
    fireEvent.click(screen.getByRole('button', { name: ACTION_HELP.allowAllSites.label }));
    expect(spies.onOpenNormally).toHaveBeenCalledTimes(1);
    expect(spies.onAllowAllSites).toHaveBeenCalledTimes(1);
    expect(spies.onAllowAndContinue).not.toHaveBeenCalled();
  });

  it('shows the last attempt\'s error as an alert', () => {
    renderGate(base, 'Chrome declined.');
    expect(screen.getByRole('alert').textContent).toBe('Chrome declined.');
  });
});

describe('a stopped form POST — cannot be resent, so the page says what happens instead', () => {
  const posted: GateInfo = { ...base, viaForm: true };

  it('explains that the user presses the button again after being taken back', () => {
    const w = gateWording(posted);
    expect(w.body).toContain('form being sent');
    expect(w.body).toContain('press the button again');
    expect(gateWording(base).body).not.toContain('form being sent');
  });

  it('offers "go back", and not "Open in a normal tab", which would send a bare GET', () => {
    renderGate(posted);
    expect(screen.getByRole('button', { name: /Allow and go back/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ACTION_HELP.openNormally.label })).toBeNull();
  });

  it('a plain stop still offers both', () => {
    renderGate(base);
    expect(screen.getByRole('button', { name: ACTION_HELP.openNormally.label })).toBeTruthy();
  });
});
