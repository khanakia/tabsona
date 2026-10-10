import { describe, expect, it } from 'vitest';
import { PERSONA_PALETTE } from '../constants';
import { TITLE_MARK_SEPARATOR, withTitleMark, withoutTitleMark } from '../titleMark';

/** What `document.title` does to any string written to it: trim and collapse whitespace. */
const asBrowserStores = (title: string) => title.replace(/\s+/g, ' ').trim();

/** The content script's loop: write the marked title, let the observer see what the
 *  browser stored, and mark again, until nothing changes (bounded, so a loop fails). */
function settle(title: string, mark: string): string {
  let current = asBrowserStores(title);
  for (let i = 0; i < 5; i++) {
    const next = asBrowserStores(withTitleMark(current, mark));
    if (next === current) return current;
    current = next;
  }
  throw new Error(`title never settled: ${JSON.stringify(current)}`);
}

describe.each(PERSONA_PALETTE.map((c) => [c.id, c.emoji] as const))('title mark %s', (_id, mark) => {
  it('puts the mark in front once, and marking again changes nothing', () => {
    const once = withTitleMark('Dashboard', mark);
    expect(once).toBe(`${mark}${TITLE_MARK_SEPARATOR}Dashboard`);
    expect(withTitleMark(once, mark)).toBe(once);
  });

  it('removes the mark exactly, and removing again changes nothing', () => {
    const once = withoutTitleMark(withTitleMark('Dashboard', mark), mark);
    expect(once).toBe('Dashboard');
    expect(withoutTitleMark(once, mark)).toBe('Dashboard');
  });

  it('an empty title becomes the mark alone and stays that way, never a doubled mark', () => {
    // The user-visible bug: a page with no title showed "💚 💚" until the app set one.
    // `document.title = "💚 "` reads back as "💚", which the prefix check then missed.
    expect(withTitleMark('', mark)).toBe(mark);
    expect(withTitleMark(mark, mark)).toBe(mark);
    expect(settle('', mark)).toBe(mark);
    expect(settle('   ', mark)).toBe(mark);
  });

  it('strips a mark-only title back to empty', () => {
    expect(withoutTitleMark(mark, mark)).toBe('');
  });

  it('settles in one step for an ordinary title once the browser has stored it', () => {
    expect(settle('Dashboard', mark)).toBe(`${mark} Dashboard`);
  });
});

describe('title mark edge cases', () => {
  it('does not treat a different mark as present', () => {
    expect(withTitleMark('💙 Dashboard', '💚')).toBe('💚 💙 Dashboard');
  });

  it('does not mistake a title that merely begins with the mark glyph for marked', () => {
    // "💚Green" has no separator, so it is the app\'s own text.
    expect(withTitleMark('💚Green', '💚')).toBe('💚 💚Green');
  });
});
