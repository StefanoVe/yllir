import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWalls } from './walls.mjs';

const CANVAS = { width: 2400, height: 1800 };
const SQUARE_RING = [[100, 100], [500, 100], [500, 500], [100, 500]];
const LINE = [[0, 0], [300, 0]];

const wall = (extra = {}) => ({ kind: 'wall', id: 'town-wall', thickness: 4, provenance: 'master', sources: [], ...extra });
const generate = (constraints, extra = {}) => generateWalls({ canvas: CANVAS, seed: 7, constraints, ...extra });
const towersOf = (features) => features.filter((f) => f.type === 'tower');
const gatesOf = (features) => features.filter((f) => f.type === 'gate');
const distanceToPath = (point, path) => {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)));
  }
  return best;
};

test('a ring becomes a closed wall whose path does not repeat the first point', () => {
  const { features, problems } = generate([wall({ ring: SQUARE_RING })]);
  assert.deepEqual(problems, []);
  const w = features.find((f) => f.type === 'wall');
  assert.equal(w.id, 'town-wall');
  assert.equal(w.closed, true);
  assert.equal(w.thickness, 4);
  assert.equal(w.path.length, 4);
  assert.deepEqual(w.path[0], [100, 100]);
  assert.equal(w.provenance, 'master');
});

test('a path becomes an open wall', () => {
  const { features } = generate([wall({ path: LINE })]);
  const w = features.find((f) => f.type === 'wall');
  assert.equal(w.closed, false);
  assert.deepEqual(w.path, LINE);
});

test('corners put one tower at each vertex, with radius thickness * 1.6', () => {
  const ring = generate([wall({ ring: SQUARE_RING })]);
  assert.equal(towersOf(ring.features).length, 4);
  assert.deepEqual(towersOf(ring.features)[0], {
    id: 'town-wall-tower-1', type: 'tower', at: [100, 100], radius: 6.4, provenance: 'master', visibility: 'public', sources: [],
  });
  const open = generate([wall({ path: [[0, 0], [100, 0], [200, 50]] })]);
  assert.equal(towersOf(open.features).length, 3);
});

test('no towers when towers is none, one per spacing along the path when spaced', () => {
  assert.equal(towersOf(generate([wall({ path: LINE, towers: 'none' })]).features).length, 0);
  const spaced = generate([wall({ path: LINE, towers: 'spaced', towerSpacing: 100 })]);
  const towers = towersOf(spaced.features);
  assert.deepEqual(towers.map((t) => t.at), [[0, 0], [100, 0], [200, 0], [300, 0]]);
  assert.deepEqual(towers.map((t) => t.id), ['town-wall-tower-1', 'town-wall-tower-2', 'town-wall-tower-3', 'town-wall-tower-4']);
});

test('spaced towers on a ring go around once and do not repeat the start', () => {
  // The ring is 4 x 400 = 1600 units long: towers at 0, 120, ..., 1560 (14 of them), none at 1600.
  const { features } = generate([wall({ ring: SQUARE_RING, towers: 'spaced', towerSpacing: 120 })]);
  const towers = towersOf(features);
  assert.equal(towers.length, 14);
  assert.deepEqual(towers[0].at, [100, 100]);
  const keys = new Set(towers.map((t) => t.at.join(',')));
  assert.equal(keys.size, towers.length, 'no two towers share a place');
});

test('a gate snaps onto the wall, takes the wall direction and defaults its width to thickness * 2.5', () => {
  const { features, problems } = generate([wall({ path: LINE, gates: [{ at: [50, 7] }] })]);
  assert.deepEqual(problems, []);
  const gates = gatesOf(features);
  assert.equal(gates.length, 1);
  assert.equal(gates[0].id, 'town-wall-gate-1');
  assert.deepEqual(gates[0].at, [50, 0]);
  assert.equal(gates[0].angle, 0);
  assert.equal(gates[0].width, 10);
  assert.ok(distanceToPath(gates[0].at, LINE) < 0.1, 'the gate stands on the wall');
});

test('every gate of a ring lies on the ring, and an explicit width is kept', () => {
  const { features } = generate([wall({ ring: SQUARE_RING, gates: [{ at: [300, 90], width: 12 }, { at: [90, 300] }] })]);
  const gates = gatesOf(features);
  assert.equal(gates.length, 2);
  const closed = [...SQUARE_RING, SQUARE_RING[0]];
  for (const gate of gates) assert.ok(distanceToPath(gate.at, closed) < 0.1);
  assert.deepEqual(gates[0].at, [300, 100]);
  assert.equal(gates[0].width, 12);
  assert.equal(gates[1].id, 'town-wall-gate-2');
});

test('locked walls keep their features and only new constraints add features', () => {
  const locked = {
    constraintCount: 1,
    features: [{ id: 'old-wall', type: 'wall', path: LINE, closed: false, thickness: 3 }],
  };
  const { features, problems } = generate([wall({ path: LINE }), wall({ id: 'new-wall', ring: SQUARE_RING })], { locked });
  assert.deepEqual(problems, []);
  assert.equal(features[0].id, 'old-wall');
  assert.deepEqual(features.filter((f) => f.type === 'wall').map((f) => f.id), ['old-wall', 'new-wall']);
});

test('the same input gives the same output', () => {
  const constraints = [wall({ ring: SQUARE_RING, towers: 'spaced', gates: [{ at: [300, 90] }] })];
  assert.deepEqual(generate(constraints), generate(constraints));
});

test('bad wall constraints give a bad-constraint problem and no feature', () => {
  const { features, problems } = generate([
    wall({ id: 'both', ring: SQUARE_RING, path: LINE }),
    wall({ id: 'thin', path: LINE, thickness: 0 }),
    wall({ id: 'towers', path: LINE, towers: 'many' }),
    wall({ id: 'gate', path: LINE, gates: [{}] }),
  ]);
  assert.equal(features.length, 0);
  assert.deepEqual(problems.map((p) => p.code), ['bad-constraint', 'bad-constraint', 'bad-constraint', 'bad-constraint']);
  assert.equal(problems[0].file, 'walls.json');
  assert.equal(problems[0].path, 'constraints[0]');
});
