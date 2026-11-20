// Pixel image helpers for the atlas: 8-bit PNG decode and RGBA encode, crop, resize, paste,
// coordinate grid, colour statistics and mean/std colour matching. Built-in modules only.
//
// An image is { width, height, data } where data is a Uint8ClampedArray of RGBA,
// 4 bytes per pixel, row-major, origin top-left.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Samples per pixel for each PNG colour type (all at bit depth 8).
const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function unsupported(reason) {
  return new Error(`unsupported PNG: ${reason}`);
}

function assertSize(width, height) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('invalid image size');
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Reverses the scanline filters. Input: filtered bytes with one filter byte per row.
function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw unsupported('truncated image data');
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= channels ? out[row + i - channels] : 0;
      const b = y > 0 ? out[prev + i] : 0;
      const c = i >= channels && y > 0 ? out[prev + i - channels] : 0;
      let predictor;
      switch (filter) {
        case 0: predictor = 0; break;
        case 1: predictor = a; break;
        case 2: predictor = b; break;
        case 3: predictor = (a + b) >> 1; break;
        case 4: predictor = paeth(a, b, c); break;
        default: throw unsupported(`filter type ${filter}`);
      }
      out[row + i] = (x + predictor) & 0xff;
    }
  }
  return out;
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Decodes a PNG: 8-bit, non-interlaced, colour types 0, 2, 3, 4, 6. Output is RGBA.
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }}
 */
export function decodePng(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw unsupported('bad signature');

  let pos = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  let sawEnd = false;
  const idat = [];
  while (pos < bytes.length && !sawEnd) {
    if (pos + 8 > bytes.length) throw unsupported('truncated');
    const length = bytes.readUInt32BE(pos);
    const type = bytes.toString('ascii', pos + 4, pos + 8);
    const start = pos + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw unsupported('truncated');
    const data = bytes.subarray(start, end);
    pos = end + 4;
    if (type === 'IHDR') {
      if (length < 13) throw unsupported('bad IHDR');
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      sawEnd = true;
    }
  }
  if (!sawEnd) throw unsupported('truncated');
  if (!header) throw unsupported('no IHDR chunk');
  if (idat.length === 0) throw unsupported('no image data');
  if (header.interlace !== 0) throw unsupported('interlaced');
  if (header.bitDepth !== 8) throw unsupported(`bit depth ${header.bitDepth}`);
  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  if (channels === undefined) throw unsupported(`colour type ${header.colorType}`);
  if (header.colorType === 3 && !palette) throw unsupported('palette missing');
  assertSize(header.width, header.height);

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    throw unsupported('truncated or corrupt image data');
  }
  const pixels = unfilter(raw, header.width, header.height, channels);

  const { width, height } = header;
  const data = new Uint8ClampedArray(width * height * 4);
  const grayKey = header.colorType === 0 && transparency && transparency.length >= 2
    ? transparency.readUInt16BE(0) : null;
  const rgbKey = header.colorType === 2 && transparency && transparency.length >= 6
    ? [transparency.readUInt16BE(0), transparency.readUInt16BE(2), transparency.readUInt16BE(4)] : null;

  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * channels;
    const d = i * 4;
    switch (header.colorType) {
      case 0: {
        const g = pixels[s];
        data[d] = g; data[d + 1] = g; data[d + 2] = g;
        data[d + 3] = grayKey === g ? 0 : 255;
        break;
      }
      case 2: {
        const r = pixels[s]; const g = pixels[s + 1]; const b = pixels[s + 2];
        data[d] = r; data[d + 1] = g; data[d + 2] = b;
        const keyed = rgbKey && rgbKey[0] === r && rgbKey[1] === g && rgbKey[2] === b;
        data[d + 3] = keyed ? 0 : 255;
        break;
      }
      case 3: {
        const index = pixels[s];
        if (index * 3 + 2 >= palette.length) throw unsupported('palette index out of range');
        data[d] = palette[index * 3];
        data[d + 1] = palette[index * 3 + 1];
        data[d + 2] = palette[index * 3 + 2];
        data[d + 3] = transparency && index < transparency.length ? transparency[index] : 255;
        break;
      }
      case 4: {
        const g = pixels[s];
        data[d] = g; data[d + 1] = g; data[d + 2] = g;
        data[d + 3] = pixels[s + 1];
        break;
      }
      default: { // 6: RGBA
        data[d] = pixels[s]; data[d + 1] = pixels[s + 1];
        data[d + 2] = pixels[s + 2]; data[d + 3] = pixels[s + 3];
      }
    }
  }
  return { width, height, data };
}

/**
 * Encodes an image as an 8-bit RGBA PNG (colour type 6, filter None on every row).
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} image
 * @returns {Buffer}
 */
