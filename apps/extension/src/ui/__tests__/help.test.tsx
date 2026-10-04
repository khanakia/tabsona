// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  ACTION_HELP, HELP_CARD_DELAY_MS, LAYER_PLAIN, confirmDeletePersona, confirmForgetLogin, confirmReplaceLogin, isolationHelp,
} from '../help';
import { ConfirmDialog } from '../ConfirmDialog';
import { HelpCardBody, WithHelp } from '../HelpCard';
import { FeedbackBanner } from '../FeedbackBanner';
import { HowItWorks } from '../HowItWorks';

/** No module mocks: every component here renders from plain data. */

/** Every entry, with its id for failure messages. `entries` keeps the value typed, so no
 *  cast is needed to walk the table. */
const entries = Object.entries(ACTION_HELP);

describe('ACTION_HELP', () => {
  it('answers all three questions for every action', () => {
    for (const [id, h] of entries) {
      expect(h.label.trim(), id).not.toBe('');
      expect(h.what.trim(), id).not.toBe('');
      expect(h.touches.trim(), id).not.toBe('');
      if (h.gotcha !== undefined) expect(h.gotcha.trim(), id).not.toBe('');
    }
  });

  it('gives every action a distinct label, so two buttons never read the same', () => {
    const labels = entries.map(([, h]) => h.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('keeps insider words out of the explanations', () => {
    // Written for someone who has never heard of cookies. "session", "isolated" and
    // "jar" were the words that made the old popup unreadable.
    const jargon = /\b(cookie|session|isolat|jar|storage|DNR|header)/i;
    for (const [id, h] of entries) {
      expect(`${h.what} ${h.touches} ${h.gotcha ?? ''}`, id).not.toMatch(jargon);
    }
  });

  it('warns on every choice that changes or shares the normal browser login', () => {
    for (const id of ['moveLogin', 'copyLogin', 'newPersonaFromLogin', 'duplicatePersona', 'deletePersona'] as const) {
      expect(ACTION_HELP[id].gotcha, id).toBeTruthy();
    }
  });
});

describe('isolationHelp', () => {
  it('tells an empty tab to sign in, rather than claiming it is protected', () => {
    expect(isolationHelp({ isEmpty: true, leakingLayers: [] }).label).toBe('Not signed in yet');
  });

  it('names every leaking layer in plain words', () => {
    const h = isolationHelp({ isEmpty: false, leakingLayers: ['serviceWorker', 'indexedDB'] });
    expect(h.label).toBe('Partly separate');
    expect(h.gotcha).toContain(LAYER_PLAIN.serviceWorker);
    expect(h.gotcha).toContain(LAYER_PLAIN.indexedDB);
  });

  it('says separate only when nothing leaks', () => {
    expect(isolationHelp({ isEmpty: false, leakingLayers: [] }).label).toBe('Separate');
  });
});

describe('HelpCardBody', () => {
  it('shows what happens, what it touches and the gotcha', () => {
    render(<HelpCardBody help={ACTION_HELP.copyLogin} />);
    expect(screen.getByText(ACTION_HELP.copyLogin.what)).toBeTruthy();
    expect(screen.getByText(ACTION_HELP.copyLogin.touches)).toBeTruthy();
    expect(screen.getByText(ACTION_HELP.copyLogin.gotcha ?? '')).toBeTruthy();
  });

  it('leads with the name only when asked, for icon-only controls', () => {
    const { rerender } = render(<HelpCardBody help={ACTION_HELP.saveNow} />);
    expect(screen.queryByText(ACTION_HELP.saveNow.label)).toBeNull();
    rerender(<HelpCardBody help={ACTION_HELP.saveNow} titled />);
    expect(screen.getByText(ACTION_HELP.saveNow.label)).toBeTruthy();
  });
});

describe('WithHelp', () => {
  it('keeps the wrapped control clickable and opens the card on keyboard focus', async () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<WithHelp help={ACTION_HELP.openAll} trigger={<button type="button" onClick={onClick} />}>Open all</WithHelp>);
    const button = screen.getByRole('button', { name: 'Open all' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    // Keyboard focus must open it too: help that only appears for a mouse is not help.
    await act(async () => { button.focus(); vi.advanceTimersByTime(HELP_CARD_DELAY_MS + 50); });
    expect(screen.getByText(ACTION_HELP.openAll.what)).toBeTruthy();
    vi.useRealTimers();
  });
});

describe('FeedbackBanner', () => {
  it('announces itself and can be dismissed', () => {
    const onDismiss = vi.fn();
    render(<FeedbackBanner tone="success" text="Saved." onDismiss={onDismiss} />);
    expect(screen.getByRole('status').textContent).toContain('Saved.');
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('HowItWorks', () => {
  it('points at the real button names, so the guide cannot go stale', () => {
    render(<HowItWorks />);
    expect(screen.getByText(new RegExp(ACTION_HELP.addToPersona.label))).toBeTruthy();
    expect(screen.getByText(new RegExp(ACTION_HELP.openAll.label))).toBeTruthy();
  });
});

describe('confirmation wording', () => {
  it('names the persona and the outcome, never a bare OK', () => {
    const r = confirmDeletePersona('ifpg-sa');
    expect(r.title).toContain('ifpg-sa');
    expect(r.confirmLabel).toBe(ACTION_HELP.deletePersona.label);
    expect(r.destructive).toBe(true);
  });

  it('says forgetting a login does not sign the website out', () => {
    expect(confirmForgetLogin().body).toContain(ACTION_HELP.deleteSession.touches);
  });

  it('names both the persona and the site being replaced', () => {
    const r = confirmReplaceLogin('ifpg-sa', 'http://localhost:2165');
    expect(r.title).toContain('http://localhost:2165');
    expect(r.body).toContain('ifpg-sa');
  });
});

describe('ConfirmDialog', () => {
  it('renders nothing while there is no question', () => {
    render(<ConfirmDialog request={null} onAnswer={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('answers yes only from the confirm button, and no from cancel', () => {
    const onAnswer = vi.fn();
    const request = confirmDeletePersona('ifpg-sa');
    const { rerender } = render(<ConfirmDialog request={request} onAnswer={onAnswer} />);
    expect(screen.getByText(request.title)).toBeTruthy();
    fireEvent.click(screen.getByText(request.confirmLabel));
    rerender(<ConfirmDialog request={request} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onAnswer.mock.calls).toEqual([[true], [false]]);
  });
});
