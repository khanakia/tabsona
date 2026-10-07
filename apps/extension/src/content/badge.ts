// ISOLATED-world content script: draws the in-page session chip and relays the
// shim's self-report to the background.
//
// In the isolated world on purpose — it needs chrome.runtime, and page code must not
// be able to find or remove the chip that tells the user what is isolated.

import { shimFactsFrom } from '@/core/coverage';
import {
  BADGE_DOT_SIZE_PX, BADGE_EDGE_OFFSET_PX, BADGE_FONT, BADGE_PADDING, SEVERITY_RING, badgeLabel, type BadgeSeverity,
} from '@/core/badgeLook';
import { clampHideSeconds, isBadgeCorner, isBadgeStyle } from '@/core/settings';
import { pixelsToPlacement, placementFrom, placementToPixels } from '@/core/placement';
import { withTitleMark, withoutTitleMark } from '@/core/titleMark';
import {
  DEFAULT_SETTINGS, type BadgeCorner, type BadgeMovedNotice, type BadgeResetNotice, type ShimReadyNotice,
} from '@/domain/messages';

const CHIP_ID = '__tabsona_chip__';

const SEVERITY_BACKGROUND = SEVERITY_RING;
type Severity = BadgeSeverity;

interface BadgeMessage {
  readonly kind: 'badge:render' | 'badge:clear';
  /** False when the user switched the in-page badge off; the title marker may still apply. */
  readonly showBadge?: boolean;
  readonly name?: string;
  readonly color?: string;
  readonly severity?: Severity;
  readonly summary?: string;
  readonly isEmpty?: boolean;
  /** Validated on arrival: a message is untyped data, whoever sent it. */
  readonly position?: unknown;
  /** A dragged spot for this site, or null for the Settings corner. Validated too. */
  readonly placement?: unknown;
  /** The coloured marker for the page title, or null when marking is off. */
  readonly titleMark?: string | null;
  /** How the badge starts on this page ('label' | 'dot'). Validated on arrival. */
  readonly style?: unknown;
  /** Seconds after which the badge hides on this page; 0 = never. Validated on arrival. */
  readonly hideAfterSeconds?: unknown;
}

/** How long the badge takes to fade out when it auto-hides. */
const HIDE_FADE_MS = 300;
/** When the pointer is on the badge at hide time, check again this much later. */
const HIDE_RETRY_MS = 1000;

const EDGE_OFFSET = `${BADGE_EDGE_OFFSET_PX}px`;

const CORNER_STYLE: Record<BadgeCorner, Partial<CSSStyleDeclaration>> = {
  'top-left': { top: EDGE_OFFSET, left: EDGE_OFFSET },
  'top-right': { top: EDGE_OFFSET, right: EDGE_OFFSET },
  'bottom-left': { bottom: EDGE_OFFSET, left: EDGE_OFFSET },
  'bottom-right': { bottom: EDGE_OFFSET, right: EDGE_OFFSET },
};

const DOT_SIZE = `${BADGE_DOT_SIZE_PX}px`;

/** How far the pointer must move before a press counts as a drag rather than a click.
 *  Below it, a slightly shaky click still shrinks the badge instead of nudging it. */
const DRAG_THRESHOLD_PX = 4;

/**
 * Two taps closer together than this are a double-click.
 *
 * Detected by hand, and the single tap is DEFERRED by this long: a tap shrinks the badge
 * to a 14px dot, so acting on the first tap at once moved the target out from under the
 * cursor and the second tap of a double-click landed on the page instead. Waiting costs a
 * short delay on shrink and makes double-click reliable.
 */
const DOUBLE_TAP_MS = 350;

// Per-page UI state, deliberately not persisted: "shrink it" is a decision about the
// page in front of you, and a reload is the natural way to get the full badge back.
// (A DRAGGED position is persisted — by the worker, per site — because that is a
// decision about where the app keeps its buttons.)
let lastMessage: BadgeMessage | null = null;
let collapsed = false;
/** The marker currently in front of the title, so it can be swapped or removed exactly. */
let appliedMark: string | null = null;
/** A single tap waiting to see whether a second one follows (see DOUBLE_TAP_MS). */
let pendingTap: ReturnType<typeof setTimeout> | null = null;
/** True once the user has clicked the badge on this page: from then on their choice of
 *  dot or name wins over the Settings default, until reload. */
let userToggled = false;
/** Auto-hide: the pending timer, and whether the badge has already hidden on this page.
 *  Hidden stays hidden until reload — a badge that popped back on every status update
 *  would defeat the point of hiding it. */
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenForPage = false;

