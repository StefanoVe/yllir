import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poissonInPolygon } from './scatter.mjs';
import { pointInPolygon } from './geometry.mjs';

const SQUARE = [[0, 0], [400, 0], [400, 300], [0, 300]];
const HOLE = [[150, 100], [250, 100], [250, 200], [150, 200]];

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('poissonInPolygon: points are inside the polygon and outside every avoided polygon', () => {
  const points = poissonInPolygon({ polygon: SQUARE, spacing: 20, seed: 3, avoid: [HOLE] });
  assert.ok(points.length > 20, `expected many points, got ${points.length}`);
  for (const p of points) {
    assert.ok(pointInPolygon(p, SQUARE), `point ${p} is outside the polygon`);
    assert.ok(!pointInPolygon(p, HOLE), `point ${p} is inside an avoided polygon`);
  }
});

test('poissonInPolygon: no two points are closer than the spacing', () => {
  const spacing = 18;
  const points = poissonInPolygon({ polygon: SQUARE, spacing, seed: 11 });
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      assert.ok(dist(points[i], points[j]) >= spacing - 1e-9, `points ${i} and ${j} are too close`);
    }
  }
});

test('poissonInPolygon: the same seed gives the same points, another seed gives others', () => {
  const a = poissonInPolygon({ polygon: SQUARE, spacing: 25, seed: 5 });
  const b = poissonInPolygon({ polygon: SQUARE, spacing: 25, seed: 5 });
  const c = poissonInPolygon({ polygon: SQUARE, spacing: 25, seed: 6 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('planStamps: the style scale multiplies every stamp width, and mirrorTrees switches forest mirroring off', async () => {
  const { planStamps } = await import('./scatter.mjs');
  const { loadStyle } = await import('./styles.mjs');
  const assets = loadStyle('fantasy-color').manifest;
  const forest = { id: 'wood', type: 'forest', polygon: [[100, 100], [600, 100], [600, 600], [100, 600]] };
  const input = { assets, cell: 2, seed: 9, relief: [], biomes: [forest], land: [forest.polygon], water: [], places: [] };
  const base = planStamps(input);
  const scaled = planStamps({ ...input, stampScale: 2 });
  assert.ok(base.length > 5);
  assert.equal(scaled.length, base.length);
  assert.ok(Math.abs(scaled[0].width - 2 * base[0].width) < 1e-9);
  assert.ok(base.some((s) => s.mirror), 'forests are mirrored by default');
  assert.ok(!planStamps({ ...input, mirrorTrees: false }).some((s) => s.mirror), 'no forest stamp is mirrored when mirrorTrees is off');
});
