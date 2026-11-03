'use strict';

/**
 * Generates build/icon.ico (multi-resolution) and build/icon.png from scratch.
 * No image dependencies: PNG is encoded by hand and wrapped in an ICO.
 *
 *   npm run icon
 *
 * Drop a hand-made build/icon.ico over the output if you prefer your own art.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const OUT_ICO = path.join(ROOT, 'build', 'icon.ico');
const OUT_PNG = path.join(ROOT, 'build', 'icon.png');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SS = 4; // supersampling factor for antialiasing

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

/** Sample one point in unit space. Returns [r, g, b, a] 0-255. */
function sample(u, v) {
  const inTile = insideRoundedRect(u, v, 0.02, 0.02, 0.96, 0.96, 0.24);
  if (!inTile) return [0, 0, 0, 0];

  // Matte black tile with a faint top-down gradient and a hairline rim.
  const tileT = clamp(v, 0, 1);
  let r = lerp(18, 7, tileT);
  let g = lerp(18, 7, tileT);
  let b = lerp(22, 9, tileT);

  const inCard = insideRoundedRect(u, v, 0.15, 0.21, 0.7, 0.58, 0.13);
  if (inCard) {
    if (v < 0.5) {
      const t = clamp((v - 0.21) / (0.5 - 0.21), 0, 1);
      r = lerp(246, 214, t);
      g = lerp(246, 214, t);
      b = lerp(249, 220, t);
    } else {
      const t = clamp((v - 0.5) / (0.79 - 0.5), 0, 1);
      r = lerp(182, 150, t);
      g = lerp(182, 152, t);
      b = lerp(190, 160, t);
    }
    if (Math.abs(v - 0.5) < 0.017) {
      r = 8;
      g = 8;
      b = 10;
    }
  }

  return [Math.round(r), Math.round(g), Math.round(b), 255];
}

function renderIcon(size) {
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
// ICO container (PNG-in-ICO, supported for sizes >= 256 and by Windows)
// ---------------------------------------------------------------------------

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach((image, index) => {
    const entry = index * 16;
    directory[entry] = image.size >= 256 ? 0 : image.size; // width
    directory[entry + 1] = image.size >= 256 ? 0 : image.size; // height
    directory[entry + 2] = 0; // palette
    directory[entry + 3] = 0; // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(image.png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.png.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.png)]);
}

// ---------------------------------------------------------------------------

const images = SIZES.map((size) => ({
  size,
  png: encodePng(size, size, renderIcon(size)),
}));

fs.mkdirSync(path.dirname(OUT_ICO), { recursive: true });
fs.writeFileSync(OUT_ICO, buildIco(images));
fs.writeFileSync(OUT_PNG, encodePng(512, 512, renderIcon(512)));

process.stdout.write(`wrote ${path.relative(ROOT, OUT_ICO)}  (${SIZES.join(', ')})\n`);
process.stdout.write(`wrote ${path.relative(ROOT, OUT_PNG)}  (512x512)\n`);