function clear(): void {
  document.getElementById(CHIP_ID)?.remove();
}

function render(msg: BadgeMessage): void {
  lastMessage = msg;
  if (!userToggled) collapsed = isBadgeStyle(msg.style) && msg.style === 'dot';
  scheduleHide(msg.hideAfterSeconds);
  draw();
  applyTitleMark(msg.titleMark ?? null);
}

/**
 * Start (or cancel) the auto-hide timer for this page.
 *
 * `seconds` is untrusted message data: anything other than a positive number means
 * "never hide", and a hide that was switched off brings the badge back immediately.
 */
function scheduleHide(seconds: unknown): void {
  const s = typeof seconds === 'number' && seconds > 0 ? clampHideSeconds(seconds) : null;
  if (s === null) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    hiddenForPage = false;
    return;
  }
  if (hideTimer || hiddenForPage) return;
  const attempt = () => {
    const chip = document.getElementById(CHIP_ID);
    // Never pull the badge out from under the pointer: wait until it leaves.
    if (chip?.matches(':hover')) { hideTimer = setTimeout(attempt, HIDE_RETRY_MS); return; }
    hideTimer = null;
    hiddenForPage = true;
    if (!chip) return;
    chip.style.transition = `opacity ${HIDE_FADE_MS}ms`;
    chip.style.opacity = '0';
    setTimeout(draw, HIDE_FADE_MS);
  };
  hideTimer = setTimeout(attempt, s * 1000);
}

function reset(): void {
  lastMessage = null;
  clear();
  applyTitleMark(null);
}

/** What the badge says when expanded — one definition, shared with the Settings preview. */
function badgeText(msg: BadgeMessage): string {
  return badgeLabel({
    name: String(msg.name ?? ''),
    ...(msg.isEmpty === undefined ? {} : { isEmpty: msg.isEmpty }),
    ...(msg.severity === undefined ? {} : { severity: msg.severity }),
    ...(msg.summary === undefined ? {} : { summary: msg.summary }),
  });
}

/** Viewport and badge size, for the placement maths in core/placement.ts. */
function sizes(el: HTMLElement) {
  return {
    viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    badge: { width: el.offsetWidth, height: el.offsetHeight },
  };
}

/** Pin the badge at an absolute spot, replacing any corner anchoring. */
function pinAt(el: HTMLElement, left: number, top: number): void {
  Object.assign(el.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
}

function draw(): void {
  clear();
  const msg = lastMessage;
  if (!msg || msg.showBadge === false || hiddenForPage || !document.documentElement) return;

  const ring = SEVERITY_BACKGROUND[msg.severity ?? 'unknown'];
  const corner = isBadgeCorner(msg.position) ? msg.position : DEFAULT_SETTINGS.badgePosition;
  const placement = placementFrom(msg.placement);
  const describe = msg.isEmpty
    ? `Tabsona — "${msg.name}" has no login saved yet. Sign in once and it will be remembered.`
    : `Tabsona — ${msg.name}: ${msg.summary ?? ''}`;

  const el = document.createElement('div');
  el.id = CHIP_ID;
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.title = `${describe}\n${collapsed ? 'Click to show the badge.' : 'Click to shrink it to a dot.'} Drag to move it; double-click to put it back.`;
  el.setAttribute('aria-label', el.title);
  el.textContent = collapsed ? '' : badgeText(msg);

  Object.assign(el.style, {
    position: 'fixed', zIndex: '2147483647',
    background: msg.color ?? ring,
    color: '#fff',
    font: BADGE_FONT,
    boxShadow: `0 1px 4px rgba(0,0,0,.35), 0 0 0 2px ${ring}`,
    cursor: 'grab', userSelect: 'none', letterSpacing: '.01em', touchAction: 'none',
    ...(collapsed
      ? { width: DOT_SIZE, height: DOT_SIZE, padding: '0', borderRadius: '50%' }
      : { padding: BADGE_PADDING, borderRadius: '999px' }),
    ...CORNER_STYLE[corner],
  } satisfies Partial<CSSStyleDeclaration>);
  document.documentElement.appendChild(el);

  // A dragged spot overrides the corner. Placed after appending, because the maths needs
  // the badge's real size to keep it fully on-screen.
  if (placement) {
    const { viewport, badge } = sizes(el);
    const { left, top } = placementToPixels(placement, viewport, badge);
    pinAt(el, left, top);
  }

  // The badge is ours, not the page's: a press on it must not also reach whatever the
  // page has underneath. The event's target is the badge, so no page control under it is
  // clicked; stopping propagation also keeps it from the page's bubble-phase handlers
  // (delegated and framework root listeners). A page capture listener on document still
  // sees it — that runs before any handler of ours, and cannot be prevented from here.
  const swallow = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  const toggle = () => {
    userToggled = true;
    collapsed = !collapsed;
    draw();
    document.getElementById(CHIP_ID)?.focus();
  };

  // Drag tracking lives on the WINDOW for the duration of a press, not on the badge: a
  // quick move leaves a 14px dot long before the badge could follow, and pointer capture
  // is not guaranteed to engage. Listeners are added on press and removed on release.
  el.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    swallow(down);
    const start = el.getBoundingClientRect();
    let dragging = false;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - down.clientX;
      const dy = e.clientY - down.clientY;
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      e.preventDefault();
      el.style.cursor = 'grabbing';
      const { viewport, badge } = sizes(el);
      const left = Math.min(Math.max(0, start.left + dx), viewport.width - badge.width);
      const top = Math.min(Math.max(0, start.top + dy), viewport.height - badge.height);
      pinAt(el, left, top);
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      swallow(e);
      el.style.cursor = 'grab';
      if (!dragging) {
        if (pendingTap) {
          // Second tap in time: a double-click. Cancel the shrink, put the badge back.
          clearTimeout(pendingTap);
          pendingTap = null;
          const notice: BadgeResetNotice = { op: 'badgeReset', origin: location.origin };
          void chrome.runtime.sendMessage(notice).catch(() => undefined);
        } else {
          pendingTap = setTimeout(() => { pendingTap = null; toggle(); }, DOUBLE_TAP_MS);
        }
        return;
      }
      // Remember the drop for this site; the worker stores it and redraws every tab on it.
      const r = el.getBoundingClientRect();
      const { viewport, badge } = sizes(el);
      const p = pixelsToPlacement(r.left, r.top, viewport, badge);
      const notice: BadgeMovedNotice = { op: 'badgeMoved', origin: location.origin, x: p.x, y: p.y };
      void chrome.runtime.sendMessage(notice).catch(() => undefined);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  });
  el.addEventListener('click', swallow);
  el.addEventListener('dblclick', swallow);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { swallow(e); toggle(); } });
}

