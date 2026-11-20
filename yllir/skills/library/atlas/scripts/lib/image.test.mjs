import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodePng } from '../../../../../scripts/lib/png.mjs';
import {
  decodePng,
  encodePngRgba,
  newImage,
  cropImage,
  resizeImage,
  pasteImage,
  drawGrid,
  colorStats,
  meanColor,
  matchColors,
  sha256Of,
  imageFromFile,
  writePngFile,
} from './image.mjs';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function header({ width, height, bitDepth = 8, colorType, interlace = 0 }) {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(width, 0);
  h.writeUInt32BE(height, 4);
  h[8] = bitDepth;
  h[9] = colorType;
  h[10] = 0;
  h[11] = 0;
  h[12] = interlace;
  return h;
}

// Builds a PNG file from already-encoded chunk payloads (raw scanlines are deflated here).
function buildPng(chunks) {
  return Buffer.concat([SIGNATURE, ...chunks.map(([type, data]) => chunk(type, data)), chunk('IEND', Buffer.alloc(0))]);
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

// Forward filter written from the PNG spec, independent of the decoder code.
function filterRow(type, row, prev, bpp) {
  const out = Buffer.alloc(row.length);
  for (let i = 0; i < row.length; i++) {
    const x = row[i];
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let predictor = 0;
    if (type === 1) predictor = a;
    else if (type === 2) predictor = b;
    else if (type === 3) predictor = (a + b) >> 1;
    else if (type === 4) predictor = paeth(a, b, c);
    out[i] = (x - predictor) & 0xff;
  }
  return out;
}

function rgbPixels(width, height) {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 37 + 11) & 0xff;
  return rgb;
}

function solid(width, height, color) {
  return newImage(width, height, color);
}

test('encodePngRgba then decodePng returns the exact same pixels', () => {
  const width = 5;
  const height = 3;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 0xff;
  const png = encodePngRgba({ width, height, data });
  assert.deepEqual([...png.subarray(0, 8)], [...SIGNATURE]);
  const back = decodePng(png);
  assert.equal(back.width, width);
  assert.equal(back.height, height);
  assert.deepEqual([...back.data], [...data]);
});

test('decodePng reads a PNG written by the existing encodePng (RGB) as opaque RGBA', () => {
  const rgb = Uint8Array.from([
    255, 0, 0, 0, 255, 0, 0, 0, 255,
    10, 20, 30, 40, 50, 60, 70, 80, 90,
  ]);
  const img = decodePng(encodePng(3, 2, rgb));
  assert.equal(img.width, 3);
  assert.equal(img.height, 2);
  const expected = [];
  for (let i = 0; i < 6; i++) expected.push(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255);
  assert.deepEqual([...img.data], expected);
});

test('decodePng reads a palette PNG with tRNS alpha', () => {
  const palette = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const trns = Buffer.from([0, 128]); // entry 0 fully transparent, entry 1 half, entry 2 opaque by default
  const raw = Buffer.from([
    0, 0, 1, // row 0, filter None: indices 0, 1
    0, 2, 0, // row 1, filter None: indices 2, 0
  ]);
  const png = buildPng([
    ['IHDR', header({ width: 2, height: 2, colorType: 3 })],
    ['PLTE', palette],
    ['tRNS', trns],
    ['IDAT', zlib.deflateSync(raw)],
  ]);
  const img = decodePng(png);
  assert.deepEqual([...img.data], [
    255, 0, 0, 0,
    0, 255, 0, 128,
    0, 0, 255, 255,
    255, 0, 0, 0,
  ]);
});

test('decodePng handles gray, gray+alpha and RGBA sources', () => {
  const gray = buildPng([
    ['IHDR', header({ width: 2, height: 1, colorType: 0 })],
    ['IDAT', zlib.deflateSync(Buffer.from([0, 50, 200]))],
  ]);
  assert.deepEqual([...decodePng(gray).data], [50, 50, 50, 255, 200, 200, 200, 255]);

  const grayAlpha = buildPng([
    ['IHDR', header({ width: 1, height: 1, colorType: 4 })],
    ['IDAT', zlib.deflateSync(Buffer.from([0, 90, 33]))],
  ]);
  assert.deepEqual([...decodePng(grayAlpha).data], [90, 90, 90, 33]);

  const rgba = buildPng([
    ['IHDR', header({ width: 1, height: 1, colorType: 6 })],
    ['IDAT', zlib.deflateSync(Buffer.from([0, 1, 2, 3, 4]))],
  ]);
  assert.deepEqual([...decodePng(rgba).data], [1, 2, 3, 4]);
});