export function encodePngRgba(image) {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0; // no interlace
  return Buffer.concat([
    SIGNATURE,
    makeChunk('IHDR', header),
    makeChunk('IDAT', zlib.deflateSync(raw)),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A new image filled with one colour.
 * @param {number} width
 * @param {number} height
 * @param {number[]} [color=[0,0,0,255]] RGBA
 */
export function newImage(width, height, color = [0, 0, 0, 255]) {
  assertSize(width, height);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = color[3] ?? 255;
  }
  return { width, height, data };
}

/**
 * Copies the box [x0,x1) x [y0,y1), clamped to the image. Throws when the clamped box is empty.
 */
export function cropImage(image, x0, y0, x1, y1) {
  const cx0 = Math.min(Math.max(Math.floor(x0), 0), image.width);
  const cx1 = Math.min(Math.max(Math.floor(x1), 0), image.width);
  const cy0 = Math.min(Math.max(Math.floor(y0), 0), image.height);
  const cy1 = Math.min(Math.max(Math.floor(y1), 0), image.height);
  if (cx1 <= cx0 || cy1 <= cy0) throw new Error('crop box is empty');
  const width = cx1 - cx0;
  const height = cy1 - cy0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const s = ((cy0 + y) * image.width + cx0) * 4;
    data.set(image.data.subarray(s, s + width * 4), y * width * 4);
  }
  return { width, height, data };
}

function sampleBilinear(image, fx, fy, out, d) {
  const W = image.width;
  const H = image.height;
  const x0 = Math.min(Math.max(Math.floor(fx), 0), W - 1);
  const y0 = Math.min(Math.max(Math.floor(fy), 0), H - 1);
  const x1 = Math.min(x0 + 1, W - 1);
  const y1 = Math.min(y0 + 1, H - 1);
  const wx = Math.min(Math.max(fx - x0, 0), 1);
  const wy = Math.min(Math.max(fy - y0, 0), 1);
  const p00 = (y0 * W + x0) * 4;
  const p10 = (y0 * W + x1) * 4;
  const p01 = (y1 * W + x0) * 4;
  const p11 = (y1 * W + x1) * 4;
  const src = image.data;
  for (let c = 0; c < 4; c++) {
    const top = (1 - wx) * src[p00 + c] + wx * src[p10 + c];
    const bottom = (1 - wx) * src[p01 + c] + wx * src[p11 + c];
    out[d + c] = (1 - wy) * top + wy * bottom;
  }
}

/**
 * Resizes to exactly width x height. method: 'nearest' or 'bilinear'.
 */
export function resizeImage(image, width, height, method = 'bilinear') {
  assertSize(width, height);
  if (method !== 'nearest' && method !== 'bilinear') throw new Error(`unknown resize method: ${method}`);
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = image.width / width;
  const sy = image.height / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      if (method === 'nearest') {
        const nx = Math.min(image.width - 1, Math.floor((x + 0.5) * sx));
        const ny = Math.min(image.height - 1, Math.floor((y + 0.5) * sy));
        const s = (ny * image.width + nx) * 4;
        out[d] = image.data[s]; out[d + 1] = image.data[s + 1];
        out[d + 2] = image.data[s + 2]; out[d + 3] = image.data[s + 3];
      } else {
        sampleBilinear(image, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5, out, d);
      }
    }
  }
  return { width, height, data: out };
}

/**
 * Copies src into dst at (x, y), clipped to dst. Mutates dst and returns it.
 */
export function pasteImage(dst, src, x, y) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(dst.width, x + src.width);
  const y1 = Math.min(dst.height, y + src.height);
  if (x1 <= x0 || y1 <= y0) return dst;
  const span = (x1 - x0) * 4;
  for (let yy = y0; yy < y1; yy++) {
    const s = ((yy - y) * src.width + (x0 - x)) * 4;
    const d = (yy * dst.width + x0) * 4;
    dst.data.set(src.data.subarray(s, s + span), d);
  }
  return dst;
}

function setPixel(image, x, y, rgba) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const o = (y * image.width + x) * 4;
  image.data[o] = rgba[0];
  image.data[o + 1] = rgba[1];
  image.data[o + 2] = rgba[2];
  image.data[o + 3] = rgba[3] ?? 255;
}

// 3x5 digit font: one string per row, '#' is ink.
const GLYPHS = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '-': ['...', '...', '###', '...', '...'],
};

const DARK = [0, 0, 0, 255];

