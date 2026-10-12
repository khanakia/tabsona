// Pure: the persona marker at the front of a page title.
//
// A title cannot carry colour, so the persona's colour travels as a coloured emoji in
// front of it (`💙 Dashboard`). The content script re-applies it whenever the app sets a
// new title — single-page apps do so on every route — which is why both directions are
// written to be idempotent: applying twice or stripping twice must change nothing.

/** What separates the marker from the app's own title. */
export const TITLE_MARK_SEPARATOR = ' ';

/**
 * The title split into separator-delimited words, which is how a marker is found.
 *
 * A marker is a whole word, never a glyph inside one: "💚Green" is the app's own text.
 */
function words(title: string): string[] {
  return title.split(TITLE_MARK_SEPARATOR);
}

/**
 * The title with `mark` in front, exactly once. An empty title becomes just the mark.
 *
 * Already marked means the mark is a WORD ANYWHERE in the title, not only the first one.
 * Another extension may put its own prefix in front of ours: a tab suspender turned
 * `"💚 404"` into `"💤 💚 404"`, a front-only check marked it again, and the tab read
 * `"💚 💤 💚 404"`. Leaving such a title alone also keeps the two extensions from taking
 * turns at the front. A title already carrying the mark more than once keeps the first
 * and loses the rest, so a doubled title heals on the next write.
 *
 * The bare mark alone is also marked: we write `"💚 "` for a page with no title of its
 * own, and `document.title` trims it back to `"💚"`.
 */
export function withTitleMark(title: string, mark: string): string {
  const parts = words(title);
  const first = parts.indexOf(mark);
  if (first === -1) return title.trim() === '' ? mark : `${mark}${TITLE_MARK_SEPARATOR}${title}`;
  return parts.filter((word, i) => word !== mark || i === first).join(TITLE_MARK_SEPARATOR);
}

/** The title with every `mark` word removed, wherever another extension left it. */
export function withoutTitleMark(title: string, mark: string): string {
  return words(title).filter((word) => word !== mark).join(TITLE_MARK_SEPARATOR);
}
