// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SESSION_STATE, StateDot } from '../session-state';
import type { SessionState } from '@/domain/types';

describe('StateDot', () => {
  it.each(Object.keys(SESSION_STATE) as SessionState[])('announces the %s state by name and can take focus', (state) => {
    render(<StateDot state={state} />);
    const dot = screen.getByRole('img', { name: SESSION_STATE[state].label });
    // Focusable, so the explanation card is reachable from the keyboard.
    expect(dot.getAttribute('tabindex')).toBe('0');
    // No visible word: the pill's text is exactly what this dot replaced.
    expect(dot.textContent).toBe('');
  });
});
