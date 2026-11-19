import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTerrain } from './terrain.mjs';
import { canonicalJson, pointInPolygon, vertexOverlap } from './geometry.mjs';
import { snapshotOf, checkWrite } from './lock.mjs';

const CANVAS = { width: 1000, height: 1000 };

const landmass = (id, center, radius, extra = {}) => ({
  kind: 'landmass', id, center, radius, provenance: 'master', sources: [], ...extra,
});

function generate(constraints, extra = {}) {
  return generateTerrain({ canvas: CANVAS, seed: 42, constraints, ...extra });
}

const landPolygons = (features) => features.filter((f) => f.type === 'land').map((f) => f.polygon);

const perimeterOf = (polygon) => polygon.reduce((sum, p, i) => {
  const q = polygon[(i + 1) % polygon.length];
  return sum + Math.hypot(q[0] - p[0], q[1] - p[1]);
}, 0);

test('one landmass in the middle gives land, and a region inside it is not a problem', () => {
  const { features, problems } = generate([
    landmass('main', [500, 500], [300, 300]),
    { kind: 'region', place: 'north', at: [500, 500], radius: 40, provenance: 'master', sources: [] },
  ]);
  assert.ok(features.some((f) => f.type === 'land'));
  assert.deepEqual(problems, []);
  assert.ok(landPolygons(features).some((p) => pointInPolygon([500, 500], p)));
});

test('a region on a sea disk gives region-not-land', () => {
  const { problems } = generate([
    landmass('main', [500, 500], [300, 300]),
    { kind: 'region', place: 'south', at: [50, 50], radius: 10, provenance: 'master', sources: [] },
    { kind: 'sea', at: [50, 50], radius: 40, provenance: 'master', sources: [] },
  ]);
  assert.ok(problems.some((p) => p.code === 'region-not-land'));
});

test('a sea disk in the middle of a landmass leaves its centre out of the land: it is the lake sea-1', () => {
  const { features, problems } = generate([
    landmass('main', [500, 500], [300, 300]),
    { kind: 'sea', at: [500, 500], radius: 50, provenance: 'master', sources: [] },
    { kind: 'region', place: 'north', at: [500, 500], radius: 5, provenance: 'master', sources: [] },
  ]);
  assert.ok(features.some((f) => f.type === 'land'));
  // Land features have no holes: the sea inside is a lake, and a point in a lake is not land.
  const lake = features.find((f) => f.id === 'sea-1');
  assert.equal(lake?.type, 'lake');
  assert.ok(pointInPolygon([500, 500], lake.polygon));
  assert.ok(problems.some((p) => p.code === 'region-not-land'));
});

test('a sea disk inside a landmass is a lake sea-<k> feature, and a new sea inside locked land is reported', () => {
  const { features } = generate([
    landmass('main', [500, 500], [300, 300]),
    { kind: 'sea', at: [500, 500], radius: 50, provenance: 'master', sources: [] },
  ]);
  assert.equal(features.find((f) => f.type === 'lake')?.id, 'sea-1');

  const first = generate([landmass('main', [500, 500], [300, 300])]);
  const appended = generate(
    [landmass('main', [500, 500], [300, 300]), { kind: 'sea', at: [500, 500], radius: 50, provenance: 'master', sources: [] }],
    { locked: { features: first.features, constraintCount: 1 } },
  );
  assert.ok(appended.problems.some((p) => p.code === 'sea-in-locked-land'));
});

test('a lake inside land is a lake feature with its id; a lake at sea gives lake-not-inland', () => {
  const inside = generate([
    landmass('main', [500, 500], [300, 300]),
    { kind: 'lake', id: 'mere', at: [500, 500], radius: 60, provenance: 'master', sources: [] },
  ]);
  const lake = inside.features.find((f) => f.type === 'lake');
  assert.equal(lake?.id, 'mere');
  assert.deepEqual(inside.problems, []);

  const atSea = generate([
    landmass('main', [500, 500], [300, 300]),
    { kind: 'lake', id: 'lost', at: [50, 50], radius: 30, provenance: 'master', sources: [] },
  ]);
  assert.ok(atSea.problems.some((p) => p.code === 'lake-not-inland'));
});

