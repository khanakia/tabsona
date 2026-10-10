// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CurrentTabBar } from '../CurrentTabBar';
import { ACTION_HELP, SIGN_IN_LEAKED } from '@/ui/help';
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
  unguardedSignInSites: [], leakedSignInSites: [], usesNormalLogin: false, ...over,
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
  onStartOver: () => undefined,
};

const openJoin = () => fireEvent.click(screen.getByText(ACTION_HELP.addToPersona.label));
const choose = (id: 'useTabSignedOut' | 'moveLogin' | 'copyLogin') => fireEvent.click(screen.getByText(ACTION_HELP[id].label));

describe('CurrentTabBar — a signed-in PLAIN tab', () => {
  const personas = [persona(), persona({ id: 'p_2', name: 'Client X', color: '#10b981' })];

  it('says in words that the tab uses the normal login', () => {
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} />);
    expect(screen.getByText(/your normal login, not in a persona/)).toBeTruthy();
  });

  it('asks HOW first, with all three ways explained, before any persona can be clicked', () => {
    // The consequence is read before a persona name is even on screen.
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} />);
    openJoin();
    for (const id of ['useTabSignedOut', 'moveLogin', 'copyLogin'] as const) {
      expect(screen.getByText(ACTION_HELP[id].label)).toBeTruthy();
    }
    expect(screen.queryByText('Acme admin')).toBeNull();
  });

  it('says what each choice does to the normal browser login before it is picked', () => {
    // The exact question a user reported every icon left unanswered.
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} />);
    openJoin();
    expect(screen.getByText(ACTION_HELP.copyLogin.gotcha ?? '')).toBeTruthy();
    expect(screen.getByText(ACTION_HELP.moveLogin.gotcha ?? '')).toBeTruthy();
  });

  it('then lists every persona, and routes MOVE and COPY as different intentions', () => {
    // The user decides whether the browser keeps the login; we never decide for them.
    const onSaveTo = vi.fn();
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} onSaveTo={onSaveTo} />);
    openJoin();
    choose('moveLogin');
    expect(screen.getByText('Client X')).toBeTruthy();
    fireEvent.click(screen.getByText('Acme admin'));
    openJoin();
    choose('copyLogin');
    fireEvent.click(screen.getByText('Acme admin'));
    expect(onSaveTo.mock.calls).toEqual([['p_1', 'move'], ['p_1', 'copy']]);
  });

  it('routes a signed-out tab separately from an import', () => {
    const onUseTabIn = vi.fn();
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} onUseTabIn={onUseTabIn} />);
    openJoin();
    choose('useTabSignedOut');
    fireEvent.click(screen.getByText('Acme admin'));
    expect(onUseTabIn).toHaveBeenCalledWith('p_1');
  });

  it('offers a new persona only when moving, the one choice that creates it', () => {
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} />);
    openJoin();
    choose('copyLogin');
    expect(screen.queryByText(ACTION_HELP.newPersonaFromLogin.label)).toBeNull();
    fireEvent.click(screen.getByLabelText('Back'));
    choose('moveLogin');
    expect(screen.getByText(ACTION_HELP.newPersonaFromLogin.label)).toBeTruthy();
  });

  it('can be cancelled without doing anything', () => {
    const onSaveTo = vi.fn();
    const onUseTabIn = vi.fn();
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} onSaveTo={onSaveTo} onUseTabIn={onUseTabIn} />);
    openJoin();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText(ACTION_HELP.addToPersona.label)).toBeTruthy();
    expect(onSaveTo).not.toHaveBeenCalled();
    expect(onUseTabIn).not.toHaveBeenCalled();
  });

  it('tells someone with no personas how to make one, instead of an empty list', () => {
    render(<CurrentTabBar tab={tab()} personas={[]} {...noop} />);
    openJoin();
    choose('copyLogin');
    expect(screen.getByText(/no personas yet/)).toBeTruthy();
  });

  it('offers another account on this site, in a persona that lacks it or a new one', () => {
    const onAddToPersona = vi.fn();
    const onAnotherLogin = vi.fn();
    render(<CurrentTabBar tab={tab()} personas={personas} {...noop} onAddToPersona={onAddToPersona} onAnotherLogin={onAnotherLogin} />);
    fireEvent.click(screen.getByText(ACTION_HELP.anotherAccountHere.label));
    fireEvent.click(screen.getByText(`${ACTION_HELP.addSiteToPersona.label} Client X`));
    fireEvent.click(screen.getByText(ACTION_HELP.anotherAccountHere.label));
    fireEvent.click(screen.getByText(ACTION_HELP.anotherAccountNewPersona.label));
    expect(onAddToPersona).toHaveBeenCalledWith('p_2', 'https://sync.localhost');
    expect(onAnotherLogin).toHaveBeenCalledWith('https://sync.localhost');
  });
});