test('decodePng undoes each of the five scanline filters', () => {
  const width = 4;
  const height = 4;
  const bpp = 3;
  const rgb = rgbPixels(width, height);
  const stride = width * bpp;
  for (let type = 0; type <= 4; type++) {
    const parts = [];
    for (let y = 0; y < height; y++) {
      const row = rgb.subarray(y * stride, (y + 1) * stride);
      const prev = y === 0 ? Buffer.alloc(stride) : rgb.subarray((y - 1) * stride, y * stride);
      parts.push(Buffer.from([type]), filterRow(type, row, prev, bpp));
    }
    const png = buildPng([
      ['IHDR', header({ width, height, colorType: 2 })],
      ['IDAT', zlib.deflateSync(Buffer.concat(parts))],
    ]);
    const img = decodePng(png);
    const expected = [];
    for (let i = 0; i < width * height; i++) expected.push(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255);
    assert.deepEqual([...img.data], expected, `filter ${type}`);
  }
});

test('decodePng rejects interlaced PNGs', () => {
  const png = buildPng([
    ['IHDR', header({ width: 2, height: 2, colorType: 2, interlace: 1 })],
    ['IDAT', zlib.deflateSync(Buffer.alloc(20))],
  ]);
  assert.throws(() => decodePng(png), /unsupported PNG: interlaced/);
});

test('decodePng rejects bit depths other than 8', () => {
  const png = buildPng([
    ['IHDR', header({ width: 2, height: 2, bitDepth: 16, colorType: 2 })],
    ['IDAT', zlib.deflateSync(Buffer.alloc(20))],
  ]);
  assert.throws(() => decodePng(png), /unsupported PNG: bit depth 16/);
});

test('decodePng rejects a bad signature and truncated files', () => {
  assert.throws(() => decodePng(Buffer.from('definitely not a png file')), /unsupported PNG: bad signature/);
  const full = encodePngRgba(solid(4, 4, [1, 2, 3, 255]));
  assert.throws(() => decodePng(full.subarray(0, Math.floor(full.length / 2))), /unsupported PNG: truncated/);
  assert.throws(() => decodePng(full.subarray(0, full.length - 12)), /unsupported PNG: truncated/);
});

test('cropImage copies the box and clamps it to the image', () => {
  const src = decodePng(encodePng(10, 10, rgbPixels(10, 10)));
  const crop = cropImage(src, 2, 3, 6, 8);
  assert.equal(crop.width, 4);
  assert.equal(crop.height, 5);
  assert.deepEqual([...crop.data.subarray(0, 4)], [...src.data.subarray((3 * 10 + 2) * 4, (3 * 10 + 2) * 4 + 4)]);

  const clamped = cropImage(src, -5, -5, 4, 4);
  assert.equal(clamped.width, 4);
  assert.equal(clamped.height, 4);
  assert.deepEqual([...clamped.data.subarray(0, 4)], [...src.data.subarray(0, 4)]);

  assert.throws(() => cropImage(src, 20, 20, 30, 30), /crop box is empty/);
  assert.throws(() => cropImage(src, 5, 5, 5, 9), /crop box is empty/);
});

test('resizeImage returns exactly the requested size and keeps a solid colour solid', () => {
  const img = solid(4, 4, [10, 20, 30, 255]);
  for (const method of ['bilinear', 'nearest']) {
    const out = resizeImage(img, 7, 3, method);
    assert.equal(out.width, 7);
    assert.equal(out.height, 3);
    assert.equal(out.data.length, 7 * 3 * 4);
    for (let i = 0; i < out.data.length; i += 4) {
      assert.deepEqual([...out.data.subarray(i, i + 4)], [10, 20, 30, 255], method);
    }
  }
  const grown = resizeImage(decodePng(encodePng(2, 2, rgbPixels(2, 2))), 5, 9);
  assert.equal(grown.width, 5);
  assert.equal(grown.height, 9);
});