test('lock and extend: old features stay identical, new ids continue, no overlap, and the lock accepts it', () => {
  const first = [landmass('main', [500, 500], [300, 300])];
  const generated = generate(first);
  const layer = { layer: 'terrain', constraints: first, features: generated.features };
  const manifest = { layers: { terrain: { locked: true, snapshot: snapshotOf(layer) } } };

  const extended = [...first, landmass('far-isle', [120, 120], [60, 60])];
  const grown = generate(extended, { locked: { features: generated.features, constraintCount: first.length } });
  assert.deepEqual(grown.problems, []);
  assert.deepEqual(grown.features.slice(0, generated.features.length), generated.features);

  const highest = Math.max(...generated.features.map((f) => Number(/^land-(\d+)$/.exec(f.id)?.[1] ?? 0)));
  const added = grown.features.slice(generated.features.length);
  assert.ok(added.length >= 1, 'the far landmass should add land');
  assert.equal(added[0].id, `land-${highest + 1}`);

  const lockedLand = generated.features.filter((f) => f.type === 'land').map((f) => f.polygon);
  for (const feature of added.filter((f) => f.type === 'land')) {
    assert.equal(lockedLand.some((polygon) => vertexOverlap(feature.polygon, polygon)), false);
  }

  const candidate = { layer: 'terrain', constraints: extended, features: grown.features };
  assert.equal(checkWrite(manifest, 'terrain', candidate, { current: layer }).ok, true);
});

test('determinism: the same inputs give the same features, and another seed differs', () => {
  const constraints = [landmass('main', [500, 500], [300, 300]), landmass('isle', [150, 800], [80, 60])];
  const a = canonicalJson(generate(constraints).features);
  assert.equal(canonicalJson(generate(constraints).features), a);
  const other = generateTerrain({ canvas: CANVAS, seed: 43, constraints });
  assert.notEqual(canonicalJson(other.features), a);
});

test('a 4000x3000 canvas with three landmasses generates well under 5 seconds', { timeout: 60000 }, () => {
  const constraints = [
    landmass('a', [1000, 1000], [700, 600]),
    landmass('b', [3000, 2000], [600, 500]),
    landmass('c', [2500, 700], [400, 300]),
  ];
  const started = performance.now();
  const { features } = generateTerrain({ canvas: { width: 4000, height: 3000 }, seed: 3, constraints });
  const elapsed = performance.now() - started;
  console.log(`generate 4000x3000, 3 landmasses: ${elapsed.toFixed(0)} ms, ${features.length} features`);
  assert.ok(elapsed < 5000, `took ${elapsed} ms`);
});

test('a rough landmass has an irregular coastline: perimeter well above the ellipse of the same radii', () => {
  const rx = 330;
  const ry = 260;
  const { features } = generate([landmass('main', [500, 500], [rx, ry], { roughness: 0.8 })]);
  const coast = features.filter((f) => f.type === 'land').map((f) => f.polygon)
    .sort((a, b) => perimeterOf(b) - perimeterOf(a))[0];
  // Ramanujan's approximation of the perimeter of the ellipse with the same radii.
  const ellipse = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  assert.ok(perimeterOf(coast) / ellipse > 1.35, `ratio ${perimeterOf(coast) / ellipse}`);
});

test('a lake with roughness 0.6 is not a circle: max and min distance from the centroid differ by more than 20%', () => {
  const { features } = generate([
    landmass('main', [500, 500], [420, 420]),
    { kind: 'lake', id: 'mere', at: [500, 500], radius: 120, roughness: 0.6, provenance: 'master', sources: [] },
  ]);
  const lake = features.find((f) => f.id === 'mere');
  const [cx, cy] = [0, 1].map((axis) => lake.polygon.reduce((sum, p) => sum + p[axis], 0) / lake.polygon.length);
  const distances = lake.polygon.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  assert.ok(Math.max(...distances) / Math.min(...distances) > 1.2);
});
