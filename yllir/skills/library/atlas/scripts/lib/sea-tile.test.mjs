import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newImage } from './image.mjs';
import { newMask } from './mask.mjs';
import { seaTileFromBase } from './sea-tile.mjs';

/** Land everywhere except the rectangle [x0, y0, x1, y1), which is sea (mask value 0). */
function landExceptSea(width, height, [x0, y0, x1, y1]) {
  const mask = newMask(width, height, 1);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask.data[y * width + x] = 0;
  return mask;
}

const pixelAt = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

test('all-sea picture gives a 2S x 2S tile of the requested side', () => {
  const image = newImage(100, 100, [40, 90, 160, 255]);
  const mask = newMask(100, 100, 0);
  const tile = seaTileFromBase(image, mask, { minSide: 32, maxSide: 32 });
  assert.equal(tile.width, 64);
  assert.equal(tile.height, 64);
  assert.equal(tile.data.length, 64 * 64 * 4);
});

test('a 40x40 sea block gives a side-80 tile made only of its pixels', () => {
  const width = 120;
  const height = 100;
  const image = newImage(width, height, [200, 50, 20, 255]);
  const block = [30, 20, 70, 60];
  const mask = landExceptSea(width, height, block);
  // Colour the rest of the picture differently so any leak from outside the block shows.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = x >= block[0] && x < block[2] && y >= block[1] && y < block[3];
      if (!inside) image.data.set([1, 2, 3, 255], (y * width + x) * 4);
    }
  }
  const tile = seaTileFromBase(image, mask);
  assert.equal(tile.width, 80);
  assert.equal(tile.height, 80);
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 80; x++) {
      assert.deepEqual(pixelAt(tile, x, y), [200, 50, 20, 255], `pixel ${x},${y}`);
    }
  }
});

test('returns null when the largest sea square is smaller than minSide', () => {
  const image = newImage(100, 100, [10, 10, 10, 255]);
  const mask = landExceptSea(100, 100, [10, 10, 30, 30]); // 20x20 sea
  assert.equal(seaTileFromBase(image, mask), null);
  assert.equal(seaTileFromBase(image, newMask(100, 100, 1)), null, 'no sea at all');
  assert.notEqual(seaTileFromBase(image, mask, { minSide: 20 }), null);
});

test('the tile is seamless: column 0 equals the last column, row 0 equals the last row', () => {
  const width = 90;
  const height = 90;
  const image = newImage(width, height, [0, 0, 0, 255]);
  const block = [20, 25, 60, 70]; // 40 x 45 sea, so the square is 40 wide
  // Horizontal gradient inside the sea block: the red channel changes with x, the blue with y.
  for (let y = block[1]; y < block[3]; y++) {
    for (let x = block[0]; x < block[2]; x++) {
      image.data.set([(x * 5) & 0xff, 100, (y * 3) & 0xff, 255], (y * width + x) * 4);
    }
  }
  const mask = landExceptSea(width, height, block);
  const tile = seaTileFromBase(image, mask);
  const side = tile.width;
  assert.equal(tile.height, side);
  assert.ok(side >= 64);
  for (let y = 0; y < side; y++) {
    assert.deepEqual(pixelAt(tile, 0, y), pixelAt(tile, side - 1, y), `row ${y}`);
  }
  for (let x = 0; x < side; x++) {
    assert.deepEqual(pixelAt(tile, x, 0), pixelAt(tile, x, side - 1), `column ${x}`);
  }
});

test('the inputs are not mutated', () => {
  const width = 80;
  const height = 80;
  const image = newImage(width, height, [5, 6, 7, 255]);
  for (let i = 0; i < image.data.length; i += 4) image.data[i] = (i * 13) & 0xff;
  const mask = landExceptSea(width, height, [10, 10, 50, 50]);
  const imageBefore = new Uint8ClampedArray(image.data);
  const maskBefore = new Uint8Array(mask.data);
  seaTileFromBase(image, mask);
  assert.deepEqual([...image.data], [...imageBefore]);
  assert.deepEqual([...mask.data], [...maskBefore]);
});

test('calling twice gives identical bytes', () => {
  const width = 70;
  const height = 60;
  const image = newImage(width, height, [30, 60, 90, 255]);
  for (let i = 0; i < image.data.length; i += 4) image.data[i + 1] = (i * 7) & 0xff;
  const mask = landExceptSea(width, height, [5, 5, 45, 50]);
  const first = seaTileFromBase(image, mask);
  const second = seaTileFromBase(image, mask);
  assert.deepEqual([...first.data], [...second.data]);
  assert.equal(first.width, second.width);
});
