import { describe, expect, it } from 'vitest';
import {
  isOwnKey, namespacePrefix, qualify, sessionFromHash,
  stripSessionMarker, unqualify, withSessionMarker,
} from '../namespace';

describe('namespacePrefix', () => {
  it('is a pure function of the session id', () => {
    // THE load-bearing property of this project: because the namespace depends only
    // on the session id, ANY tab bound to that session resolves to the same storage
    // -- which is what makes save and restore possible at all.
    expect(namespacePrefix('s_abc')).toBe(namespacePrefix('s_abc'));
    expect(namespacePrefix('s_abc')).not.toBe(namespacePrefix('s_def'));
  });
});

describe('qualify / unqualify', () => {
  it('round-trips an app key', () => {
    expect(unqualify(qualify('authmgr.access', 's_1'), 's_1')).toBe('authmgr.access');
  });

  it('refuses a key belonging to another session', () => {
    expect(unqualify(qualify('k', 's_1'), 's_2')).toBeNull();
  });

  it('round-trips keys containing the separator', () => {
    expect(unqualify(qualify('a::b', 's_1'), 's_1')).toBe('a::b');
  });

  it('identifies its own keys', () => {
    expect(isOwnKey(qualify('k', 's_1'), 's_1')).toBe(true);
    expect(isOwnKey('k', 's_1')).toBe(false);
  });
});

describe('withSessionMarker', () => {
  it('adds the marker to a url with no hash', () => {
    expect(withSessionMarker('https://a.test/x?y=1', 's_1'))
      .toBe('https://a.test/x?y=1#__mstabs=s_1');
  });

  it('preserves an existing hash', () => {
    expect(withSessionMarker('https://a.test/#/route', 's_1'))
      .toBe('https://a.test/#/route&__mstabs=s_1');
  });

  it('round-trips through sessionFromHash', () => {
    const url = new URL(withSessionMarker('https://a.test/', 's_xyz'));
    expect(sessionFromHash(url.hash)).toBe('s_xyz');
  });
});

describe('sessionFromHash', () => {
  it('returns null when the marker is absent', () => {
    expect(sessionFromHash('#/some/route')).toBeNull();
    expect(sessionFromHash('')).toBeNull();
  });

  it('finds the marker after another fragment', () => {
    expect(sessionFromHash('#/route&__mstabs=s_1')).toBe('s_1');
  });

  it('decodes an encoded id', () => {
    expect(sessionFromHash('#__mstabs=s%5F1')).toBe('s_1');
  });
});

describe('stripSessionMarker', () => {
  it('removes a lone marker entirely', () => {
    expect(stripSessionMarker('#__mstabs=s_1')).toBe('');
  });

  it('leaves the app fragment intact', () => {
    // An app router must never see a fragment it does not understand.
    expect(stripSessionMarker('#/route&__mstabs=s_1')).toBe('#/route');
  });

  it('is a no-op when there is no marker', () => {
    expect(stripSessionMarker('#/route')).toBe('#/route');
  });
});
