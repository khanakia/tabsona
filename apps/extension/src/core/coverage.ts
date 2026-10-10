// Pure: decide what the badge is allowed to claim about a given origin.
//
// Coverage exists because the honest failure mode of this whole category is a tool
// that LOOKS isolated while leaking. Rather than assert isolation, the engine
// reports per layer, and anything it cannot vouch for is said out loud.

import type { ShimFacts } from '@/domain/messages';
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
  /** The page opened an IndexedDB database. */
  readonly usesIndexedDb: boolean;
  /** The shim reported every IndexedDB name entry point translated per session. */
  readonly idbNamespaced: boolean;
  /** A dedicated Worker was started; its own IndexedDB is out of the shim's reach. */
  readonly usesWorker: boolean;
  /** At least one cookie has been captured for this session on this origin. */
  readonly hasCookies: boolean;
  /** Other websites this origin's sign-in redirected a persona tab to that the extension
   *  is NOT allowed on, so no per-tab rule applied there (core/signin.ts). Already
   *  filtered against the live permission set: allowing one removes it. */
  readonly unguardedSignInSites: readonly string[];
}

/** The starting point for an origin nothing has been observed about yet. Everything is
 *  false, so coverage defaults to "unknown"/"leaking" rather than to an optimistic
 *  claim — absence of evidence must never read as isolation. */
export const EMPTY_OBSERVATIONS: OriginObservations = {
  hasServiceWorker: false,
  shimInstalled: false,
  hasCrossOriginFrame: false,
  usesIndexedDb: false,
  idbNamespaced: false,
  usesWorker: false,
  hasCookies: false,
  unguardedSignInSites: [],
};

/**
 * Read the shim's facts out of an untyped message or script result.
 *
 * The one place an untrusted shape becomes `ShimFacts`: each field is accepted only when
 * it is literally `true`, so a missing or malformed field reads as "not observed" — the
 * pessimistic default this whole module is built on — and never as a claim.
 */
export function shimFactsFrom(raw: unknown): ShimFacts {
  const flag = (key: keyof ShimFacts): boolean =>
    typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>)[key] === true;
  return {
    usesIndexedDb: flag('usesIndexedDb'),
    idbNamespaced: flag('idbNamespaced'),
    usesWorker: flag('usesWorker'),
    hasServiceWorker: flag('hasServiceWorker'),
  };
}

/** `https://api.workos.com` → `api.workos.com`, for prose. Falls back to the input. */
function hostOf(origin: string): string {
  try { return new URL(origin).host; } catch { return origin; }
}

/** The layers an ordinary (separated) origin reports. `normalLogin` is not among them: it
 *  exists only on a pass-through host (passThroughCoverage). */
type SeparatedLayer = Exclude<StateLayer, 'normalLogin'>;

const LAYER_ORDER: readonly SeparatedLayer[] = [
  'cookies',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'serviceWorker',
  'sharedWorker',
  'crossOriginFrames',
  'signInSites',
];

/**
 * The IndexedDB layer, from observations only. See the table in docsi/SPEC_INDEXEDDB.md.
 *
 * Covered needs BOTH halves of the evidence: the shim said it translated every entry
 * point, and no dedicated worker was seen — a worker has its own `indexedDB` the shim
 * never runs in, so a page that starts one may be writing to the shared databases.
 */
