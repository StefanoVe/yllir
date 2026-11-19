import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landMask, gridOf, SEA, LAND, LAKE } from './landmask.mjs';

const sq = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const canvas = { width: 1000, height: 1000 };
const terrain = {
  features: [
    { id: 'land-1', type: 'land', polygon: sq(200, 200, 800, 800) },
    { id: 'lake-1', type: 'lake', polygon: sq(450, 450, 550, 550) },
  ],
};

test('the grid is max(width, height) / 512 with the same size as terrain', () => {
  const grid = gridOf({ width: 4000, height: 3000 });
  assert.equal(grid.cell, 4000 / 512);
  assert.equal(grid.gw, Math.ceil(4000 / grid.cell) + 1);
});

test('kinds: sea outside, land inside, lake inside the lake polygon', () => {
  const mask = landMask({ canvas, terrain });
  assert.equal(mask.at(50, 50), SEA);
  assert.equal(mask.at(300, 300), LAND);
  assert.equal(mask.at(500, 500), LAKE);
  assert.equal(mask.isLand(300, 300), true);
  assert.equal(mask.isWater(500, 500), true);
  assert.equal(mask.isWater(300, 300), false);
});

test('coastDistance is zero on water and grows inland', () => {
  const mask = landMask({ canvas, terrain });
  assert.equal(mask.waterDistance(50, 50), 0);
  assert.equal(mask.waterDistance(500, 500), 0);
  const near = mask.waterDistance(210, 500);
  const far = mask.waterDistance(300, 500);
  assert.ok(near < far, `${near} < ${far}`);
  assert.ok(Math.abs(far - 100) <= mask.cell * 1.5, `distance to the sea ${far}`);
});

test('with no land every point is sea and there is no coast to measure', () => {
  const mask = landMask({ canvas, terrain: { features: [] } });
  assert.ok(mask.kind.every((k) => k === SEA));
});
