// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CurrentTabBar } from '../CurrentTabBar';
import type { TabStatus } from '@/domain/messages';
import type { PersonaView } from '@/domain/types';

/**
 * No `vi.mock` of any module path — the bar renders from plain objects. `vi` is used
 * only for callback spies.
 *
 * This file exists because the footer is where every "how do I…" question lands, and a
 * browser check of it is awkward: opening the popup AS A TAB makes the popup itself the
 * active tab, so the bar correctly renders its "this is not a web page" branch and the
 * real controls are nowhere to be found. Rendering the component directly asks the
 * question properly.
 */
const persona = (over: Partial<PersonaView> = {}): PersonaView => ({
  id: 'p_1', name: 'Acme admin', description: '', color: '#3b82f6',
  sessions: [], openTabCount: 0, lastUsedAt: 0, ...over,
});

const tab = (over: Partial<TabStatus> = {}): TabStatus => ({
  tabId: 7, url: 'https://sync.localhost/', site: 'https://sync.localhost',
  isWebPage: true, siteAllowed: true, sessionId: null, personaId: null,
  personaName: null, color: null, isEmpty: false, coverage: [], summary: 'not isolated',
  ...over,
});

const noop = {
  onSaveTo: () => undefined,
  onUseTabIn: () => undefined,
  onAllowSite: () => undefined,
  onUnbind: () => undefined,
  onSaveNow: () => undefined,
  onNewPersonaWithTab: () => undefined,
  onAnotherLogin: () => undefined,
  onAddToPersona: () => undefined,
};

describe('CurrentTabBar — a signed-in PLAIN tab', () => {
  const personas = [persona(), persona({ id: 'p_2', name: 'Client X', color: '#10b981' })];

  it('says the tab is not isolated', () => {
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} />);
    expect(screen.getByText(/not isolated/)).toBeTruthy();
  });

  it('offers all three ways to use the tab, not just one', () => {
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} />);
    fireEvent.click(screen.getByText('Use this tab'));
    expect(screen.getByText('Sign in fresh, in…')).toBeTruthy();
    expect(screen.getByText('Move the login I am using into…')).toBeTruthy();
    expect(screen.getByText(/Copy it into…/)).toBeTruthy();
  });

  it('lists every persona under each of move and copy', () => {
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} />);
    fireEvent.click(screen.getByText('Use this tab'));
    // Two personas × three groups (fresh / move / copy).
    expect(screen.getAllByText('Acme admin')).toHaveLength(3);
    expect(screen.getAllByText('Client X')).toHaveLength(3);
  });

  it('reports MOVE and COPY as different intentions', () => {
    // The whole reason the menu is three groups rather than one list: the user decides
    // whether the browser keeps the login, and we never decide for them.
    const onSaveTo = vi.fn();
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} onSaveTo={onSaveTo} />);
    fireEvent.click(screen.getByText('Use this tab'));
    const [, move, copy] = screen.getAllByText('Acme admin');
    fireEvent.click(move as HTMLElement);
    fireEvent.click(screen.getByText('Use this tab'));
    fireEvent.click(screen.getAllByText('Acme admin')[2] as HTMLElement);
    void copy;
    expect(onSaveTo.mock.calls).toEqual([['p_1', 'move'], ['p_1', 'copy']]);
  });

  it('warns that a copy shares one server session', () => {
    // Said inline, where the choice is made — not buried in docs nobody opens.
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} />);
    fireEvent.click(screen.getByText('Use this tab'));
    expect(screen.getByText(/signing out in either place ends both/i)).toBeTruthy();
  });

  it('routes a blank session separately from an import', () => {
    const onUseTabIn = vi.fn();
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} onUseTabIn={onUseTabIn} />);
    fireEvent.click(screen.getByText('Use this tab'));
    fireEvent.click(screen.getAllByText('Acme admin')[0] as HTMLElement);
    expect(onUseTabIn).toHaveBeenCalledWith('p_1');
  });
});

describe('CurrentTabBar — other states', () => {
  it('offers the grant, and nothing else, on a site that is not allowed yet', () => {
    render(<CurrentTabBar tab={tab({ siteAllowed: false })} personas={[persona()]} {...noop} />);
    expect(screen.getByText('Allow this site')).toBeTruthy();
    expect(screen.queryByText('Use this tab')).toBeNull();
  });

  it('offers nothing on a chrome:// page, because nothing there can hold a login', () => {
    render(<CurrentTabBar tab={tab({ isWebPage: false, site: null })} personas={[persona()]} {...noop} />);
    expect(screen.getByText(/Open a website/)).toBeTruthy();
    expect(screen.queryByText('Use this tab')).toBeNull();
  });

  it('names the persona and its coverage once the tab is isolated', () => {
    render(
      <CurrentTabBar
        tab={tab({ sessionId: 's_1', personaId: 'p_1', personaName: 'Acme admin', color: '#3b82f6', summary: 'isolated' })}
        personas={[persona()]}
        {...noop}
      />,
    );
    expect(screen.getByText('Acme admin')).toBeTruthy();
    expect(screen.getByText('isolated')).toBeTruthy();
  });

  it('tells an empty session to sign in rather than claiming isolation', () => {
    render(
      <CurrentTabBar
        tab={tab({ sessionId: 's_1', personaName: 'Acme admin', isEmpty: true, summary: 'isolated' })}
        personas={[persona()]}
        {...noop}
      />,
    );
    expect(screen.getByText('sign in to save')).toBeTruthy();
  });
});
