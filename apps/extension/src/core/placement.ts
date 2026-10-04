// Pure: where a dragged badge sits, stored per site.
//
// Stored as FRACTIONS of the free space (0 = left/top edge, 1 = right/bottom edge), not
// pixels, so a position dragged in a wide window still lands on-screen — and in the same
// relative spot — in a narrow one.

import type { Origin } from '@/domain/types';

/** A dragged badge position: fractions of the free space, each clamped to 0..1. */
export interface BadgePlacement {
  readonly x: number;
  readonly y: number;
}

/** Dragged positions by site. Absent site = use the corner from Settings. */
export type BadgePlacements = Readonly<Record<Origin, BadgePlacement>>;

/** Clamp a fraction into 0..1; anything not a finite number is null. */
function fraction(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

/** A placement from untrusted data (a message, storage), or null if it is not one. */
export function placementFrom(raw: unknown): BadgePlacement | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y } = raw as { x?: unknown; y?: unknown };
  const fx = fraction(x);
  const fy = fraction(y);
  return fx === null || fy === null ? null : { x: fx, y: fy };
}

/** Every stored placement, dropping any entry that is not a valid one. */
export function normalizePlacements(raw: unknown): BadgePlacements {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<Origin, BadgePlacement> = {};
  for (const [origin, value] of Object.entries(raw)) {
    const p = placementFrom(value);
    if (p) out[origin] = p;
  }
  return out;
}

/**
 * Pixel position for a placement in a viewport.
 *
 * The badge always stays fully on-screen: fractions scale the FREE space (viewport minus
 * badge), so 1 puts its right edge on the window's right edge rather than past it.
 */
export function placementToPixels(
  p: BadgePlacement,
  viewport: { readonly width: number; readonly height: number },
  badge: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number } {
  const freeX = Math.max(0, viewport.width - badge.width);
  const freeY = Math.max(0, viewport.height - badge.height);
  return { left: Math.round(p.x * freeX), top: Math.round(p.y * freeY) };
}

/** The inverse of placementToPixels: where a drop at `left, top` lands as fractions. */
export function pixelsToPlacement(
  left: number,
  top: number,
  viewport: { readonly width: number; readonly height: number },
  badge: { readonly width: number; readonly height: number },
): BadgePlacement {
  const freeX = Math.max(1, viewport.width - badge.width);
  const freeY = Math.max(1, viewport.height - badge.height);
  return { x: Math.min(1, Math.max(0, left / freeX)), y: Math.min(1, Math.max(0, top / freeY)) };
}
