// Tests for the Chrome Web Store client's pure helpers.
//
// The `.env` writer runs against the file holding live Store credentials, so it
// is tested hardest: a writer that reflowed the file could drop the client secret
// while saving the refresh token, and that would only surface at the next release.
//
// Run with: task test:scripts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVALID_GRANT, missingKeys, parseEnv, settleUpload, tokenRefreshError, upsertEnvLine,
} from './lib-cws.mjs';

test('parseEnv reads keys, strips one layer of quotes, skips comments and blanks', () => {
  const env = parseEnv('# comment\n\nA=1\nB="two"\nC=\'three\'\n  D = spaced  \nlower=ignored\n');
  assert.deepEqual(env, { A: '1', B: 'two', C: 'three', D: 'spaced' });
});

test('parseEnv keeps credential punctuation verbatim', () => {
  const value = '1//0abc-DEF_ghi.jkl/mno';
  assert.equal(parseEnv(`T=${value}`).T, value);
});

test('parseEnv does not strip mismatched quotes', () => {
  assert.equal(parseEnv('A="x\'').A, '"x\'');
});

test('upsertEnvLine replaces in place and leaves every other line untouched', () => {
  const before = '# header\nCWS_CLIENT_ID=id\nCWS_REFRESH_TOKEN=old\nCWS_CLIENT_SECRET=sec\n';
  const after = upsertEnvLine(before, 'CWS_REFRESH_TOKEN', 'new');
  assert.equal(after, '# header\nCWS_CLIENT_ID=id\nCWS_REFRESH_TOKEN=new\nCWS_CLIENT_SECRET=sec\n');
});

test('upsertEnvLine appends with a newline, whether or not the file ended in one', () => {
  assert.equal(upsertEnvLine('A=1\n', 'B', '2'), 'A=1\nB=2\n');
  assert.equal(upsertEnvLine('A=1', 'B', '2'), 'A=1\nB=2\n');
  assert.equal(upsertEnvLine('', 'B', '2'), 'B=2\n');
});

test('upsertEnvLine does not treat a key as a prefix of another', () => {
  const after = upsertEnvLine('CWS_EXTENSION_ID_OLD=x\n', 'CWS_EXTENSION_ID', 'y');
  assert.equal(after, 'CWS_EXTENSION_ID_OLD=x\nCWS_EXTENSION_ID=y\n');
});

test('upsertEnvLine writes `$` sequences literally (no regex replacement patterns)', () => {
  assert.equal(upsertEnvLine('A=1\n', 'A', 'x$&y$1'), 'A=x$&y$1\n');
});

test('upsertEnvLine round-trips through parseEnv', () => {
  const text = upsertEnvLine(upsertEnvLine('', 'A', '1'), 'B', 'two/2');
  assert.deepEqual(parseEnv(upsertEnvLine(text, 'A', 'one')), { A: 'one', B: 'two/2' });
});

test('missingKeys names absent and empty keys, in the order asked', () => {
  assert.deepEqual(missingKeys({ A: 'x', B: '' }, ['C', 'A', 'B']), ['C', 'B']);
  assert.deepEqual(missingKeys({ A: 'x' }, ['A']), []);
});

test('tokenRefreshError points an expired token at cws:auth, and only then', () => {
  assert.match(tokenRefreshError({ error: INVALID_GRANT }, 400), /invalid_grant.*task cws:auth/);
  assert.equal(tokenRefreshError({ error: 'invalid_client' }, 401), 'token refresh failed: invalid_client');
  assert.equal(tokenRefreshError({}, 500), 'token refresh failed: 500');
});

/** A fake clock + item sequence, so the poll loop runs instantly and is countable. */
function fakePoller(states) {
  const calls = { sleeps: 0, gets: 0 };
  const deps = {
    sleep: async () => { calls.sleeps++; },
    getItem: async () => ({ uploadState: states[Math.min(calls.gets++, states.length - 1)] }),
    intervalMs: 1,
    maxPolls: 5,
  };
  return { calls, deps };
}

test('settleUpload returns immediately when the first state is already SUCCESS', async () => {
  const { calls, deps } = fakePoller([]);
  const item = await settleUpload({ uploadState: 'SUCCESS' }, deps);
  assert.equal(item.uploadState, 'SUCCESS');
  assert.equal(calls.gets, 0);
});

test('settleUpload polls through IN_PROGRESS until SUCCESS', async () => {
  const { calls, deps } = fakePoller(['IN_PROGRESS', 'SUCCESS']);
  const item = await settleUpload({ uploadState: 'IN_PROGRESS' }, deps);
  assert.equal(item.uploadState, 'SUCCESS');
  assert.equal(calls.gets, 2);
});

test('settleUpload rejects a final FAILURE with the Store error attached', async () => {
  const { deps } = fakePoller([]);
  await assert.rejects(
    settleUpload({ uploadState: 'FAILURE', itemError: [{ error_code: 'PKG_INVALID' }] }, deps),
    /upload FAILURE: .*PKG_INVALID/,
  );
});

test('settleUpload gives up after maxPolls instead of hanging a release', async () => {
  const { calls, deps } = fakePoller(['IN_PROGRESS']);
  await assert.rejects(settleUpload({ uploadState: 'IN_PROGRESS' }, deps), /upload IN_PROGRESS/);
  assert.equal(calls.gets, deps.maxPolls);
});
