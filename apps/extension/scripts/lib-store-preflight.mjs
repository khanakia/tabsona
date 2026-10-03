// Chrome Web Store validation, as a function over a built extension directory.
//
// Why this is a library and not just a script: every rule here is one a human reviewer or
// the dashboard upload step enforces, and a failure costs a review round trip measured in
// days — so the rules need a test that watches each one FIRE, which a top-level script
// cannot provide. `collectProblems` therefore returns its findings instead of exiting, and
// `preflight-store.mjs` is the thin CLI that turns them into an exit code.
//
// It is given `dist/`, never `src/` or the source manifest: what gets uploaded is the
// build output, and the bug this is most likely to catch is a development-only value that
// the build injected, or that nobody removed.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Chrome Web Store field limits, in characters.
 *
 * These are the dashboard's own validation rules. `description` is the manifest field
 * shown under the name in the Store, NOT the long listing description.
 */
const LIMITS = { name: 75, short_name: 12, description: 132 };

/** Icon sizes a Store listing requires. 128 is the one shown on the listing page. */
const REQUIRED_ICON_SIZES = [16, 48, 128];

/**
 * Host-permission patterns that must never ship.
 *
 * A localhost or 127.0.0.1 grant in a PUBLISHED manifest is both a review finding and a
 * real permission the user never consented to. It is also exactly the kind of value a
 * test harness adds for convenience and nobody removes — this project shipped
 * `http://localhost:8787/*` in its manifest for weeks for that reason.
 */
const BANNED_HOST_PATTERNS = [/localhost/i, /127\.0\.0\.1/, /\bfile:/i, /\.local\b/i];

/**
 * Largest integer the Store accepts in a version part.
 *
 * A version is 1–4 dot-separated integers in 0–65535 with no leading zeros; anything else
 * is refused at upload with a message that does not name the offending part.
 */
const VERSION_PART_MAX = 65535;
const VERSION_MAX_PARTS = 4;

/** The uploaded package must stay under the dashboard's size ceiling. */
const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;

/**
 * Check a built extension directory against every Store hard requirement.
 *
 * Returns ALL problems rather than throwing on the first, so one run tells you everything
 * that has to change. An empty `problems` array is the only passing result.
 *
 * @param {string} dist absolute path to the built extension (the folder holding manifest.json)
 * @returns {{ problems: string[], notes: string[], manifest: Record<string, unknown> | null }}
 */