describe('CurrentTabBar — other states', () => {
  it('offers the grant, and nothing else, on a site that is not allowed yet', () => {
    render(<CurrentTabBar tab={tab({ siteAllowed: false })} personas={[persona()]} {...noop} />);
    // The button reads "Allow"; its accessible name carries the full meaning and the site.
    expect(screen.getByRole('button', { name: `${ACTION_HELP.allowSite.label}: sync.localhost` })).toBeTruthy();
    expect(screen.queryByText(ACTION_HELP.addToPersona.label)).toBeNull();
  });

  it('offers nothing on a chrome:// page, because nothing there can hold a login', () => {
    render(<CurrentTabBar tab={tab({ isWebPage: false, site: null })} personas={[persona()]} {...noop} />);
    expect(screen.getByText(/Go to a website/)).toBeTruthy();
    expect(screen.queryByText(ACTION_HELP.addToPersona.label)).toBeNull();
  });

  const inPersona = (over: Partial<TabStatus> = {}) => tab({
    sessionId: 's_1', personaId: 'p_1', personaName: 'Acme admin', color: '#3b82f6', summary: 'isolated', ...over,
  });

  it('names the persona and says the tab is separate, in words', () => {
    render(<CurrentTabBar tab={inPersona()} personas={[persona()]} {...noop} />);
    expect(screen.getByText('Acme admin')).toBeTruthy();
    expect(screen.getByText('Separate')).toBeTruthy();
  });

  it('tells an empty session to sign in rather than claiming separation', () => {
    render(<CurrentTabBar tab={inPersona({ isEmpty: true })} personas={[persona()]} {...noop} />);
    expect(screen.getByText('Not signed in yet')).toBeTruthy();
  });

  it('never shows a leaking tab as fully separate', () => {
    // Project rule: degradation is surfaced, never hidden behind a green shield.
    render(
      <CurrentTabBar
        tab={inPersona({ coverage: [{ layer: 'serviceWorker', status: 'leaking', detail: 'shared' }] })}
        personas={[persona()]}
        {...noop}
      />,
    );
    expect(screen.getByText('Partly separate')).toBeTruthy();
    expect(screen.queryByText('Separate')).toBeNull();
  });

  it('names a sign-in website it may not touch and allows exactly that one', () => {
    // The re-added persona that came back as the browser's admin: its sign-in went
    // through a provider Tabsona had no permission on. The fix is one click away.
    const onAllowSite = vi.fn();
    render(
      <CurrentTabBar
        tab={inPersona({ unguardedSignInSites: ['https://api.workos.com'] })}
        personas={[persona()]}
        {...noop}
        onAllowSite={onAllowSite}
      />,
    );
    expect(screen.getByText('api.workos.com')).toBeTruthy();
    fireEvent.click(screen.getByText(`${ACTION_HELP.allowSignInSite.label} api.workos.com`));
    expect(onAllowSite).toHaveBeenCalledWith('https://api.workos.com');
  });

  it('shows no sign-in warning when every sign-in website is allowed', () => {
    render(<CurrentTabBar tab={inPersona()} personas={[persona()]} {...noop} />);
    expect(screen.queryByText(/Signs in through/)).toBeNull();
    expect(screen.queryByText(SIGN_IN_LEAKED.label)).toBeNull();
    expect(screen.queryByRole('button', { name: ACTION_HELP.startOver.label })).toBeNull();
  });

  it('says a leaked sign-in was not saved, and Start over names the session', () => {
    // A persona whose sign-in went through a website Tabsona was not allowed on: the login
    // that came back was refused, and starting over is the way back.
    const onStartOver = vi.fn();
    render(
      <CurrentTabBar
        tab={inPersona({ leakedSignInSites: ['https://api.workos.com'] })}
        personas={[persona()]}
        {...noop}
        onStartOver={onStartOver}
      />,
    );
    expect(screen.getByText(SIGN_IN_LEAKED.label)).toBeTruthy();
    expect(screen.getByText(/api\.workos\.com\) · login not saved/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ACTION_HELP.startOver.label }));
    expect(onStartOver).toHaveBeenCalledWith('s_1');
  });

  it('on a website the user chose to reach with their normal login, says so and never "Separate"', () => {
    render(<CurrentTabBar tab={inPersona({ usesNormalLogin: true, summary: 'uses your normal login (your choice)' })} personas={[persona()]} {...noop} />);
    expect(screen.getByText('Uses your normal login')).toBeTruthy();
    expect(screen.queryByText('Separate')).toBeNull();
  });

  it('labels every footer action with a word, and routes save and leave', () => {
    const onSaveNow = vi.fn();
    const onUnbind = vi.fn();
    render(<CurrentTabBar tab={inPersona()} personas={[persona()]} {...noop} onSaveNow={onSaveNow} onUnbind={onUnbind} />);
    fireEvent.click(screen.getByText(ACTION_HELP.saveNow.label));
    fireEvent.click(screen.getByText(ACTION_HELP.leavePersona.label));
    expect(screen.getByText(ACTION_HELP.anotherAccountHere.label)).toBeTruthy();
    expect(onSaveNow).toHaveBeenCalledWith(7);
    expect(onUnbind).toHaveBeenCalledWith(7);
  });
});
