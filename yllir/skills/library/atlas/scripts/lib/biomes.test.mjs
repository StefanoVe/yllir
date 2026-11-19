import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, pointInPolygon } from './geometry.mjs';
import { generateBiomes } from './biomes.mjs';
import { generateRelief } from './relief.mjs';

const sq = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const canvas = { width: 1000, height: 1000 };
const terrain = { layer: 'terrain', features: [{ id: 'land-1', type: 'land', polygon: sq(100, 100, 900, 900) }] };
const mountains = {
  kind: 'range', id: 'peaks', type: 'mountains', spine: [[300, 500], [700, 500]], width: 140,
};
const forest = (extra = {}) => ({
  kind: 'biome', id: 'woods', type: 'forest', at: [500, 380], radius: 160, ...extra,
});

function withRelief(seed = 5) {
  const relief = generateRelief({ canvas, seed, constraints: [mountains], layers: { terrain } });
  assert.deepEqual(relief.problems, []);
  return { terrain, relief: { layer: 'relief', features: relief.features } };
}

test('a forest next to a mountain range does not overlap it', () => {
  const layers = withRelief();
  const { features, problems } = generateBiomes({ canvas, seed: 5, constraints: [forest()], layers });
  assert.deepEqual(problems, []);
  // The range splits the forest into pieces: the main one keeps the id, the others get -2, -3.
  assert.ok(features.length >= 1);
  assert.equal(features[0].id, 'woods');
  const peaks = layers.relief.features.filter((f) => f.type === 'mountains');
  for (const [x, y] of features[0].polygon) {
    for (const peak of peaks) {
      assert.equal(pointInPolygon([x, y], peak.polygon), false, `forest vertex ${x},${y} is inside the mountains`);
    }
  }
});

test('avoidRelief false lets a forest enter the mountains', () => {
  const layers = withRelief();
  const { features } = generateBiomes({ canvas, seed: 5, constraints: [forest({ avoidRelief: false })], layers });
  const peaks = layers.relief.features.filter((f) => f.type === 'mountains');
  const inside = features[0].polygon.some(([x, y]) => peaks.some((p) => pointInPolygon([x, y], p.polygon)));
  assert.ok(inside);
});

test('a biome entirely at sea gives biome-not-on-land', () => {
  const { problems, features } = generateBiomes({
    canvas,
    seed: 5,
    constraints: [forest({ at: [30, 30], radius: 10 })],
    layers: { terrain },
  });
  assert.deepEqual(features, []);
  assert.deepEqual(problems.map((p) => p.code), ['biome-not-on-land']);
});

test('the same input gives the same features; another seed changes them', () => {
  const layers = withRelief();
  const a = generateBiomes({ canvas, seed: 5, constraints: [forest()], layers });
  const b = generateBiomes({ canvas, seed: 5, constraints: [forest()], layers });
  assert.equal(canonicalJson(a.features), canonicalJson(b.features));
  const c = generateBiomes({ canvas, seed: 6, constraints: [forest()], layers });
  assert.notEqual(canonicalJson(a.features), canonicalJson(c.features));
});
