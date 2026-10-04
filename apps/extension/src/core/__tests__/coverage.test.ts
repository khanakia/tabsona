import { describe, expect, it } from 'vitest';
import {
  computeCoverage, coverageSummary, EMPTY_OBSERVATIONS, shimFactsFrom, worstStatus,
} from '../coverage';
import type { StateLayer } from '@/domain/types';

const statusOf = (cov: ReturnType<typeof computeCoverage>, layer: StateLayer) =>
  cov.find((c) => c.layer === layer)?.status;

describe('computeCoverage', () => {
  it('never claims localStorage coverage without an installed shim', () => {
    // Pessimism is the point: an optimistic default is exactly how a tool ends up
    // telling the user it isolated something it did not.
    const cov = computeCoverage('cookie+storage', EMPTY_OBSERVATIONS);
    expect(statusOf(cov, 'localStorage')).toBe('leaking');
  });

  it('claims localStorage coverage once the shim reports itself installed', () => {
    const cov = computeCoverage('cookie+storage', { ...EMPTY_OBSERVATIONS, shimInstalled: true });
    expect(statusOf(cov, 'localStorage')).toBe('covered');
  });

  it('reports cookies as unknown until one has actually been seen', () => {
    expect(statusOf(computeCoverage('cookie+storage', EMPTY_OBSERVATIONS), 'cookies')).toBe('unknown');
    expect(statusOf(computeCoverage('cookie+storage', { ...EMPTY_OBSERVATIONS, hasCookies: true }), 'cookies')).toBe('covered');
  });

  it('always reports sessionStorage as covered, because the browser does it for free', () => {
    expect(statusOf(computeCoverage('cookie+storage', EMPTY_OBSERVATIONS), 'sessionStorage')).toBe('covered');
  });

  it('reports a service worker as LEAKING, because its fetches carry no tab id', () => {
    // Unfixable inside the extension model. It must be surfaced, never hidden.
    const cov = computeCoverage('cookie+storage', { ...EMPTY_OBSERVATIONS, hasServiceWorker: true });
    expect(statusOf(cov, 'serviceWorker')).toBe('leaking');
  });

  it('reports IndexedDB as leaking only once the origin is seen using it', () => {
    expect(statusOf(computeCoverage('cookie+storage', EMPTY_OBSERVATIONS), 'indexedDB')).toBe('unknown');
    expect(statusOf(computeCoverage('cookie+storage', { ...EMPTY_OBSERVATIONS, usesIndexedDb: true }), 'indexedDB')).toBe('leaking');
  });

  it('claims IndexedDB covered only when the shim namespaced it and no worker was seen', () => {
    // Every row of the coverage table in docsi/SPEC_INDEXEDDB.md.
    const shim = { ...EMPTY_OBSERVATIONS, shimInstalled: true };
    expect(statusOf(computeCoverage('cookie+storage', { ...shim, idbNamespaced: true }), 'indexedDB')).toBe('covered');
    expect(statusOf(computeCoverage('cookie+storage', { ...shim, idbNamespaced: true, usesWorker: true }), 'indexedDB')).toBe('leaking');
    expect(statusOf(computeCoverage('cookie+storage', { ...shim, idbNamespaced: false }), 'indexedDB')).toBe('leaking');
    // A namespacing report without an installed shim is not evidence.
    expect(statusOf(computeCoverage('cookie+storage', { ...EMPTY_OBSERVATIONS, idbNamespaced: true }), 'indexedDB')).toBe('unknown');
  });

  it('reports a cross-origin frame as leaking', () => {
    const cov = computeCoverage('cookie+storage', { ...EMPTY_OBSERVATIONS, hasCrossOriginFrame: true });
    expect(statusOf(cov, 'crossOriginFrames')).toBe('leaking');
  });

  it('makes no storage claim at all for a token-injection session', () => {
    const cov = computeCoverage('token-injection', { ...EMPTY_OBSERVATIONS, shimInstalled: true });
    expect(statusOf(cov, 'localStorage')).toBe('not-applicable');
  });

  it('returns every layer exactly once, in a stable order', () => {
    const a = computeCoverage('cookie+storage', EMPTY_OBSERVATIONS).map((c) => c.layer);
    const b = computeCoverage('token-injection', EMPTY_OBSERVATIONS).map((c) => c.layer);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it('gives every layer a non-empty human detail for the tooltip', () => {
    for (const c of computeCoverage('cookie+storage', EMPTY_OBSERVATIONS)) {
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('worstStatus', () => {
  it('lets any leak dominate', () => {
    expect(worstStatus([
      { layer: 'cookies', status: 'covered', detail: '' },
      { layer: 'localStorage', status: 'leaking', detail: '' },
    ])).toBe('leaking');
  });

  it('prefers unknown over covered when nothing leaks', () => {
    expect(worstStatus([
      { layer: 'cookies', status: 'unknown', detail: '' },
      { layer: 'localStorage', status: 'covered', detail: '' },
    ])).toBe('unknown');
  });

  it('is covered only when nothing is worse', () => {
    expect(worstStatus([
      { layer: 'cookies', status: 'covered', detail: '' },
      { layer: 'serviceWorker', status: 'not-applicable', detail: '' },
    ])).toBe('covered');
  });
});

describe('coverageSummary', () => {
  it('says isolated when nothing leaks', () => {
    expect(coverageSummary([{ layer: 'cookies', status: 'covered', detail: '' }])).toBe('isolated');
  });

  it('names every leaking layer', () => {
    expect(coverageSummary([
      { layer: 'localStorage', status: 'leaking', detail: '' },
      { layer: 'serviceWorker', status: 'leaking', detail: '' },
    ])).toBe('leaking: localStorage, serviceWorker');
  });
});

describe('shimFactsFrom', () => {
  it('reads each fact only when it is literally true', () => {
    expect(shimFactsFrom({ usesIndexedDb: true, idbNamespaced: 'yes', usesWorker: 1, hasServiceWorker: true }))
      .toEqual({ usesIndexedDb: true, idbNamespaced: false, usesWorker: false, hasServiceWorker: true });
  });

  it('treats anything malformed as nothing observed, never as a claim', () => {
    const none = { usesIndexedDb: false, idbNamespaced: false, usesWorker: false, hasServiceWorker: false };
    expect(shimFactsFrom(null)).toEqual(none);
    expect(shimFactsFrom('ready')).toEqual(none);
    expect(shimFactsFrom(undefined)).toEqual(none);
  });
});
