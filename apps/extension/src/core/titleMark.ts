// Pure: the persona marker at the front of a page title.
//
// A title cannot carry colour, so the persona's colour travels as a coloured emoji in
// front of it (`💙 Dashboard`). The content script re-applies it whenever the app sets a
// new title — single-page apps do so on every route — which is why both directions are
// written to be idempotent: applying twice or stripping twice must change nothing.

/** What separates the marker from the app's own title. */
export const TITLE_MARK_SEPARATOR = ' ';

/**
 * Whether `title` already carries `mark` at the front.
 *
 * Two shapes count: `mark + separator + rest`, and the bare `mark` on its own. The second
 * is what the browser hands back for a page with NO title of its own: we write
 * `"💚 "` (marker, separator, empty title), but `document.title` normalises its value by
 * trimming whitespace, so reading it back gives `"💚"`. A check for the prefix alone
 * missed that, marked it again, and the tab showed `"💚 💚"` until the app set a real
 * title.
 */
function isMarked(title: string, mark: string): boolean {
  return title === mark || title.startsWith(`${mark}${TITLE_MARK_SEPARATOR}`);
}

/** The title with `mark` in front, exactly once. An empty title becomes just the mark. */
export function withTitleMark(title: string, mark: string): string {
  if (isMarked(title, mark)) return title;
  return title.trim() === '' ? mark : `${mark}${TITLE_MARK_SEPARATOR}${title}`;
}

/** The title with `mark` removed from the front, if it is there. */
export function withoutTitleMark(title: string, mark: string): string {
  if (title === mark) return '';
  const prefix = `${mark}${TITLE_MARK_SEPARATOR}`;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}
