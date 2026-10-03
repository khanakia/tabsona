// Pure: decide what the badge is allowed to claim about a given origin.
//
// Coverage exists because the honest failure mode of this whole category is a tool
// that LOOKS isolated while leaking. Rather than assert isolation, the engine
// reports per layer, and anything it cannot vouch for is said out loud.

import type { EngineKind, LayerCoverage, StateLayer } from '@/domain/types';

/** Facts the background has observed about one origin, from real signals only. */
export interface OriginObservations {
  /** A service worker was seen controlling this origin. Its own fetches carry NO
   *  tab id, so they match no per-tab rule — an unfixable bypass in this model. */
  readonly hasServiceWorker: boolean;
  /** The MAIN-world shim reported itself installed on this origin. */
  readonly shimInstalled: boolean;
  /** A cross-origin iframe was seen; our shim cannot reach its session identity. */
  readonly hasCrossOriginFrame: boolean;
  /** The page touched IndexedDB. Not namespaced yet, so this is a known leak. */
  readonly usesIndexedDb: boolean;
  /** At least one cookie has been captured for this session on this origin. */
  readonly hasCookies: boolean;
}

/** The starting point for an origin nothing has been observed about yet. Everything is
 *  false, so coverage defaults to "unknown"/"leaking" rather than to an optimistic
 *  claim — absence of evidence must never read as isolation. */
export const EMPTY_OBSERVATIONS: OriginObservations = {
  hasServiceWorker: false,
  shimInstalled: false,
  hasCrossOriginFrame: false,
  usesIndexedDb: false,
  hasCookies: false,
};

const LAYER_ORDER: readonly StateLayer[] = [
  'cookies',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'serviceWorker',
  'sharedWorker',
  'crossOriginFrames',
];

/**
 * Compute coverage for one origin under one engine.
 *
 * Deliberately pessimistic: a layer is `covered` only when something was actually
 * observed to make it so. Absence of evidence is reported as `unknown`, never as
 * success, because an optimistic default is exactly how a tool ends up lying.
 */
export function computeCoverage(
  engine: EngineKind,
  obs: OriginObservations,
): LayerCoverage[] {
  const out: Record<StateLayer, LayerCoverage> = {
    cookies: obs.hasCookies
      ? { layer: 'cookies', status: 'covered', detail: 'Cookies are served per tab from this session.' }
      : { layer: 'cookies', status: 'unknown', detail: 'No cookie seen yet on this origin.' },

    localStorage: obs.shimInstalled
      ? { layer: 'localStorage', status: 'covered', detail: 'Namespaced per session by the page shim.' }
      : { layer: 'localStorage', status: 'leaking', detail: 'Shim not installed here — storage is shared with other tabs.' },

    // Free, and the one layer nothing has to be built for.
    sessionStorage: { layer: 'sessionStorage', status: 'covered', detail: 'Already isolated per tab by the browser.' },

    indexedDB: obs.usesIndexedDb
      ? { layer: 'indexedDB', status: 'leaking', detail: 'This origin uses IndexedDB, which is not namespaced yet.' }
      : { layer: 'indexedDB', status: 'unknown', detail: 'No IndexedDB use observed.' },

    serviceWorker: obs.hasServiceWorker
      ? { layer: 'serviceWorker', status: 'leaking', detail: 'A service worker is active; its own fetches carry no tab id and bypass per-tab rules.' }
      : { layer: 'serviceWorker', status: 'not-applicable', detail: 'No service worker seen on this origin.' },

    sharedWorker: obs.shimInstalled
      ? { layer: 'sharedWorker', status: 'covered', detail: 'SharedWorker removed, so the app falls back to a per-tab worker.' }
      : { layer: 'sharedWorker', status: 'unknown', detail: 'Shim not installed, so SharedWorker was not neutralised.' },

    crossOriginFrames: obs.hasCrossOriginFrame
      ? { layer: 'crossOriginFrames', status: 'leaking', detail: 'A cross-origin frame is present and cannot learn this session.' }
      : { layer: 'crossOriginFrames', status: 'not-applicable', detail: 'No cross-origin frame seen.' },
  };

  // Token injection makes no claim about page storage at all: it only rewrites a
  // header, so saying anything else about localStorage would be a lie.
  if (engine === 'token-injection') {
    out.localStorage = { layer: 'localStorage', status: 'not-applicable', detail: 'Token-injection sessions do not touch page storage.' };
    out.sharedWorker = { layer: 'sharedWorker', status: 'not-applicable', detail: 'Token-injection sessions do not touch the page.' };
  }

  return LAYER_ORDER.map((l) => out[l]);
}

/** The worst thing true of any layer — what the badge colour is driven by. */
export function worstStatus(coverage: readonly LayerCoverage[]): LayerCoverage['status'] {
  if (coverage.some((c) => c.status === 'leaking')) return 'leaking';
  if (coverage.some((c) => c.status === 'unknown')) return 'unknown';
  return 'covered';
}

/** One-line summary for the in-page badge. */
export function coverageSummary(coverage: readonly LayerCoverage[]): string {
  const leaking = coverage.filter((c) => c.status === 'leaking').map((c) => c.layer);
  if (leaking.length === 0) return 'isolated';
  return `leaking: ${leaking.join(', ')}`;
}
