// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SignInAlertBanner, SignInSitesSection } from '../SignInAlerts';
import { ACTION_HELP } from '@/ui/help';
import type { SignInAlert } from '@/domain/messages';

/** No `vi.mock` of any module path: rendered from plain objects, `vi` only for spies. */

afterEach(cleanup);

// The measured chain on the app that leaked: three provider hosts behind one app.
const chain: SignInAlert[] = [{
  site: 'https://staging-app.example.com',
  hosts: ['https://api.workos.com', 'https://auth.example.ai', 'https://tea.authkit.app'],
}];

describe('SignInAlertBanner — the alarm pinned to the top of the popup', () => {
  it('is an alert naming the app, and Allow all asks for every host in ONE call', () => {
    const onAllow = vi.fn();
    render(<SignInAlertBanner alerts={chain} onAllow={onAllow} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('staging-app.example.com');
    expect(alert.textContent).toContain('3 websites');
    fireEvent.click(screen.getByText(`${ACTION_HELP.allowAllSignInSites.label} 3`));
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onAllow).toHaveBeenCalledWith(['https://api.workos.com', 'https://auth.example.ai', 'https://tea.authkit.app']);
  });

  it('offers "Allow on all sites" as one more line, reported on its own event', () => {
    const onAllow = vi.fn();
    const onAllowAllSites = vi.fn();
    render(<SignInAlertBanner alerts={chain} onAllow={onAllow} onAllowAllSites={onAllowAllSites} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Or allow every website once');
    fireEvent.click(screen.getByRole('button', { name: ACTION_HELP.allowAllSites.label }));
    expect(onAllowAllSites).toHaveBeenCalledTimes(1);
    expect(onAllow).not.toHaveBeenCalled();
  });

  it('leaves the all-sites line out when the surface does not offer it', () => {
    render(<SignInAlertBanner alerts={chain} onAllow={() => undefined} />);
    expect(screen.queryByRole('button', { name: ACTION_HELP.allowAllSites.label })).toBeNull();
  });

  it('renders nothing once every sign-in website is allowed', () => {
    render(<SignInAlertBanner alerts={[]} onAllow={() => undefined} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SignInSitesSection — the worklist', () => {
  it('lists every host of the chain in full, each with its own Allow for just that host', () => {
    const onAllow = vi.fn();
    render(<SignInSitesSection alerts={chain} onAllow={onAllow} />);
    const section = screen.getByRole('region', { name: 'Sign-in websites to allow' });
    for (const host of ['api.workos.com', 'auth.example.ai', 'tea.authkit.app']) {
      expect(section.textContent).toContain(host);
    }
    // The visible label is a short "Allow" (a host-length label crushed the host column);
    // the accessible name still says which host it allows.
    fireEvent.click(screen.getByRole('button', { name: `${ACTION_HELP.allowSignInSite.label} auth.example.ai` }));
    expect(onAllow).toHaveBeenCalledWith(['https://auth.example.ai']);
  });

  it('offers one "Allow all N" per app when its chain has several hosts', () => {
    const onAllow = vi.fn();
    render(<SignInSitesSection alerts={chain} onAllow={onAllow} />);
    const hosts = chain[0]?.hosts ?? [];
    fireEvent.click(screen.getByRole('button', { name: `${ACTION_HELP.allowAllSignInSites.label} ${hosts.length}` }));
    expect(onAllow).toHaveBeenCalledWith(hosts);
  });

  it('folds behind a summary when collapsible, so the popup keeps room for personas', () => {
    render(<SignInSitesSection alerts={chain} onAllow={() => undefined} collapsible />);
    const hosts = chain[0]?.hosts.length ?? 0;
    const summary = screen.getByText(`Show the ${hosts} websites to allow`);
    const details = summary.closest('details');
    expect(details?.open).toBe(false);
  });

  it('is absent when there is nothing to allow', () => {
    render(<SignInSitesSection alerts={[]} onAllow={() => undefined} />);
    expect(screen.queryByRole('region')).toBeNull();
  });
});