export function collectProblems(dist) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];

  /** Record a problem unless `ok`. Collected rather than thrown, so one run reports everything. */
  const check = (ok, message) => { if (!ok) failures.push(message); };

  if (!existsSync(dist)) {
    return { problems: [`no build output at ${dist} — run \`task build\` first`], notes, manifest: null };
  }

  const manifestPath = join(dist, 'manifest.json');
  if (!existsSync(manifestPath)) return { problems: ['manifest.json is missing from the build output'], notes, manifest: null };

  /** @type {Record<string, any>} */
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // --- manifest shape ---------------------------------------------------------

  check(m.manifest_version === 3, `manifest_version must be 3, found ${m.manifest_version}`);

  for (const [field, max] of Object.entries(LIMITS)) {
    const value = m[field];
    check(typeof value === 'string' && value.length > 0, `manifest.${field} is required`);
    if (typeof value === 'string') {
      check(value.length <= max, `manifest.${field} is ${value.length} chars, max ${max}`);
    }
  }

  const parts = String(m.version ?? '').split('.');
  check(parts.length >= 1 && parts.length <= VERSION_MAX_PARTS,
    `manifest.version must have 1–${VERSION_MAX_PARTS} parts, found "${m.version}"`);
  for (const part of parts) {
    check(/^(0|[1-9]\d*)$/.test(part) && Number(part) <= VERSION_PART_MAX,
      `manifest.version part "${part}" must be an integer 0–${VERSION_PART_MAX} with no leading zero`);
  }

  // `key` pins an extension id for local development and must never be published: it would
  // collide with the id the Store assigns.
  check(!('key' in m), 'manifest.key is a development-only field and must not be published');
  check(!('update_url' in m), 'manifest.update_url must be absent — the Store sets it');

  // --- permissions ------------------------------------------------------------

  const hosts = [
    ...(Array.isArray(m.host_permissions) ? m.host_permissions : []),
    ...(Array.isArray(m.optional_host_permissions) ? m.optional_host_permissions : []),
  ];
  for (const host of hosts) {
    for (const banned of BANNED_HOST_PATTERNS) {
      check(!banned.test(host), `host permission "${host}" is development-only and must not be published`);
    }
  }
  // Every origin this extension touches is granted at runtime through Chrome's own prompt.
  // A non-empty required list would make Chrome ask for everything at install time.
  check(!Array.isArray(m.host_permissions) || m.host_permissions.length === 0,
    `host_permissions must be empty (found ${JSON.stringify(m.host_permissions)}) — origins are optional and granted per site`);

  // --- every referenced file exists -------------------------------------------

  /** Collect the paths the manifest points at, so a renamed build output fails here, not in review. */
  function referencedPaths() {
    const out = [];
    const push = (p) => { if (typeof p === 'string') out.push(p); };
    push(m.background?.service_worker);
    push(m.action?.default_popup);
    push(m.options_ui?.page);
    push(m.options_page);
    for (const icons of [m.icons, m.action?.default_icon]) {
      for (const p of Object.values(icons ?? {})) push(p);
    }
    for (const cs of m.content_scripts ?? []) {
      for (const p of [...(cs.js ?? []), ...(cs.css ?? [])]) push(p);
    }
    for (const r of m.declarative_net_request?.rule_resources ?? []) push(r.path);
    for (const war of m.web_accessible_resources ?? []) {
      for (const p of war.resources ?? []) if (!p.includes('*')) push(p);
    }
    return [...new Set(out)];
  }

  for (const rel of referencedPaths()) {
    check(existsSync(join(dist, rel)), `manifest references "${rel}" but dist/${rel} does not exist`);
  }

  // --- icons are real PNGs of the declared size -------------------------------

  /**
   * Read a PNG's intrinsic size from its IHDR chunk.
   *
   * Why read the header rather than trust the filename: an icon declared as 128 that is
   * actually 48 is upscaled by the Store into a blurry listing image, and nothing warns.
   * IHDR is always the first chunk, so width/height sit at a fixed offset.
   */
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const IHDR_WIDTH_OFFSET = 16;

  function pngSize(file) {
    const buf = readFileSync(file);
    if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    return { width: buf.readUInt32BE(IHDR_WIDTH_OFFSET), height: buf.readUInt32BE(IHDR_WIDTH_OFFSET + 4) };
  }

  for (const size of REQUIRED_ICON_SIZES) {
    const rel = m.icons?.[String(size)];
    check(typeof rel === 'string', `manifest.icons is missing the ${size}px entry`);
    if (typeof rel !== 'string' || !existsSync(join(dist, rel))) continue;
    const dims = pngSize(join(dist, rel));
    check(dims !== null, `${rel} is not a valid PNG`);
    if (dims) {
      check(dims.width === size && dims.height === size,
        `${rel} is ${dims.width}x${dims.height}, declared as ${size}x${size}`);
    }
  }

  // --- no remotely hosted code ------------------------------------------------

  /**
   * Walk the build output looking for remote code, which Manifest V3 forbids outright and
   * reviewers reject for.
   *
   * Scanning the BUILT html/js (not the source) is the point: a CDN `<script>` added for a
   * quick experiment, or a bundler leaving a dynamic remote import, only shows up here.
   */
  const REMOTE_CODE_PATTERNS = [
    [/<script[^>]+src\s*=\s*["']https?:\/\//i, 'a remote <script src>'],
    [/<link[^>]+href\s*=\s*["']https?:\/\/[^"']+\.css/i, 'a remote stylesheet'],
    [/\bimport\s*\(\s*["']https?:\/\//i, 'a dynamic import() of a remote URL'],
    [/\bimportScripts\s*\(\s*["']https?:\/\//i, 'importScripts() of a remote URL'],
  ];
  const SCANNED_EXTENSIONS = ['.html', '.js', '.css'];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
      const text = readFileSync(full, 'utf8');
      for (const [pattern, what] of REMOTE_CODE_PATTERNS) {
        check(!pattern.test(text), `${relative(dist, full)} contains ${what} — remote code is banned in Manifest V3`);
      }
    }
  }
  walk(dist);

  // --- package size -----------------------------------------------------------

  let bytes = 0;
  (function size(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) size(full);
      else bytes += statSync(full).size;
    }
  })(dist);
  check(bytes <= MAX_PACKAGE_BYTES,
    `dist/ is ${(bytes / 1024 / 1024).toFixed(1)}MB unpacked, over the ${MAX_PACKAGE_BYTES / 1024 / 1024}MB ceiling`);
  notes.push(`unpacked ${(bytes / 1024).toFixed(0)}KB · ${hosts.length} host pattern(s) · ${(m.permissions ?? []).length} permissions`);

  return { problems: failures, notes, manifest: m };
}