// Keep a dragged badge on-screen when the window is resized: placements are fractions,
// so redrawing re-derives pixels from the new size.
window.addEventListener('resize', () => { if (lastMessage) draw(); });

// --- page title marker ---------------------------------------------------------------

/**
 * Put `mark` in front of the page title (or remove the marker when null), and keep it
 * there when the app changes its title.
 *
 * Single-page apps set `document.title` on every route, which replaces our prefix; the
 * observer re-applies it. Re-applying is idempotent (core/titleMark.ts), so our own write
 * triggering the observer again settles in one step instead of looping.
 */
function applyTitleMark(mark: string | null): void {
  const current = document.title;
  const bare = appliedMark ? withoutTitleMark(current, appliedMark) : current;
  appliedMark = mark;
  const next = mark ? withTitleMark(bare, mark) : bare;
  if (next !== current) document.title = next;
  watchTitle();
}

let titleObserver: MutationObserver | null = null;
function watchTitle(): void {
  if (titleObserver || !document.head) return;
  // Watch the whole head: an app may replace the <title> element rather than its text.
  titleObserver = new MutationObserver(() => {
    if (!appliedMark) return;
    const marked = withTitleMark(document.title, appliedMark);
    if (marked !== document.title) document.title = marked;
  });
  titleObserver.observe(document.head, { subtree: true, childList: true, characterData: true });
}

chrome.runtime.onMessage.addListener((raw: unknown) => {
  const msg = raw as BadgeMessage;
  if (msg?.kind === 'badge:render') render(msg);
  else if (msg?.kind === 'badge:clear') reset();
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data: unknown = event.data;
  const ready = typeof data === 'object' && data !== null ? (data as { __tabsonaReady?: unknown }).__tabsonaReady : undefined;
  const origin = typeof ready === 'object' && ready !== null ? (ready as { origin?: unknown }).origin : undefined;
  if (typeof origin !== 'string') return;
  // A one-way notification, NOT part of the request/response surface: the worker
  // handles it in a separate listener and sends nothing back. Typed on its own so it
  // does not have to be squeezed into the Request union it has no business in.
  const notice: ShimReadyNotice = { op: 'shimReady', origin, ...shimFactsFrom(ready) };
  void chrome.runtime.sendMessage(notice).catch(() => undefined);
});
