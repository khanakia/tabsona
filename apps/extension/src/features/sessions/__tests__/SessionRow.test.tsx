// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionRow } from '../SessionRow';
import { ACTION_HELP } from '@/ui/help';
import type { SessionView } from '@/domain/types';

/**
 * NOTE WHAT IS ABSENT: no `vi.mock` of any module path, no query client, no router.
 *
 * That absence is the test. A presenter that cannot render without mocking a module is
 * fused to the data layer and could not be reused on a second surface — which is
 * exactly what this project needs, since the popup and the options page render the
 * same rows. `vi` is imported only for plain callback spies.
 */
const view = (over: Partial<SessionView> = {}): SessionView => ({
  id: 's_1', personaId: 'p_1', site: 'https://sync.localhost', label: 'admin',
  state: 'signed-in', cookieCount: 4, storageKeyCount: 3, domains: ['sync.localhost'],
  openTabCount: 0, savedAt: Date.now(), lastUsedAt: Date.now(),
  cookieNames: ['sid', 'csrf'], storageKeys: ['authmgr.access'], expiresAt: null,
  ...over,
});

const noop = {
  onOpen: () => undefined,
  onRename: () => undefined,
  onDelete: () => undefined,
};

describe('SessionRow', () => {
  it('states what is actually stored, which is the v1 complaint it exists to fix', () => {
    render(<SessionRow session={view()} {...noop} />);
    expect(screen.getByText(/4 cookies · 3 keys/)).toBeTruthy();
    expect(screen.getByText('Signed in')).toBeTruthy();
  });

  it('marks an empty session and tells the user what to do', () => {
    render(<SessionRow session={view({ state: 'empty', cookieCount: 0, storageKeyCount: 0 })} {...noop} />);
    expect(screen.getByText('Empty')).toBeTruthy();
    expect(screen.getByText(/sign in once/)).toBeTruthy();
  });

  it('marks an expired session differently from an empty one', () => {
    // The remedy differs: empty needs a first login, expired needs a fresh one.
    render(<SessionRow session={view({ state: 'expired' })} {...noop} />);
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.getByText(/sign in again/)).toBeTruthy();
  });

  it('offers both open targets and reports which was chosen', () => {
    const onOpen = vi.fn();
    render(<SessionRow session={view()} {...noop} onOpen={onOpen} />);
    // Queried by accessible name, not by `title`: the icon-only control carries an
    // aria-label and a real tooltip, so a native title would be redundant.
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByLabelText(ACTION_HELP.openSessionHere.label));
    expect(onOpen.mock.calls).toEqual([['s_1', 'new-tab'], ['s_1', 'this-tab']]);
  });

  it('hides cookie names until expanded, then shows NAMES and never values', () => {
    render(<SessionRow session={view()} {...noop} />);
    expect(screen.queryByText(/csrf, sid|sid, csrf/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Show details'));
    expect(screen.getByText('Cookies')).toBeTruthy();
    expect(screen.getByText(/csrf, sid|sid, csrf/)).toBeTruthy();
    expect(screen.getByText('authmgr.access')).toBeTruthy();
  });

  it('renames on blur, and only when the label actually changed', () => {
    const onRename = vi.fn();
    render(<SessionRow session={view()} {...noop} onRename={onRename} />);
    fireEvent.click(screen.getByLabelText('Show details'));
    const input = screen.getByLabelText('Rename admin');
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'admin two' } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith('s_1', 'admin two');
  });

  it('offers another login for the same site, which is otherwise a dead end', () => {
    // Two logins for one site means two personas. Without this the user has to invent
    // that journey themselves, which is the thing they could not work out.
    const onAnotherLogin = vi.fn();
    render(<SessionRow session={view()} {...noop} onAnotherLogin={onAnotherLogin} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText(ACTION_HELP.anotherAccountForSite.label));
    expect(onAnotherLogin).toHaveBeenCalledWith('https://sync.localhost');
  });

  it('hides that action on a surface that cannot offer it', () => {
    render(<SessionRow session={view()} {...noop} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.queryByText(ACTION_HELP.anotherAccountForSite.label)).toBeNull();
  });

  it('shows how many tabs are open in this session', () => {
    render(<SessionRow session={view({ openTabCount: 2 })} {...noop} />);
    expect(screen.getByText('2 tabs open')).toBeTruthy();
  });

  it('explains every menu entry in place, and warns before forgetting a login', () => {
    // A bare "Delete session" left people unsure whether the website would sign them out.
    render(<SessionRow session={view()} {...noop} onAnotherLogin={() => undefined} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.getByText(ACTION_HELP.anotherAccountForSite.what)).toBeTruthy();
    expect(screen.getByText(ACTION_HELP.deleteSession.what)).toBeTruthy();
    expect(screen.getByText(ACTION_HELP.deleteSession.gotcha ?? '')).toBeTruthy();
  });

  it('shows the whole address on its own line, with the page title moved below it', () => {
    // With the address, the state pill and the title on one line, the address was the
    // part that got cut off ("localho…") — and it is the part that tells sessions apart.
    render(<SessionRow session={view({ site: 'http://ifpghub.localhost:3000', label: 'Workspace · Super admin' })} {...noop} />);
    const address = screen.getByText('ifpghub.localhost:3000');
    expect(address.getAttribute('title')).toBe('http://ifpghub.localhost:3000');
    expect(address.parentElement?.textContent).not.toContain('Workspace');
    expect(screen.getByText(/Workspace · Super admin · /)).toBeTruthy();
  });
});

