import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointInPolygon } from './geometry.mjs';
import { generateRoutes } from './routes.mjs';
import { generateRelief } from './relief.mjs';
import { generateBiomes } from './biomes.mjs';
import { generateTerrain } from './terrain.mjs';
import { generateWater } from './water.mjs';
import { generatePolitical } from './political.mjs';
import { landMask } from './landmask.mjs';

const sq = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const canvas = { width: 1000, height: 1000 };
const places = (entries) => ({
  layer: 'places',
  features: entries.map(([id, at]) => ({ id, place: id, at, icon: 'town', provenance: 'master', visibility: 'public', sources: [] })),
});
const road = (extra = {}) => ({ kind: 'road', id: 'road-ab', from: 'a', to: 'b', ...extra });
const straight = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

test('a road between two places avoids a lake in between', () => {
  const terrain = { layer: 'terrain', features: [
    { id: 'land-1', type: 'land', polygon: sq(100, 100, 900, 900) },
    { id: 'lake-1', type: 'lake', polygon: sq(400, 300, 600, 700) },
  ] };
  const layers = { terrain, places: places([['a', [150, 500]], ['b', [850, 500]]]) };
  const { features, problems } = generateRoutes({ canvas, seed: 2, constraints: [road()], layers });
  assert.deepEqual(problems, []);
  assert.equal(features.length, 1);
  assert.equal(features[0].type, 'road');
  assert.deepEqual(features[0].connects, ['a', 'b']);
  const lake = terrain.features[1].polygon;
  assert.ok(features[0].path.every((p) => !pointInPolygon(p, lake)), 'no path point inside the lake');
  assert.ok(features[0].path.length > 2, 'the road bends around the lake');
});

test('a road that would cross mountains takes the cheaper way around when one exists', () => {
  const terrain = { layer: 'terrain', features: [{ id: 'land-1', type: 'land', polygon: sq(100, 100, 900, 900) }] };
  const relief = generateRelief({
    canvas,
    seed: 2,
    constraints: [{ kind: 'range', id: 'wall', type: 'mountains', spine: [[500, 300], [500, 700]], width: 160 }],
    layers: { terrain },
  });
  assert.deepEqual(relief.problems, []);
  const layers = {
    terrain,
    relief: { layer: 'relief', features: relief.features },
    places: places([['a', [200, 500]], ['b', [800, 500]]]),
  };
  const { features, problems } = generateRoutes({ canvas, seed: 2, constraints: [road()], layers });
  assert.deepEqual(problems, []);
  const path = features[0].path;
  assert.ok(path.length - 1 >= 0);
  const length = path.slice(1).reduce((sum, p, k) => sum + Math.hypot(p[0] - path[k][0], p[1] - path[k][1]), 0);
  assert.ok(length > straight([200, 500], [800, 500]) * 1.05, `path length ${length} is longer than the straight line`);
  const wall = relief.features.filter((f) => f.type === 'mountains');
  assert.ok(path.every((p) => wall.every((w) => !pointInPolygon(p, w.polygon))), 'the road does not enter the mountains');
});

test('a sea route between two ports stays on sea', () => {
  const terrain = { layer: 'terrain', features: [{ id: 'land-1', type: 'land', polygon: sq(100, 100, 900, 900) }] };
  const layers = { terrain, places: places([['a', [30, 500]], ['b', [970, 500]]]) };
  const { features, problems } = generateRoutes({
    canvas,
    seed: 2,
    constraints: [{ kind: 'sea-route', id: 'sea-ab', from: 'a', to: 'b' }],
    layers,
  });
  assert.deepEqual(problems, []);
  assert.equal(features[0].type, 'sea-route');
  const mask = landMask({ canvas, terrain });
  assert.ok(features[0].path.every(([x, y]) => mask.kind[mask.indexOf(x, y)] === 0), 'every point is on sea');
});

test('a road to a place on another island gives no-route', () => {
  const terrain = { layer: 'terrain', features: [
    { id: 'west', type: 'land', polygon: sq(100, 300, 400, 700) },
    { id: 'far', type: 'land', polygon: sq(600, 300, 900, 700) },
  ] };
  const layers = { terrain, places: places([['a', [200, 500]], ['b', [800, 500]]]) };
  const { features, problems } = generateRoutes({ canvas, seed: 2, constraints: [road()], layers });
  assert.deepEqual(features, []);
  assert.deepEqual(problems.map((p) => p.code), ['no-route']);
});

test('a place that is not in the places layer gives unknown-route-place', () => {
  const terrain = { layer: 'terrain', features: [{ id: 'land-1', type: 'land', polygon: sq(100, 100, 900, 900) }] };
  const layers = { terrain, places: places([['a', [200, 500]]]) };
  const { problems } = generateRoutes({ canvas, seed: 2, constraints: [road()], layers });
  assert.deepEqual(problems.map((p) => p.code), ['unknown-route-place']);
});

