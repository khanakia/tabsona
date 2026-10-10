import { describe, expect, it } from 'vitest';
import { coversAllSites, hostAccessPatterns, listedGrants } from '../hostAccess';
import { ALL_SITES_PATTERN, ALL_URLS_PATTERN } from '../constants';

const app = 'http://localhost:8790/*';
const idp = 'http://127.0.0.1:8790/*';

describe('coversAllSites', () => {
  it('is true for the all-sites pattern and for <all_urls>, and only for those', () => {
    expect(coversAllSites([app, ALL_SITES_PATTERN])).toBe(true);
    expect(coversAllSites([ALL_URLS_PATTERN])).toBe(true);
    expect(coversAllSites([app, idp])).toBe(false);
    expect(coversAllSites([])).toBe(false);
    // A wildcard over ONE domain's subdomains is not every website.
    expect(coversAllSites(['*://*.example.com/*'])).toBe(false);
  });
});

describe('hostAccessPatterns — what the listener and the content scripts match', () => {
  it('collapses to the single all-sites pattern when every website is granted', () => {
    expect(hostAccessPatterns([idp, ALL_SITES_PATTERN, app])).toEqual([ALL_SITES_PATTERN]);
  });

  it('never hands Chrome <all_urls>, which names schemes the extension cannot touch', () => {
    expect(hostAccessPatterns([ALL_URLS_PATTERN])).toEqual([ALL_SITES_PATTERN]);
  });

  it('otherwise passes the per-site grants through, de-duplicated and sorted', () => {
    expect(hostAccessPatterns([idp, app, idp])).toEqual([idp, app].sort());
    expect(hostAccessPatterns([])).toEqual([]);
  });
});

describe('listedGrants — the Sites list', () => {
  it('puts the all-sites grant first and keeps the per-site grants that outlive it', () => {
    expect(listedGrants([idp, ALL_SITES_PATTERN, app])).toEqual([ALL_SITES_PATTERN, ...[idp, app].sort()]);
  });

  it('keeps <all_urls> as Chrome holds it, first, so its remove button removes that exact grant', () => {
    expect(listedGrants([app, ALL_URLS_PATTERN, app])).toEqual([ALL_URLS_PATTERN, app]);
  });

  it('is just the sites when nothing covers every website', () => {
    expect(listedGrants([idp, app])).toEqual([idp, app].sort());
  });
});
