// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { FullText } from '../FullText';
import { HELP_CARD_DELAY_MS } from '../help';

/**
 * jsdom does no layout, so every element reports zero widths. Each case sets the two
 * widths the component compares, on the prototype, and puts them back afterwards.
 * No module mocks.
 */
function widths(scroll: number, client: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scroll });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => client });
}
afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  vi.useRealTimers();
});

const line = <p data-testid="line" className="truncate" />;

describe('FullText', () => {
  it('shows the whole text in a card when the line is cut off', async () => {
    vi.useFakeTimers();
    widths(400, 200);
    render(<FullText line={line} full="Hub brand workspace admin for every brand in the tenant">Hub brand…</FullText>);
    const trigger = screen.getByTestId('line');
    expect(trigger.tabIndex).toBe(0);
    await act(async () => { trigger.focus(); vi.advanceTimersByTime(HELP_CARD_DELAY_MS + 50); });
    expect(screen.getByText('Hub brand workspace admin for every brand in the tenant')).toBeTruthy();
  });

  it('stays quiet when the whole line already fits', async () => {
    vi.useFakeTimers();
    widths(100, 200);
    render(<FullText line={line} full="Short">Short</FullText>);
    const trigger = screen.getByTestId('line');
    expect(trigger.tabIndex).toBe(-1);
    await act(async () => { trigger.focus(); vi.advanceTimersByTime(HELP_CARD_DELAY_MS + 50); });
    expect(screen.getAllByText('Short')).toHaveLength(1);
  });
});