test('a sea route from an inland place gives place-not-on-coast', () => {
  const terrain = { layer: 'terrain', features: [{ id: 'land-1', type: 'land', polygon: sq(100, 100, 900, 900) }] };
  const layers = { terrain, places: places([['a', [500, 500]], ['b', [970, 500]]]) };
  const { problems } = generateRoutes({
    canvas,
    seed: 2,
    constraints: [{ kind: 'sea-route', id: 'sea-ab', from: 'a', to: 'b' }],
    layers,
  });
  assert.ok(problems.some((p) => p.code === 'place-not-on-coast'));
});

test('without places the routes need missing-prerequisite', () => {
  const terrain = { layer: 'terrain', features: [{ id: 'land-1', type: 'land', polygon: sq(100, 100, 900, 900) }] };
  const { problems } = generateRoutes({ canvas, seed: 2, constraints: [road()], layers: { terrain } });
  assert.deepEqual(problems.map((p) => p.code), ['missing-prerequisite']);
});

test('all layers together on 4000x3000 with two landmasses, two ranges, three biomes, two rivers, three realms and three roads: under 10 s', () => {
  const big = { width: 4000, height: 3000 };
  const started = Date.now();
  const terrain = generateTerrain({
    canvas: big,
    seed: 42,
    constraints: [
      { kind: 'landmass', id: 'main', center: [1800, 1500], radius: [1300, 900], roughness: 0.8, provenance: 'agent-choice', sources: [] },
      { kind: 'landmass', id: 'isle', center: [3400, 700], radius: [350, 250], roughness: 0.6, provenance: 'agent-choice', sources: [] },
    ],
  });
  const terrainLayer = { layer: 'terrain', features: terrain.features };
  const relief = generateRelief({
    canvas: big,
    seed: 42,
    constraints: [
      { kind: 'range', id: 'spine', type: 'mountains', spine: [[1000, 1200], [2400, 1300]], width: 300 },
      { kind: 'range', id: 'downs', type: 'hills', spine: [[1200, 2000], [2200, 2100]], width: 200 },
    ],
    layers: { terrain: terrainLayer },
  });
  const reliefLayer = { layer: 'relief', features: relief.features };
  const biomes = generateBiomes({
    canvas: big,
    seed: 42,
    constraints: [
      { kind: 'biome', id: 'wood', type: 'forest', at: [1500, 1700], radius: 350 },
      { kind: 'biome', id: 'bog', type: 'swamp', at: [2600, 1200], radius: 250 },
      { kind: 'biome', id: 'plain', type: 'grassland', at: [1900, 1000], radius: 200 },
    ],
    layers: { terrain: terrainLayer, relief: reliefLayer },
  });
  const water = generateWater({
    canvas: big,
    seed: 42,
    constraints: [
      { kind: 'river', id: 'north-run', source: [1700, 1000], mouth: [1000, 330] },
      { kind: 'river', id: 'south-run', source: [2400, 2000], mouth: [1100, 2650] },
    ],
    layers: { terrain: terrainLayer },
  });
  const political = generatePolitical({
    canvas: big,
    seed: 42,
    constraints: [
      { kind: 'realm', id: 'ash', color: '#aa3322', seeds: [[800, 1500]] },
      { kind: 'realm', id: 'vale', color: '#2233aa', seeds: [[2600, 1800]] },
      { kind: 'realm', id: 'isle-state', color: '#22aa44', seeds: [[3400, 700]] },
    ],
    layers: { terrain: terrainLayer },
  });
  const layers = {
    terrain: terrainLayer,
    relief: reliefLayer,
    biomes: { layer: 'biomes', features: biomes.features },
    water: { layer: 'water', features: water.features },
    political: { layer: 'political', features: political.features },
    places: places([['p1', [900, 1500]], ['p2', [2600, 1800]], ['p3', [2300, 1000]]]),
  };
  const routes = generateRoutes({
    canvas: big,
    seed: 42,
    constraints: [
      { kind: 'road', id: 'r1', from: 'p1', to: 'p2' },
      { kind: 'road', id: 'r2', from: 'p2', to: 'p3' },
      { kind: 'trail', id: 't1', from: 'p1', to: 'p3' },
    ],
    layers,
  });
  const elapsed = Date.now() - started;
  // Reported in the test output: the total time of every layer.
  console.log(`all layers on 4000x3000: ${elapsed} ms; routes problems: ${routes.problems.length}`);
  assert.ok(elapsed < 10000, `took ${elapsed} ms`);
  assert.ok(terrain.features.length > 0);
});
