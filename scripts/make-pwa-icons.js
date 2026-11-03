'use strict';

/**
 * Generates the PWA icon set into website/assets/icons/.
 *
 *   node scripts/make-pwa-icons.js
 *
 * Same hand-rolled PNG encoder as make-icon.js, with two variants:
 *   - standard: matte rounded tile on transparent canvas (purpose "any")
 *   - maskable: full-bleed black background, artwork inside the 80% safe zone
 *
 * Also writes apple-touch-icon (180), favicon-16/32 and icon.svg (crisp master).
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'website', 'assets', 'icons');
const SS = 4;

// ---------------------------------------------------------------------------
// PNG encoder (copied from scripts/make-icon.js)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const lerp = (a, b, t) => a + (b - a) * t;

function insideRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const dx = Math.max(x + r - px, px - (x + w - r), 0);
  const dy = Math.max(y + r - py, py - (y + h - r), 0);
  return dx * dx + dy * dy <= r * r;
}

/** Flip-clock card, shared by both variants. */
function sampleCard(u, v) {
  const x = 0.15;
  const y = 0.21;
  const w = 0.7;
  const h = 0.58;
  const inCard = insideRoundedRect(u, v, x, y, w, h, 0.13);
  if (!inCard) return null;

  let r;
  let g;
  let b;
  if (v < 0.5) {
    const t = clamp((v - y) / (0.5 - y), 0, 1);
    r = lerp(246, 214, t);
    g = lerp(246, 214, t);
    b = lerp(249, 220, t);
  } else {
    const t = clamp((v - 0.5) / (y + h - 0.5), 0, 1);
    r = lerp(182, 150, t);
    g = lerp(182, 152, t);
    b = lerp(190, 160, t);
  }
  if (Math.abs(v - 0.5) < 0.017) {
    r = 8;
    g = 8;
    b = 10;
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/** Standard icon: rounded near-black tile on transparent canvas. */
function sampleStandard(u, v) {
  const inTile = insideRoundedRect(u, v, 0.02, 0.02, 0.96, 0.96, 0.24);
  if (!inTile) return [0, 0, 0, 0];

  const t = clamp(v, 0, 1);
  let r = lerp(18, 7, t);
  let g = lerp(18, 7, t);
  let b = lerp(22, 9, t);

  const card = sampleCard(u, v);
  if (card) [r, g, b] = card;
  return [Math.round(r), Math.round(g), Math.round(b), 255];
}

/**
 * Maskable icon: full-bleed black canvas, artwork scaled to the central 80%
 * safe zone so launchers can crop to any shape.
 */
function sampleMaskable(u, v) {
  // Outer background: plain near-black, matches --background.
  let r = 7;
  let g = 7;
  let b = 9;

  // Map central 62% of the canvas onto the standard art space.
  const span = 0.62;
  const offset = (1 - span) / 2;
  const su = (u - offset) / span;
  const sv = (v - offset) / span;
  if (su >= 0 && su <= 1 && sv >= 0 && sv <= 1) {
    const tile = insideRoundedRect(su, sv, 0.02, 0.02, 0.96, 0.96, 0.24);
    if (tile) {
      const t = clamp(sv, 0, 1);
      r = lerp(18, 7, t);
      g = lerp(18, 7, t);
      b = lerp(22, 9, t);
      const card = sampleCard(su, sv);
      if (card) [r, g, b] = card;
    }
  }
  return [Math.round(r), Math.round(g), Math.round(b), 255];
}

function renderIcon(size, sample) {
  const big = size * SS;
  const buffer = Buffer.alloc(big * big * 4);

  for (let y = 0; y < big; y += 1) {
    for (let x = 0; x < big; x += 1) {
      const [r, g, b, a] = sample((x + 0.5) / big, (y + 0.5) / big);
      const i = (y * big + x) * 4;
      buffer[i] = r;
      buffer[i + 1] = g;
      buffer[i + 2] = b;
      buffer[i + 3] = a;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const divisor = SS * SS;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * big + (x * SS + sx)) * 4;
          r += buffer[i];
          g += buffer[i + 1];
          b += buffer[i + 2];
          a += buffer[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / divisor);
      out[o + 1] = Math.round(g / divisor);
      out[o + 2] = Math.round(b / divisor);
      out[o + 3] = Math.round(a / divisor);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

const jobs = [
  ['icon-192.png', 192, sampleStandard],
  ['icon-512.png', 512, sampleStandard],
  ['icon-maskable-192.png', 192, sampleMaskable],
  ['icon-maskable-512.png', 512, sampleMaskable],
  ['apple-touch-icon.png', 180, sampleMaskable], // iOS crops corners itself
  ['favicon-32.png', 32, sampleStandard],
  ['favicon-16.png', 16, sampleStandard],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size, sample] of jobs) {
  fs.writeFileSync(path.join(OUT, name), encodePng(size, size, renderIcon(size, sample)));
  process.stdout.write(`wrote website/assets/icons/${name}\n`);
}
