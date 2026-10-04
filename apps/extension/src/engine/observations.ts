// What the engine has actually OBSERVED per origin — the only thing the badge may make
// claims from.
//
// Deliberately pessimistic and non-durable: observations are re-earned each browser
// run, because "we saw a shim install three days ago" is not evidence that one is
// installed now.

import { EMPTY_OBSERVATIONS, type OriginObservations } from '@/core/coverage';
import type { ShimFacts } from '@/domain/messages';
import type { Origin } from '@/domain/types';

const byOrigin = new Map<Origin, OriginObservations>();

function patch(origin: Origin, delta: Partial<OriginObservations>): void {
  byOrigin.set(origin, { ...(byOrigin.get(origin) ?? EMPTY_OBSERVATIONS), ...delta });
}

export function observationsFor(origin: Origin): OriginObservations {
  return byOrigin.get(origin) ?? EMPTY_OBSERVATIONS;
}

export function observedOrigins(): Origin[] {
  return [...byOrigin.keys()].sort();
}

export function noteShimReady(origin: Origin, facts: ShimFacts): void {
  patch(origin, { shimInstalled: true, ...facts });
}

export function noteCookiesSeen(origin: Origin): void {
  patch(origin, { hasCookies: true });
}
