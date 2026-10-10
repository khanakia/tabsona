// Pure: how the in-page badge looks — shared by the badge itself (content/badge.ts) and the
// live preview in Settings, so the preview can never drift from what pages actually show.

import type { BadgeCorner } from '@/domain/messages';

/** Severity drives the ring colour, because "isolated" and "leaking" must not look alike. */
export const SEVERITY_RING = {
  covered: 'rgba(16,185,129,.92)',
  unknown: 'rgba(245,158,11,.92)',
  leaking: 'rgba(239,68,68,.95)',
  'not-applicable': 'rgba(82,82,91,.92)',
  /** Blue: a choice, not a warning and not isolation. */
  shared: 'rgba(59,130,246,.95)',
} as const satisfies Record<string, string>;

/** How separate the page is, as the badge colours it. */
export type BadgeSeverity = keyof typeof SEVERITY_RING;

/** Offset from the viewport edge, in px, shared by every corner. */
export const BADGE_EDGE_OFFSET_PX = 8;

/** Diameter of the shrunk badge: big enough to click, small enough to cover nothing. */
export const BADGE_DOT_SIZE_PX = 14;

/** Text and box metrics of the expanded badge. */
export const BADGE_FONT = '600 11px/1.5 ui-sans-serif,system-ui,sans-serif';
export const BADGE_PADDING = '2px 8px';

/** Which edges a corner anchors to — `{ bottom, right }` for 'bottom-right', etc. */
export function cornerEdges(corner: BadgeCorner): { readonly vertical: 'top' | 'bottom'; readonly horizontal: 'left' | 'right' } {
  return {
    vertical: corner.startsWith('top') ? 'top' : 'bottom',
    horizontal: corner.endsWith('left') ? 'left' : 'right',
  };
}

/**
 * What the expanded badge says.
 *
 * The persona name is the identity; the rest is the honesty. A badge that only says
 * "admin" lets the user assume isolation it may not have — and, on a session with no
 * login saved yet, lets them read "signed out" as a broken button rather than the
 * intended first step.
 */
export function badgeLabel(p: {
  readonly name: string;
  readonly isEmpty?: boolean;
  readonly severity?: BadgeSeverity;
  readonly summary?: string;
}): string {
  if (p.isEmpty) return `${p.name} · sign in to save`;
  return p.severity === 'leaking' || p.severity === 'shared' ? `${p.name} · ${p.summary ?? ''}` : p.name;
}

/** Characters Chrome's toolbar badge shows legibly; longer text is cut by Chrome itself. */
const ACTION_BADGE_MAX_CHARS = 3;

/** Leads the toolbar badge when a sign-in host is un-allowed. One character, so the
 *  persona's initials still fit beside it. */
export const ACTION_BADGE_ALERT = '!';

/**
 * The text on the extension's TOOLBAR icon for a tab: the persona's first letters, led by
 * `!` while the tab's sign-in goes through a website Tabsona is not allowed on.
 *
 * Why the toolbar too: the popup's warning is only seen once someone opens the popup, and
 * a user missed it there ("it is hard to notice"). The toolbar icon is visible on every
 * page without a click and cannot be covered by the page.
 */
export function actionBadgeText(personaName: string | null, signInLeak: boolean): string {
  if (personaName === null) return '';
  if (!signInLeak) return personaName.slice(0, ACTION_BADGE_MAX_CHARS);
  return `${ACTION_BADGE_ALERT}${personaName.slice(0, ACTION_BADGE_MAX_CHARS - ACTION_BADGE_ALERT.length)}`;
}