function indexedDbCoverage(obs: OriginObservations): LayerCoverage {
  if (obs.shimInstalled && obs.idbNamespaced) {
    return obs.usesWorker
      ? { layer: 'indexedDB', status: 'leaking', detail: 'A worker on this page has its own IndexedDB the shim cannot reach.' }
      : { layer: 'indexedDB', status: 'covered', detail: 'Database names are namespaced per persona by the page shim.' };
  }
  if (obs.shimInstalled) {
    return { layer: 'indexedDB', status: 'leaking', detail: 'Namespacing could not be installed here — databases are shared.' };
  }
  return obs.usesIndexedDb
    ? { layer: 'indexedDB', status: 'leaking', detail: 'Shim not installed here — databases are shared with other tabs.' }
    : { layer: 'indexedDB', status: 'unknown', detail: 'No IndexedDB use observed.' };
}

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
  const out: Record<SeparatedLayer, LayerCoverage> = {
    cookies: obs.hasCookies
      ? { layer: 'cookies', status: 'covered', detail: 'Cookies are served per tab from this session.' }
      : { layer: 'cookies', status: 'unknown', detail: 'No cookie seen yet on this origin.' },

    localStorage: obs.shimInstalled
      ? { layer: 'localStorage', status: 'covered', detail: 'Namespaced per session by the page shim.' }
      : { layer: 'localStorage', status: 'leaking', detail: 'Shim not installed here — storage is shared with other tabs.' },

    // Free, and the one layer nothing has to be built for.
    sessionStorage: { layer: 'sessionStorage', status: 'covered', detail: 'Already isolated per tab by the browser.' },

    indexedDB: indexedDbCoverage(obs),

    serviceWorker: obs.hasServiceWorker
      ? { layer: 'serviceWorker', status: 'leaking', detail: 'A service worker is active; its own fetches carry no tab id and bypass per-tab rules.' }
      : { layer: 'serviceWorker', status: 'not-applicable', detail: 'No service worker seen on this origin.' },

    sharedWorker: obs.shimInstalled
      ? { layer: 'sharedWorker', status: 'covered', detail: 'SharedWorker removed, so the app falls back to a per-tab worker.' }
      : { layer: 'sharedWorker', status: 'unknown', detail: 'Shim not installed, so SharedWorker was not neutralised.' },

    crossOriginFrames: obs.hasCrossOriginFrame
      ? { layer: 'crossOriginFrames', status: 'leaking', detail: 'A cross-origin frame is present and cannot learn this session.' }
      : { layer: 'crossOriginFrames', status: 'not-applicable', detail: 'No cross-origin frame seen.' },

    // Leaking, not unknown: the hop was OBSERVED, and with no permission on that host the
    // browser's own login there is sent — measured, it signs a fresh persona tab in as
    // whoever the browser is.
    signInSites: obs.unguardedSignInSites.length > 0
      ? {
        layer: 'signInSites',
        status: 'leaking',
        detail: `Sign-in goes through ${obs.unguardedSignInSites.map(hostOf).join(', ')}, which Tabsona is not allowed on, so your normal browser login there is used.`,
      }
      : { layer: 'signInSites', status: 'not-applicable', detail: 'No sign-in through another website seen.' },
  };

  // Token injection makes no claim about page storage at all: it only rewrites a
  // header, so saying anything else about localStorage would be a lie.
  if (engine === 'token-injection') {
    out.localStorage = { layer: 'localStorage', status: 'not-applicable', detail: 'Token-injection sessions do not touch page storage.' };
    out.sharedWorker = { layer: 'sharedWorker', status: 'not-applicable', detail: 'Token-injection sessions do not touch the page.' };
  }

  return LAYER_ORDER.map((l) => out[l]);
}

/**
 * What the badge may claim on a website the user put on the "use my normal login" list.
 *
 * One layer, status `shared`: nothing here is kept separate BY CHOICE, which is neither
 * isolation nor a leak, so it is reported as neither (project rule 2: a tool that looks
 * isolated while sharing turns every later bug into a question about whether it lied).
 */
export function passThroughCoverage(): LayerCoverage[] {
  return [{
    layer: 'normalLogin',
    status: 'shared',
    detail: 'You chose to use your normal browser login on this website, so it is shared with your other tabs. The app’s own login stays separate.',
  }];
}

/** The worst thing true of any layer — what the badge colour is driven by. A shared
 *  (chosen) layer ranks below any real leak or unknown, above plain "covered". */
export function worstStatus(coverage: readonly LayerCoverage[]): LayerCoverage['status'] {
  if (coverage.some((c) => c.status === 'leaking')) return 'leaking';
  if (coverage.some((c) => c.status === 'unknown')) return 'unknown';
  if (coverage.some((c) => c.status === 'shared')) return 'shared';
  return 'covered';
}

/** What the badge says on a pass-through website. Never "isolated". */
export const SHARED_SUMMARY = 'uses your normal login (your choice)';

/** One-line summary for the in-page badge. */
export function coverageSummary(coverage: readonly LayerCoverage[]): string {
  const leaking = coverage.filter((c) => c.status === 'leaking').map((c) => c.layer);
  if (coverage.some((c) => c.status === 'shared')) return SHARED_SUMMARY;
  if (leaking.length === 0) return 'isolated';
  return `leaking: ${leaking.join(', ')}`;
}