test('pasteImage copies src at the position and clips to dst', () => {
  const dst = solid(4, 4, [255, 255, 255, 255]);
  const red = solid(3, 3, [255, 0, 0, 255]);
  pasteImage(dst, red, 2, 2);
  const at = (x, y) => [...dst.data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
  assert.deepEqual(at(2, 2), [255, 0, 0, 255]);
  assert.deepEqual(at(3, 3), [255, 0, 0, 255]);
  assert.deepEqual(at(1, 2), [255, 255, 255, 255]);
  assert.deepEqual(at(0, 0), [255, 255, 255, 255]);

  const blue = solid(3, 3, [0, 0, 255, 255]);
  pasteImage(dst, blue, -1, -1);
  assert.deepEqual(at(0, 0), [0, 0, 255, 255]);
  assert.deepEqual(at(1, 1), [0, 0, 255, 255]);
  assert.deepEqual(at(2, 0), [255, 255, 255, 255]);
  assert.equal(dst.width, 4);
  assert.equal(dst.height, 4);

  pasteImage(dst, blue, 10, 10); // fully outside: no change, no throw
  assert.deepEqual(at(3, 3), [255, 0, 0, 255]);
});

test('drawGrid draws lines in the grid colour, keeps the size and leaves far pixels alone', () => {
  const img = solid(100, 100, [200, 200, 200, 255]);
  const color = [255, 0, 170, 255];
  const out = drawGrid(img, { step: 40, color });
  assert.equal(out, img);
  assert.equal(out.width, 100);
  assert.equal(out.height, 100);
  const at = (x, y) => [...out.data.subarray((y * 100 + x) * 4, (y * 100 + x) * 4 + 4)];
  assert.deepEqual(at(40, 60), color);
  assert.deepEqual(at(20, 40), color);
  assert.deepEqual(at(20, 60), [200, 200, 200, 255]);

  // Labels (dark outline pixels) appear on the top-left, where the first line is labelled.
  let dark = 0;
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 20; x++) {
      const p = at(x, y);
      if (p[0] === 0 && p[1] === 0 && p[2] === 0) dark++;
    }
  }
  assert.ok(dark > 0, 'expected a dark label outline in the top-left corner');
});

test('drawGrid rejects a non-positive step', () => {
  assert.throws(() => drawGrid(solid(10, 10), { step: 0 }), /grid step/);
});

test('colorStats returns count, mean and population std over the selected pixels', () => {
  const img = solid(2, 2, [0, 0, 0, 255]);
  img.data.set([10, 20, 30, 255], 0);
  img.data.set([30, 40, 50, 255], 12); // index 3
  const stats = colorStats(img, (i) => i === 0 || i === 3);
  assert.equal(stats.count, 2);
  assert.deepEqual(stats.mean, [20, 30, 40]);
  assert.deepEqual(stats.std, [10, 10, 10]);
  assert.deepEqual(meanColor(img, (i) => i === 0 || i === 3), [20, 30, 40]);

  const none = colorStats(img, () => false);
  assert.deepEqual(none, { count: 0, mean: [0, 0, 0], std: [0, 0, 0] });
});

test('matchColors moves the mean of a dark image toward a bright target', () => {
  const width = 40;
  const height = 40;
  const src = solid(width, height, [0, 0, 0, 255]);
  const dst = solid(width, height, [0, 0, 0, 255]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dark = 20 + ((x * 7 + y * 13) % 40);
      const bright = 180 + ((x * 5 + y * 3) % 40);
      src.data.set([dark, dark, dark, 255], i);
      dst.data.set([bright, bright, bright, 255], i);
    }
  }
  const all = () => true;
  const target = meanColor(dst, all);
  const before = meanColor(src, all);
  assert.ok(before[0] < 60);

  const out = matchColors(src, dst, all, all);
  const after = meanColor(out, all);
  for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(after[c] - target[c]) <= 5, `channel ${c}: ${after[c]} vs ${target[c]}`);
  }
  assert.equal(out.data[3], 255);
});

test('matchColors leaves the image unchanged when a selection is tiny', () => {
  const src = solid(20, 20, [30, 60, 90, 255]);
  const dst = solid(20, 20, [200, 200, 200, 255]);
  const out = matchColors(src, dst, (i) => i < 10, () => true);
  assert.deepEqual([...out.data], [...src.data]);
  assert.notEqual(out.data, src.data);

  const out2 = matchColors(src, dst, () => true, (i) => i < 10);
  assert.deepEqual([...out2.data], [...src.data]);
});

test('sha256Of returns the hex digest', () => {
  assert.equal(sha256Of(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('writePngFile creates the folder and imageFromFile reads it back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-image-test-'));
  try {
    const img = decodePng(encodePng(3, 2, rgbPixels(3, 2)));
    const file = path.join(dir, 'nested', 'deeper', 'out.png');
    writePngFile(file, img);
    assert.ok(fs.existsSync(file));
    assert.deepEqual([...imageFromFile(file).data], [...img.data]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
