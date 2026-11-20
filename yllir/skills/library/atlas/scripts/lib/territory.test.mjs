// Tests of territory.mjs. Run: node --test yllir/skills/library/atlas/scripts/lib/territory.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newMask, countOnes } from './mask.mjs';
import {
  computeTerritories,
  maskToPaths,
  territoryAreaPixels,
  territoryCentroid,
} from './territory.mjs';

/** Land mask with the given rectangles [x0, y0, x1, y1) set to 1. */
function landFrom(width, height, rects) {
  const mask = newMask(width, height);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) mask.data[y * width + x] = 1;
    }
  }
  return mask;
}

function at(mask, x, y) {
  return mask.data[y * mask.width + x];
}

test('two islands separated by sea: the seed picks only its island', () => {
  const land = landFrom(40, 20, [[2, 5, 12, 15], [22, 5, 35, 15]]);
  const [mask] = [computeTerritories(land, [{ id: 't1', seeds: [[5, 10]] }]).get('t1')];
  assert.equal(countOnes(mask), 100);
  assert.equal(at(mask, 5, 10), 1);
  assert.equal(at(mask, 30, 10), 0);
});

test('a separate polygon cutting a land bridge splits the landmass; the seed picks its side', () => {
  const land = landFrom(40, 20, [[0, 0, 40, 20]]);
  const separate = [[[18, -1], [22, -1], [22, 21], [18, 21]]];
  const mask = computeTerritories(land, [{ id: 't1', seeds: [[5, 10]], separate }]).get('t1');
  assert.equal(countOnes(mask), 360);
  assert.equal(at(mask, 5, 10), 1);
  assert.equal(at(mask, 30, 10), 0);
});

test('add and remove polygons change the territory and stay on land', () => {
  const land = landFrom(60, 20, [[0, 0, 20, 20], [30, 0, 50, 20]]);
  const territories = [{
    id: 't1',
    seeds: [[5, 5]],
    add: [[[30, -1], [45, -1], [45, 21], [30, 21]]],
    remove: [[[-1, -1], [10, -1], [10, 21], [-1, 21]]],
  }];
  const mask = computeTerritories(land, territories).get('t1');
  // Island A minus its first ten columns (200) plus the part of island B inside the add polygon (300).
  assert.equal(countOnes(mask), 500);
  assert.equal(at(mask, 5, 5), 0);
  assert.equal(at(mask, 15, 5), 1);
  assert.equal(at(mask, 40, 5), 1);
});

test('an add polygon over sea adds nothing', () => {
  const land = landFrom(60, 20, [[0, 0, 20, 20]]);
  const add = [[[25, 0], [28, 0], [28, 19], [25, 19]]];
  const mask = computeTerritories(land, [{ id: 't1', seeds: [[5, 5]], add }]).get('t1');
  assert.equal(countOnes(mask), 400);
});

test('subtract removes the mask of an earlier territory', () => {
  const land = landFrom(40, 20, [[0, 0, 40, 20]]);
  const separate = [[[18, -1], [22, -1], [22, 21], [18, 21]]];
  const territories = [
    { id: 't1', seeds: [[5, 10]], separate },
    { id: 't2', seeds: [[30, 10]], subtract: ['t1'] },
  ];
  const result = computeTerritories(land, territories);
  assert.equal(countOnes(result.get('t1')), 360);
  const t2 = result.get('t2');
  assert.equal(countOnes(t2), 440);
  assert.equal(at(t2, 5, 10), 0);
  assert.equal(at(t2, 30, 10), 1);
});

test('a seed in water throws', () => {
  const land = landFrom(20, 20, [[0, 0, 10, 20]]);
  assert.throws(
    () => computeTerritories(land, [{ id: 't1', seeds: [[15, 5]] }]),
    /territory t1: seed \[15,5\] is not on land/,
  );
});

test('subtract of a later or unknown territory throws', () => {
  const land = landFrom(20, 20, [[0, 0, 20, 20]]);
  const territories = [
    { id: 't1', seeds: [[5, 5]], subtract: ['t2'] },
    { id: 't2', seeds: [[5, 5]] },
  ];
  assert.throws(() => computeTerritories(land, territories), /territory t1: subtract "t2"/);
});

test('maskToPaths of a 30x30 square gives one closed path inside the canvas', () => {
  const paths = maskToPaths(newMask(30, 30, 1));
  assert.equal(paths.length, 1);
  const [path] = paths;
  assert.ok(path.startsWith('M'));
  assert.ok(path.endsWith('Z'));
  const numbers = path.match(/-?\d+(\.\d+)?/g).map(Number);
  for (const n of numbers) {
    assert.ok(n >= 0 && n <= 30, `coordinate ${n} outside [0,30]`);
  }
});

test('maskToPaths of a donut gives two rings', () => {
  const donut = newMask(30, 30, 1);
  for (let y = 10; y < 20; y++) {
    for (let x = 10; x < 20; x++) donut.data[y * 30 + x] = 0;
  }
  const paths = maskToPaths(donut);
  assert.equal(paths.length, 2);
  for (const path of paths) {
    assert.ok(path.startsWith('M'));
    assert.ok(path.endsWith('Z'));
  }
});

test('territoryCentroid of a C-shaped mask lies inside the mask', () => {
  const mask = newMask(20, 20);
  const fill = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) mask.data[y * 20 + x] = 1;
    }
  };
  fill(2, 2, 6, 18);
  fill(2, 2, 18, 6);
  fill(2, 14, 18, 18);
  assert.equal(territoryAreaPixels(mask), 160);
  const [x, y] = territoryCentroid(mask);
  assert.equal(at(mask, x, y), 1);
  assert.equal(territoryCentroid(newMask(5, 5)), null);
});
