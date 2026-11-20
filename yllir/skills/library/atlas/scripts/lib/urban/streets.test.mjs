import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateStreets } from './streets.mjs';
import { pointInPolygon } from '../geometry.mjs';

const CANVAS = { width: 2400, height: 1800 };
const AREA = [[100, 100], [900, 100], [900, 600], [100, 600]];
const RIVER = [[300, -100], [360, -100], [360, 900], [300, 900]];
const water = (polygon) => ({ layer: 'ground', features: [{ id: 'river', type: 'water', kind: 'river', polygon }] });

const generate = (constraints, extra = {}) => generateStreets({ canvas: CANVAS, seed: 11, constraints, ...extra });
const streetsOf = (features) => features.filter((f) => f.type === 'street');

/** Distance from a point to the nearest edge of a polygon. */
function edgeDistance(point, polygon) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)));
  }
  return best;
}

test('a main street is smoothed, keeps its ends and takes the default width', () => {
  const { features, problems } = generate([
    { kind: 'street', id: 'high-street', rank: 'main', path: [[0, 0], [100, 0], [100, 100]], provenance: 'master', sources: [] },
  ]);
  assert.deepEqual(problems, []);
  const [street] = streetsOf(features);
  assert.equal(street.id, 'high-street');
  assert.equal(street.rank, 'main');
  assert.equal(street.width, 14);
  assert.deepEqual(street.path[0], [0, 0]);
  assert.deepEqual(street.path[street.path.length - 1], [100, 100]);
  assert.ok(street.path.length > 3, 'the corner is cut');
  assert.equal(street.provenance, 'master');
});

test('the default width by rank is 9 for secondary and 5 for lanes, and an explicit width wins', () => {
  const { features } = generate([
    { kind: 'street', id: 'a', rank: 'secondary', path: [[0, 0], [100, 0]] },
    { kind: 'street', id: 'b', rank: 'lane', path: [[0, 50], [100, 50]] },
    { kind: 'street', id: 'c', rank: 'lane', path: [[0, 90], [100, 90]], width: 7 },
  ]);
  const widths = Object.fromEntries(streetsOf(features).map((f) => [f.id, f.width]));
  assert.deepEqual(widths, { a: 9, b: 5, c: 7 });
});

test('a square is a polygon of its four corners', () => {
  const { features, problems } = generate([
    { kind: 'square', id: 'market', at: [200, 200], size: [40, 20] },
  ]);
  assert.deepEqual(problems, []);
  assert.deepEqual(features, [{
    id: 'market', type: 'square', polygon: [[180, 190], [220, 190], [220, 210], [180, 210]], provenance: 'agent-choice', visibility: 'public', sources: [],
  }]);
});

test('a square rotated by an angle keeps its size', () => {
  const { features } = generate([{ kind: 'square', id: 'turned', at: [200, 200], size: [40, 20], angle: Math.PI / 2 }]);
  const [a, b, c] = features[0].polygon;
  // The first edge runs along the width (40), turned a quarter turn it points down the canvas.
  assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - 40) < 0.2);
  assert.ok(Math.abs(b[0] - a[0]) < 0.2, 'the width edge is vertical');
  assert.ok(Math.abs(Math.hypot(c[0] - b[0], c[1] - b[1]) - 20) < 0.2);
});

test('a grid is clipped to its area, every end stays inside, and its streets get the grid id', () => {
  const { features, problems } = generate([{ kind: 'grid', id: 'old-town', area: AREA, spacing: 50 }]);
  assert.deepEqual(problems, []);
  const streets = streetsOf(features);
  assert.ok(streets.length > 10, 'the grid has many streets');
  assert.ok(streets.every((f) => /^old-town-\d+$/.test(f.id)));
  assert.ok(streets.every((f) => f.rank === 'lane' && f.width === 5));
  for (const street of streets) {
    for (const end of [street.path[0], street.path[street.path.length - 1]]) {
      assert.ok(pointInPolygon(end, AREA) || edgeDistance(end, AREA) < 0.1, `end ${end} is inside the area`);
    }
  }
  const horizontal = streets.filter((f) => f.path[0][1] === f.path[f.path.length - 1][1]);
  assert.ok(horizontal.length > 0 && horizontal.length < streets.length, 'both families of lines are drawn');
});

test('grid ends jitter with the seed, stay in the area, and the same seed gives the same grid', () => {
  const constraints = [{ kind: 'grid', id: 'g', area: AREA, spacing: 60, jitter: 0.8 }];
  const first = generate(constraints).features;
  assert.deepEqual(first, generate(constraints).features);
  const other = generateStreets({ canvas: CANVAS, seed: 12, constraints }).features;
  assert.notDeepEqual(first, other);
  const flat = generate([{ kind: 'grid', id: 'g', area: AREA, spacing: 60, jitter: 0 }]).features;
  assert.notDeepEqual(first, flat);
  for (const street of streetsOf(first)) {
    for (const end of [street.path[0], street.path[street.path.length - 1]]) {
      assert.ok(pointInPolygon(end, AREA) || edgeDistance(end, AREA) < 0.1);
    }
  }
});

