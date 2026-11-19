import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { encodePng, pngSize } from './png.mjs';

test('encodePng writes a signature, an IHDR of the right size and the same pixels back', () => {
  const rgb = Uint8Array.from([
    255, 0, 0, 0, 255, 0, 0, 0, 255,
    10, 20, 30, 40, 50, 60, 70, 80, 90,
  ]);
  const png = encodePng(3, 2, rgb);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(pngSize(png), { width: 3, height: 2 });

  const idatLength = png.readUInt32BE(33);
  assert.equal(png.toString('ascii', 37, 41), 'IDAT');
  const raw = zlib.inflateSync(png.subarray(41, 41 + idatLength));
  const rowBytes = 9;
  const pixels = Buffer.concat([
    raw.subarray(1, 1 + rowBytes),
    raw.subarray(2 + rowBytes, 2 + 2 * rowBytes),
  ]);
  assert.equal(raw.length, 2 * (rowBytes + 1));
  assert.deepEqual([...pixels], [...rgb]);
  assert.equal(raw[0], 0);
  assert.equal(raw[1 + rowBytes], 0);
});

test('pngSize returns null without the PNG signature', () => {
  assert.equal(pngSize(Buffer.from('not a png file at all, just text here')), null);
  assert.equal(pngSize(Buffer.alloc(4)), null);
});

test('encodePng refuses a pixel buffer of the wrong length', () => {
  assert.throws(() => encodePng(2, 2, new Uint8Array(5)), /png-data/);
});
