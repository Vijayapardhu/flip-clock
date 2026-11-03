'use strict';

/**
 * Generates the Windows app icon from the same flip-card artwork as the PWA
 * icons.
 *
 *   node scripts/make-app-icon.js
 *
 * Writes:
 *   build/icon.png   512x512  (window/taskbar icon in development)
 *   build/icon.ico   16-256   (packaged .exe icon, PNG-compressed entries)
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build');
const SS = 4;

// ---------------------------------------------------------------------------
// PNG encoder
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
// Artwork (same card as website/assets/icons)
// ---------------------------------------------------------------------------

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const lerp = (a, b, t) => a + (b - a) * t;

function insideRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const dx = Math.max(x + r - px, px - (x + w - r), 0);
  const dy = Math.max(y + r - py, py - (y + h - r), 0);
  return dx * dx + dy * dy <= r * r;
}

function sampleCard(u, v) {
  const x = 0.15;
  const y = 0.21;
  const w = 0.7;
  const h = 0.58;
  if (!insideRoundedRect(u, v, x, y, w, h, 0.13)) return null;

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

/** Rounded near-black tile with the flip card, transparent outside. */
function sampleStandard(u, v) {
  if (!insideRoundedRect(u, v, 0.02, 0.02, 0.96, 0.96, 0.24)) return [0, 0, 0, 0];

  const t = clamp(v, 0, 1);
  let r = lerp(18, 7, t);
  let g = lerp(18, 7, t);
  let b = lerp(22, 9, t);

  const card = sampleCard(u, v);
  if (card) [r, g, b] = card;
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
// ICO writer (PNG-compressed entries, supported since Windows Vista)
// ---------------------------------------------------------------------------

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;

  entries.forEach(({ size, png }, index) => {
    const o = index * 16;
    directory[o] = size >= 256 ? 0 : size; // 0 means 256
    directory[o + 1] = size >= 256 ? 0 : size;
    directory[o + 2] = 0; // palette
    directory[o + 3] = 0; // reserved
    directory.writeUInt16LE(1, o + 4); // planes
    directory.writeUInt16LE(32, o + 6); // bits per pixel
    directory.writeUInt32LE(png.length, o + 8);
    directory.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

// ---------------------------------------------------------------------------

fs.mkdirSync(OUT, { recursive: true });

const png512 = encodePng(512, 512, renderIcon(512, sampleStandard));
fs.writeFileSync(path.join(OUT, 'icon.png'), png512);
process.stdout.write('wrote build/icon.png (512x512)\n');

const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const entries = sizes.map((size) => ({
  size,
  png: encodePng(size, size, renderIcon(size, sampleStandard)),
}));
fs.writeFileSync(path.join(OUT, 'icon.ico'), buildIco(entries));
process.stdout.write(`wrote build/icon.ico (${sizes.join(', ')})\n`);
