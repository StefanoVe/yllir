import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from './geometry.mjs';
import { generateWater } from './water.mjs';

const sq = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const canvas = { width: 1000, height: 1000 };
const terrain = {
  layer: 'terrain',
  features: [
    { id: 'land-1', type: 'land', polygon: sq(100, 100, 900, 900) },
    { id: 'lake-1', type: 'lake', polygon: sq(600, 600, 680, 680) },
  ],
};
const river = (extra = {}) => ({
  kind: 'river', id: 'silver', source: [400, 300], mouth: [102, 300], meander: 0.4, ...extra,
});

test('a river from inland to the coast is emitted, ending near the mouth', () => {
  const { features, problems } = generateWater({ canvas, seed: 9, constraints: [river()], layers: { terrain } });
  assert.deepEqual(problems, []);
  assert.equal(features.length, 1);
  assert.equal(features[0].type, 'river');
  assert.deepEqual(features[0].path[0], [400, 300]);
  assert.deepEqual(features[0].path.at(-1), [102, 300]);
});

test('a river whose mouth is inland gives river-mouth-not-water', () => {
  const inland = river({ mouth: [500, 500] });
  const { features, problems } = generateWater({ canvas, seed: 9, constraints: [inland], layers: { terrain } });
  assert.deepEqual(features, []);
  assert.ok(problems.some((p) => p.code === 'river-mouth-not-water'));
});

test('a river that starts at sea gives river-source-not-land', () => {
  const offshore = river({ source: [40, 300] });
  const { problems } = generateWater({ canvas, seed: 9, constraints: [offshore], layers: { terrain } });
  assert.ok(problems.some((p) => p.code === 'river-source-not-land'));
});

test('a river that runs through the sea before its mouth gives river-crosses-sea', () => {
  const crossing = river({ source: [400, 300], via: [[40, 320]], mouth: [102, 300] });
  const { problems } = generateWater({ canvas, seed: 9, constraints: [crossing], layers: { terrain } });
  assert.ok(problems.some((p) => p.code === 'river-crosses-sea'));
});

test('the same input gives the same river; another seed meanders differently', () => {
  const a = generateWater({ canvas, seed: 9, constraints: [river()], layers: { terrain } });
  const b = generateWater({ canvas, seed: 9, constraints: [river()], layers: { terrain } });
  assert.equal(canonicalJson(a.features), canonicalJson(b.features));
  const c = generateWater({ canvas, seed: 10, constraints: [river()], layers: { terrain } });
  assert.notEqual(canonicalJson(a.features), canonicalJson(c.features));
});
