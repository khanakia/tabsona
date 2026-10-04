// Pure: the persona marker at the front of a page title.
//
// A title cannot carry colour, so the persona's colour travels as a coloured emoji in
// front of it (`💙 Dashboard`). The content script re-applies it whenever the app sets a
// new title — single-page apps do so on every route — which is why both directions are
// written to be idempotent: applying twice or stripping twice must change nothing.

/** What separates the marker from the app's own title. */
export const TITLE_MARK_SEPARATOR = ' ';

/** The title with `mark` in front, exactly once. */
export function withTitleMark(title: string, mark: string): string {
  const prefix = `${mark}${TITLE_MARK_SEPARATOR}`;
  return title.startsWith(prefix) ? title : `${prefix}${title}`;
}

/** The title with `mark` removed from the front, if it is there. */
export function withoutTitleMark(title: string, mark: string): string {
  const prefix = `${mark}${TITLE_MARK_SEPARATOR}`;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}
