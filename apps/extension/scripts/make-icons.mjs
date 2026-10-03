// Generates the extension's PNG icon set from ONE description, with no image
// dependency: a minimal PNG encoder (zlib is in node core) is less fragile than a
// toolchain that has to be installed before anyone can build.
//
// The mark: three stacked rounded bars in three accent colours — one tab per session,
// which is the whole product in one glyph.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const OUT_DIR = resolve(import.meta.dirname, '../icons');
const SIZES = [16, 32, 48, 128];

/** Accent colours, matching the first three session colours in core/constants.ts. */
const BARS = [
  [59, 130, 246],  // blue
  [16, 185, 129],  // emerald
  [245, 158, 11],  // amber
];
const BACKGROUND = [24, 24, 27];     // zinc-900: reads on both light and dark toolbars
const CORNER_RADIUS_RATIO = 0.22;

/** Signed 32-bit CRC used by every PNG chunk. */
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

/** Encode RGBA pixel rows as a PNG. */
function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  // 10..12 stay zero: deflate, no filter, no interlace.

  // One filter byte (0 = none) per scanline, as the format requires.
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    pixels.subarray(y * size * 4, (y + 1) * size * 4).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Coverage of a pixel by a rounded rectangle, sampled so edges are not jagged. */
function roundedRectCoverage(px, py, x0, y0, x1, y1, r, samples = 4) {
  let hits = 0;
  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      const x = px + (sx + 0.5) / samples;
      const y = py + (sy + 0.5) / samples;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      // Distance from the nearest corner centre decides the rounded part.
      const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
      const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) hits++;
    }
  }
  return hits / (samples * samples);
}

function blend(dst, offset, rgb, alpha) {
  for (let i = 0; i < 3; i++) {
    dst[offset + i] = Math.round(dst[offset + i] * (1 - alpha) + rgb[i] * alpha);
  }
  dst[offset + 3] = Math.round(dst[offset + 3] * (1 - alpha) + 255 * alpha);
}

function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4); // transparent
  const pad = size * 0.06;
  const bgRadius = size * CORNER_RADIUS_RATIO;

  // Rounded square plate.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = roundedRectCoverage(x, y, pad, pad, size - pad, size - pad, bgRadius);
      if (a > 0) blend(px, (y * size + x) * 4, BACKGROUND, a);
    }
  }

  // Three bars = three sessions.
  const inner = size - pad * 2;
  const barH = inner * 0.155;
  const gap = inner * 0.095;
  const totalH = barH * 3 + gap * 2;
  const top = pad + (inner - totalH) / 2;
  const barX0 = pad + inner * 0.18;
  const barRadius = barH / 2;

  for (let b = 0; b < BARS.length; b++) {
    const y0 = top + b * (barH + gap);
    // Each bar a little shorter than the last: reads as a list, not a flag.
    const x1 = pad + inner * (0.86 - b * 0.11);
    for (let y = Math.floor(y0); y <= Math.ceil(y0 + barH); y++) {
      for (let x = Math.floor(barX0); x <= Math.ceil(x1); x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const a = roundedRectCoverage(x, y, barX0, y0, x1, y0 + barH, barRadius);
        if (a > 0) blend(px, (y * size + x) * 4, BARS[b], a);
      }
    }
  }

  return encodePng(size, px);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon${size}.png`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderIcon(size));
  console.log(`wrote ${file}`);
}
