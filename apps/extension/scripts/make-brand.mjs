// Generates every raster brand asset from ONE description of the mark.
//
// No image dependency: a minimal PNG encoder over node's own `zlib` is less fragile than
// a toolchain someone has to install before they can build. Re-run with `task brand`.
//
// THE MARK: two overlapping cards on a dark plate. One identity sits in front of
// another — the whole product in one glyph. Overlap rather than a row, because at 16px a
// row of three bars reads as a hamburger menu, and overlap still reads as "more than one"
// when it is 16 pixels wide.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ICON_DIR = resolve(ROOT, 'icons');
const STORE_DIR = resolve(ROOT, '../../brand/store');
/** The project site (GitHub Pages, served from `docs/`) shows the same mark. Written here
 *  rather than hot-linked, so the pages render before the repo is public and stay correct
 *  if the raster ever changes — one generator, no hand-copied duplicate to drift. */
const SITE_DIR = resolve(ROOT, '../../docs');

/** Icon sizes Chrome asks for. 128 is the one the Web Store shows. */
const ICON_SIZES = [16, 32, 48, 128];

/**
 * Palette.
 *
 * `BACK`/`FRONT` are the first two persona accents from `core/constants.ts`, so the icon
 * is the same two colours a user sees on their first two personas. `PLATE` is zinc-900:
 * dark enough to hold its shape on a light toolbar, light enough not to vanish on a dark
 * one — a pure-black plate disappears against Chrome's dark theme.
 */
const PLATE = [24, 24, 27];
const BACK = [16, 185, 129];
const FRONT = [59, 130, 246];

const PLATE_RADIUS_RATIO = 0.22;
/** Samples per axis for edge anti-aliasing. 4 is 16 samples/pixel — plenty at 128px,
 *  and the whole set renders in well under a second. */
const SAMPLES = 4;

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
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

/** Encode an RGBA buffer as a PNG. One filter byte per scanline, as the format requires. */
function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    raw[row] = 0; // filter: none
    pixels.subarray(y * width * 4, (y + 1) * width * 4).copy(raw, row + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- drawing ----------------------------------------------------------------

/** Pixel coverage by a rounded rectangle, supersampled so edges are not jagged. */
function coverage(px, py, x0, y0, x1, y1, r) {
  let hits = 0;
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      const x = px + (sx + 0.5) / SAMPLES;
      const y = py + (sy + 0.5) / SAMPLES;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      // Clamp to the nearest corner centre; inside the straight edges this is the point
      // itself, so the distance test only bites in the corners.
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) hits++;
    }
  }
  return hits / (SAMPLES * SAMPLES);
}

function blend(buf, offset, rgb, alpha) {
  if (alpha <= 0) return;
  for (let i = 0; i < 3; i++) {
    buf[offset + i] = Math.round(buf[offset + i] * (1 - alpha) + rgb[i] * alpha);
  }
  buf[offset + 3] = Math.round(buf[offset + 3] * (1 - alpha) + 255 * alpha);
}

function fillRounded(buf, width, rect, rgb, alpha = 1) {
  const [x0, y0, x1, y1, r] = rect;
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(width * 4, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.ceil(x1); x++) {
      if (x < 0 || y < 0 || x >= width) continue;
      const a = coverage(x, y, x0, y0, x1, y1, r) * alpha;
      if (a > 0) blend(buf, (y * width + x) * 4, rgb, a);
    }
  }
}

/**
 * Draw the mark into an existing buffer, scaled to `size` and placed at `ox,oy`.
 *
 * Shared by the icons and the promo art so the glyph can never drift between them —
 * a logo that differs subtly across assets is the classic sign of hand-made exports.
 */