// Draws text at (x0, y0) with glyphs scaled x2 and a 1-pixel dark outline.
function drawLabel(image, text, x0, y0, color) {
  const scale = 2;
  const advance = 8; // glyph width 6 + gap 2
  const glyphH = 5 * scale;
  const textW = text.length * advance - 2;
  if (textW <= 0) return;
  const mask = new Uint8Array(textW * glyphH);
  for (let k = 0; k < text.length; k++) {
    const rows = GLYPHS[text[k]];
    if (!rows) continue;
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (rows[gy][gx] !== '#') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            mask[(gy * scale + sy) * textW + k * advance + gx * scale + sx] = 1;
          }
        }
      }
    }
  }
  for (let my = 0; my < glyphH; my++) {
    for (let mx = 0; mx < textW; mx++) {
      if (!mask[my * textW + mx]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) setPixel(image, x0 + mx + dx, y0 + my + dy, DARK);
      }
    }
  }
  for (let my = 0; my < glyphH; my++) {
    for (let mx = 0; mx < textW; mx++) {
      if (mask[my * textW + mx]) setPixel(image, x0 + mx, y0 + my, color);
    }
  }
}

/**
 * Draws a coordinate grid over the image. Lines sit at pixel columns/rows 0, step, 2*step...
 * Lines whose index is a multiple of labelEvery are 3 pixels thick and carry a number:
 * the top edge shows originX + column*unitsPerPixel, the left edge shows originY + row*unitsPerPixel
 * (the row-0 number is left out, the corner belongs to the column label). Mutates and returns image.
 */
export function drawGrid(image, options = {}) {
  const {
    step,
    originX = 0,
    originY = 0,
    color = [255, 0, 170, 255],
    labelEvery = 4,
    unitsPerPixel = 1,
  } = options;
  if (!Number.isInteger(step) || step < 1) throw new Error('grid step must be a positive integer');
  const every = Math.max(1, Math.floor(labelEvery));
  const { width, height } = image;

  for (let px = 0, index = 0; px < width; px += step, index++) {
    const thick = index % every === 0;
    const half = thick ? 1 : 0;
    for (let x = px - half; x <= px + half; x++) {
      for (let y = 0; y < height; y++) setPixel(image, x, y, color);
    }
    if (thick) drawLabel(image, String(Math.round(originX + px * unitsPerPixel)), px + 2, 2, color);
  }
  for (let py = 0, index = 0; py < height; py += step, index++) {
    const thick = index % every === 0;
    const half = thick ? 1 : 0;
    for (let y = py - half; y <= py + half; y++) {
      for (let x = 0; x < width; x++) setPixel(image, x, y, color);
    }
    if (thick && py > 0) drawLabel(image, String(Math.round(originY + py * unitsPerPixel)), 2, py + 2, color);
  }
  return image;
}

/**
 * Count, mean and population std per RGB channel over the pixels whose index satisfies predicate.
 * @param {object} image
 * @param {(index: number) => boolean} predicate index = y*width + x
 */
export function colorStats(image, predicate) {
  const { width, height, data } = image;
  const n = width * height;
  let count = 0;
  const sum = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!predicate(i)) continue;
    count++;
    sum[0] += data[i * 4]; sum[1] += data[i * 4 + 1]; sum[2] += data[i * 4 + 2];
  }
  if (count === 0) return { count: 0, mean: [0, 0, 0], std: [0, 0, 0] };
  const mean = sum.map((s) => s / count);
  const variance = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!predicate(i)) continue;
    for (let c = 0; c < 3; c++) variance[c] += (data[i * 4 + c] - mean[c]) ** 2;
  }
  return { count, mean, std: variance.map((v) => Math.sqrt(v / count)) };
}

/**
 * Mean RGB of the pixels selected by maskFn (all pixels when omitted). [0,0,0] when none.
 */
export function meanColor(image, maskFn = () => true) {
  return colorStats(image, maskFn).mean;
}

/**
 * Returns a copy of src where the pixels selected by predicateSrc have their RGB mean and std
 * moved to those of the pixels selected by predicateDst in dst. Scale is clamped to [0.5, 2].
 * Alpha is untouched. When either selection has fewer than 50 pixels, returns an unchanged copy.
 */
export function matchColors(src, dst, predicateSrc, predicateDst) {
  const out = { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
  const s = colorStats(src, predicateSrc);
  const d = colorStats(dst, predicateDst);
  if (s.count < 50 || d.count < 50) return out;
  const scale = [0, 1, 2].map((c) => {
    if (!(s.std[c] > 0)) return 1;
    return Math.min(Math.max(d.std[c] / s.std[c], 0.5), 2);
  });
  for (let i = 0, n = src.width * src.height; i < n; i++) {
    if (!predicateSrc(i)) continue;
    for (let c = 0; c < 3; c++) {
      const v = (src.data[i * 4 + c] - s.mean[c]) * scale[c] + d.mean[c];
      out.data[i * 4 + c] = Math.min(Math.max(v, 0), 255);
    }
  }
  return out;
}

/** SHA-256 of a buffer as lowercase hex. */
export function sha256Of(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Reads and decodes a PNG file. */
export function imageFromFile(filePath) {
  return decodePng(fs.readFileSync(filePath));
}

/** Writes an image as an RGBA PNG, creating the parent folder when needed. */
export function writePngFile(filePath, image) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encodePngRgba(image));
}