test('a main street that crosses a river gets a bridge and stays continuous', () => {
  const { features, problems } = generate([
    { kind: 'street', id: 'king-road', rank: 'main', path: [[100, 400], [700, 400]] },
  ], { layers: { ground: water(RIVER) } });
  assert.deepEqual(problems, []);
  const streets = streetsOf(features);
  assert.equal(streets.length, 1, 'the main street is not cut');
  assert.equal(streets[0].id, 'king-road');
  assert.deepEqual(streets[0].path[0], [100, 400]);
  assert.deepEqual(streets[0].path[streets[0].path.length - 1], [700, 400]);

  const bridges = features.filter((f) => f.type === 'bridge');
  assert.equal(bridges.length, 1);
  assert.equal(bridges[0].id, 'bridge-king-road-1');
  assert.equal(bridges[0].width, 16);
  const [left, right] = bridges[0].path;
  assert.ok(Math.abs(left[0] - 296) < 1.5, `bridge starts about 4 units before the river, got ${left[0]}`);
  assert.ok(Math.abs(right[0] - 364) < 1.5, `bridge ends about 4 units after the river, got ${right[0]}`);
  assert.equal(left[1], 400);
  assert.equal(right[1], 400);
});

test('a secondary street over water gets a bridge too, with width 11', () => {
  const { features } = generate([
    { kind: 'street', id: 'mill-lane', rank: 'secondary', path: [[100, 300], [700, 300]] },
  ], { layers: { ground: water(RIVER) } });
  const bridge = features.find((f) => f.type === 'bridge');
  assert.equal(bridge.id, 'bridge-mill-lane-1');
  assert.equal(bridge.width, 11);
  assert.equal(streetsOf(features).length, 1);
});

test('a lane is cut where it runs in water, and its dry pieces take a numbered id', () => {
  const { features, problems } = generate([
    { kind: 'street', id: 'wharf', rank: 'lane', path: [[100, 600], [700, 600]] },
  ], { layers: { ground: water(RIVER) } });
  assert.deepEqual(problems, []);
  const pieces = streetsOf(features);
  assert.deepEqual(pieces.map((f) => f.id), ['wharf-1', 'wharf-2']);
  assert.equal(features.filter((f) => f.type === 'bridge').length, 0, 'lanes get no bridge');
  for (const piece of pieces) {
    for (const [x] of piece.path) assert.ok(x <= 300.05 || x >= 359.95, `point at x=${x} is on dry land`);
  }
  assert.ok(pieces[0].path[pieces[0].path.length - 1][0] <= 300.05);
  assert.ok(pieces[1].path[0][0] >= 359.95);
});

test('a lane cut to a stub shorter than 10 units is dropped, and a lane with no water keeps its id', () => {
  const stub = generate([{ kind: 'street', id: 'stub', rank: 'lane', path: [[295, 200], [310, 200]] }], { layers: { ground: water(RIVER) } });
  assert.deepEqual(streetsOf(stub.features), []);
  const dry = generate([{ kind: 'street', id: 'dry', rank: 'lane', path: [[0, 200], [100, 200]] }], { layers: { ground: water(RIVER) } });
  assert.deepEqual(streetsOf(dry.features).map((f) => f.id), ['dry']);
});

test('locked streets keep their features and only new constraints add features', () => {
  const locked = {
    constraintCount: 1,
    features: [{ id: 'old-square', type: 'square', polygon: [[0, 0], [1, 0], [1, 1]] }],
  };
  const { features } = generate([
    { kind: 'square', id: 'old-square', at: [0, 0], size: [5, 5] },
    { kind: 'square', id: 'new-square', at: [200, 200], size: [40, 20] },
  ], { locked });
  assert.deepEqual(features.map((f) => f.id), ['old-square', 'new-square']);
  assert.deepEqual(features[0].polygon, [[0, 0], [1, 0], [1, 1]]);
});

test('the same input gives the same output', () => {
  const constraints = [
    { kind: 'street', id: 'road', rank: 'main', path: [[100, 400], [700, 400]] },
    { kind: 'grid', id: 'g', area: AREA, spacing: 70, jitter: 0.4 },
  ];
  assert.deepEqual(generate(constraints, { layers: { ground: water(RIVER) } }), generate(constraints, { layers: { ground: water(RIVER) } }));
});

test('bad street constraints give a bad-constraint problem and no feature', () => {
  const { features, problems } = generate([
    { kind: 'street', id: 'no-rank', path: [[0, 0], [10, 0]] },
    { kind: 'street', id: 'one-point', rank: 'lane', path: [[0, 0]] },
    { kind: 'square', id: 'flat', at: [0, 0], size: [0, 4] },
    { kind: 'grid', id: 'small', area: [[0, 0], [10, 0]], spacing: 5 },
    { kind: 'grid', id: 'main-grid', area: AREA, spacing: 50, rank: 'main' },
    { kind: 'grid', id: 'loose', area: AREA, spacing: 50, jitter: 2 },
  ]);
  assert.equal(features.length, 0);
  assert.deepEqual(problems.map((p) => p.code), Array(6).fill('bad-constraint'));
  assert.equal(problems[0].file, 'streets.json');
  assert.equal(problems[0].path, 'constraints[0]');
});
