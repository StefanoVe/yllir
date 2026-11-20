import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newImage } from './image.mjs';
import { newMask } from './mask.mjs';
import { largestSeaSquare, makeSeamless } from './sea-tile.mjs';

/** Deterministic pseudo-random bytes: a fixed linear congruential sequence. */
function noisyImage(width, height, seed = 12345) {
  const image = newImage(width, height, [0, 0, 0, 255]);
  let s = seed;
  for (let i = 0; i < image.data.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    image.data[i] = (s >>> 16) & 0xff;
  }
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
  return image;
}

const pixelAt = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

test('largestSeaSquare: all sea gives the smaller side at the origin', () => {
  assert.deepEqual(largestSeaSquare(newMask(10, 6, 0)), { side: 6, x0: 0, y0: 0 });
  assert.deepEqual(largestSeaSquare(newMask(6, 10, 0)), { side: 6, x0: 0, y0: 0 });
});

test('largestSeaSquare: one land pixel in the middle of 10x10 gives side 5, the first square in row-major order', () => {
  const mask = newMask(10, 10, 0);
  mask.data[5 * 10 + 5] = 1;
  assert.deepEqual(largestSeaSquare(mask), { side: 5, x0: 0, y0: 0 });
});

test('largestSeaSquare: no sea gives side 0', () => {
  assert.equal(largestSeaSquare(newMask(8, 8, 1)).side, 0);
});

test('makeSeamless: the output has the size of the input and is opaque', () => {
  const image = noisyImage(37, 23);
  const out = makeSeamless(image);
  assert.equal(out.width, 37);
  assert.equal(out.height, 23);
  assert.equal(out.data.length, 37 * 23 * 4);
  for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], 255);
});

test('makeSeamless: across the wrap, neighbours differ no more than the largest neighbour difference inside the image', () => {
  const W = 64;
  const H = 48;
  const image = noisyImage(W, H);
  const out = makeSeamless(image);
  // Horizontal: the largest difference between two adjacent pixels of the input, per channel.
  for (let c = 0; c < 3; c++) {
    let inside = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) {
      inside = Math.max(inside, Math.abs(pixelAt(image, x + 1, y)[c] - pixelAt(image, x, y)[c]));
    }
    for (let y = 0; y < H; y++) {
      const wrap = Math.abs(pixelAt(out, 0, y)[c] - pixelAt(out, W - 1, y)[c]);
      assert.ok(wrap <= inside, `channel ${c} row ${y}: wrap ${wrap} > ${inside}`);
    }
    // Vertical wrap, the same bound with the rows of the input.
    let insideV = 0;
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x++) {
      insideV = Math.max(insideV, Math.abs(pixelAt(image, x, y + 1)[c] - pixelAt(image, x, y)[c]));
    }
    for (let x = 0; x < W; x++) {
      const wrap = Math.abs(pixelAt(out, x, 0)[c] - pixelAt(out, x, H - 1)[c]);
      assert.ok(wrap <= insideV, `channel ${c} column ${x}: vertical wrap ${wrap} > ${insideV}`);
    }
  }
});

test('makeSeamless: the input is not mutated', () => {
  const image = noisyImage(40, 30);
  const before = new Uint8ClampedArray(image.data);
  makeSeamless(image);
  assert.deepEqual([...image.data], [...before]);
});

test('makeSeamless: two calls give identical bytes', () => {
  const image = noisyImage(50, 44, 999);
  const first = makeSeamless(image);
  const second = makeSeamless(image);
  assert.deepEqual([...first.data], [...second.data]);
});