function drawMark(buf, bufWidth, ox, oy, size, { plate = true } = {}) {
  const pad = size * 0.06;
  if (plate) {
    fillRounded(buf, bufWidth,
      [ox + pad, oy + pad, ox + size - pad, oy + size - pad, size * PLATE_RADIUS_RATIO], PLATE);
  }

  const inner = size - pad * 2;
  const cardW = inner * 0.60;
  const cardH = inner * 0.60;
  const radius = inner * 0.13;

  // Back card: up and left, the identity behind the one in front.
  const bx = ox + pad + inner * 0.12;
  const by = oy + pad + inner * 0.12;
  fillRounded(buf, bufWidth, [bx, by, bx + cardW, by + cardH, radius], BACK);

  // A sliver of plate between the cards, so they stay two shapes at 16px instead of
  // merging into one blob.
  const gap = Math.max(1, inner * 0.035);
  const fx = ox + pad + inner * 0.28;
  const fy = oy + pad + inner * 0.28;
  fillRounded(buf, bufWidth, [fx - gap, fy - gap, fx + cardW + gap, fy + cardH + gap, radius + gap], PLATE);
  fillRounded(buf, bufWidth, [fx, fy, fx + cardW, fy + cardH, radius], FRONT);
}

// --- outputs ----------------------------------------------------------------

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  drawMark(buf, size, 0, 0, size);
  return encodePng(size, size, buf);
}

/**
 * Promo artwork: the mark alone, generously spaced, on the plate colour.
 *
 * NO WORDMARK ON PURPOSE. Drawing type without a font renderer means hand-plotting a
 * bitmap alphabet, and a 5×7 bitmap wordmark reads as a 1980s pixel font — wrong for a
 * dense modern developer tool, and worse than no wordmark at all. The Web Store already
 * renders the name and summary as real text beside the tile, so the tile's job is the
 * glyph. A typeset lockup needs a real typeface and belongs in a design tool.
 *
 * A row of persona dots sits under the mark: the same accents a user sees on their first
 * personas, and the only hint the tile needs that this is about *several* identities.
 */
function renderPromo(width, height) {
  const buf = Buffer.alloc(width * height * 4);
  fillRounded(buf, width, [0, 0, width, height, 0], PLATE);

  // Sized off the SHORTER edge so a wide marquee and a squarer tile both breathe.
  const markSize = Math.round(Math.min(width, height) * 0.52);
  const markX = Math.round((width - markSize) / 2);
  const markY = Math.round((height - markSize) / 2 - height * 0.05);
  drawMark(buf, width, markX, markY, markSize, { plate: false });

  const dot = Math.max(2, Math.round(markSize * 0.055));
  const gap = dot * 2.4;
  const dots = [BACK, FRONT, [245, 158, 11]];
  const rowWidth = dots.length * dot + (dots.length - 1) * (gap - dot);
  let x = Math.round((width - rowWidth) / 2);
  const y = markY + markSize + Math.round(height * 0.07);
  for (const rgb of dots) {
    fillRounded(buf, width, [x, y, x + dot, y + dot, dot / 2], rgb);
    x += gap;
  }

  return encodePng(width, height, buf);
}

mkdirSync(ICON_DIR, { recursive: true });
mkdirSync(STORE_DIR, { recursive: true });
mkdirSync(SITE_DIR, { recursive: true });

for (const size of ICON_SIZES) {
  writeFileSync(resolve(ICON_DIR, `icon${size}.png`), renderIcon(size));
  console.log(`icon${size}.png`);
}

/** Chrome Web Store artwork sizes, plus an OG card for links. */
const PROMOS = [
  ['small-promo-440x280.png', 440, 280],
  ['marquee-1400x560.png', 1400, 560],
  ['og-1280x640.png', 1280, 640],
];
for (const [file, w, h] of PROMOS) {
  writeFileSync(resolve(STORE_DIR, file), renderPromo(w, h));
  console.log(`store/${file}`);
}

const SITE_ICON_SIZE = 128;
writeFileSync(resolve(SITE_DIR, 'icon128.png'), renderIcon(SITE_ICON_SIZE));
console.log('docs/icon128.png');
