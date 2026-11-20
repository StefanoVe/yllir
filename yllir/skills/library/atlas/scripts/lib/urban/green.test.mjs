import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateGreen } from './green.mjs';
import { generateGround } from './ground.mjs';
import { pointInPolygon } from '../geometry.mjs';

const CANVAS = { width: 2400, height: 1800 };
const generate = (constraints, extra = {}) => generateGreen({ canvas: CANVAS, seed: 11, constraints, ...extra });

const insideCanvas = (polygon) => polygon.every(([x, y]) => x >= 0 && x <= CANVAS.width && y >= 0 && y <= CANVAS.height);

const PARK = { kind: 'park', id: 'city-park', type: 'park', at: [1200, 900], radius: 150, provenance: 'master', sources: [] };

// A lake that covers the west edge of the park's area, so the park has to be pulled out of it.
const LAKE = { kind: 'pond', id: 'west-lake', at: [1000, 900], radius: 120, provenance: 'master', sources: [] };
// A lake whose centre is the park centre of the drop test: every point stays in water.
const CENTRE_LAKE = { kind: 'pond', id: 'centre-lake', at: [100, 900], radius: 120, provenance: 'master', sources: [] };

const groundWith = (constraints) => generateGround({ canvas: CANVAS, seed: 3, constraints }).features;
const waterPolygons = (features) => features.filter((f) => f.type === 'water').map((f) => f.polygon);

test('same input gives the same output', () => {
  const layers = { ground: { features: groundWith([LAKE]) } };
  assert.deepEqual(generate([PARK], { layers }), generate([PARK], { layers }));
});

test('each park type gives a green feature with that type', () => {
  for (const type of ['park', 'garden', 'field', 'wood', 'orchard']) {
    const { features, problems } = generate([{ ...PARK, type }]);
    assert.deepEqual(problems, []);
    assert.equal(features[0].type, type);
    assert.equal(features[0].id, 'city-park');
    assert.ok(features[0].polygon.length >= 3);
  }
});

test('an unknown park type gives a bad-constraint problem', () => {
  const { features, problems } = generate([{ ...PARK, type: 'jungle' }]);
  assert.deepEqual(features, []);
  assert.equal(problems[0].code, 'bad-constraint');
  assert.equal(problems[0].file, 'green.json');
  assert.equal(problems[0].path, 'constraints[0]');
});

test('a park near the canvas edge stays inside the canvas', () => {
  const { features } = generate([{ ...PARK, at: [10, 10], radius: 200 }]);
  assert.ok(insideCanvas(features[0].polygon));
});

test('green avoids water: no vertex of a park lies in a water polygon', () => {
  const layers = { ground: { features: groundWith([LAKE]) } };
  const { features, problems } = generate([PARK], { layers });
  assert.deepEqual(problems, []);
  assert.ok(features[0].polygon.length >= 3);
  for (const point of features[0].polygon) {
    assert.ok(!waterPolygons(layers.ground.features).some((polygon) => pointInPolygon(point, polygon)), `point ${point} is in water`);
  }
});

test('points pulled out of water move toward the park centre', () => {
  const layers = { ground: { features: groundWith([LAKE]) } };
  const dry = generate([PARK], { layers }).features[0].polygon;
  const plain = generate([PARK]).features[0].polygon;
  assert.notDeepEqual(dry, plain);
  const westmost = (polygon) => Math.min(...polygon.map((p) => p[0]));
  assert.ok(westmost(dry) > westmost(plain), 'the wet western points moved east, toward the centre');
});

test('a park whose points all stay in water gives a problem and no feature', () => {
  // The centre is inside the lake, so every pulled point stays in the water and is dropped.
  const layers = { ground: { features: groundWith([CENTRE_LAKE]) } };
  const { features, problems } = generate([{ ...PARK, at: [100, 900], radius: 50 }], { layers });
  assert.deepEqual(features, []);
  assert.equal(problems[0].code, 'bad-constraint');
  assert.equal(problems[0].path, 'constraints[0]');
});

test('constraints of other kinds are ignored', () => {
  assert.deepEqual(generate([LAKE]), { features: [], problems: [] });
});

test('adding a park does not change the others', () => {
  const alone = generate([PARK]).features[0];
  const other = { ...PARK, id: 'the-wood', type: 'wood', at: [400, 400], radius: 90 };
  assert.deepEqual(generate([PARK, other]).features[0], alone);
});

test('a locked layer keeps its features and only parks after constraintCount add features', () => {
  const locked = {
    constraintCount: 1,
    features: [{ id: 'city-park', type: 'park', polygon: [[0, 0], [5, 0], [5, 5]], provenance: 'master', visibility: 'public', sources: [] }],
  };
  const { features, problems } = generate([{ ...PARK, radius: 400 }, { ...PARK, id: 'the-garden', type: 'garden', at: [600, 600], radius: 80 }], { locked });
  assert.deepEqual(problems, []);
  assert.deepEqual(features[0], locked.features[0]);
  assert.deepEqual(features.map((f) => f.id), ['city-park', 'the-garden']);
});

test('provenance and visibility are copied, and a document without sources becomes agent-choice', () => {
  const { features } = generate([
    { ...PARK, provenance: 'document', sources: [] },
    { ...PARK, id: 'the-wood', type: 'wood', at: [600, 600], radius: 80, provenance: 'document', sources: [{ file: 'map.md' }], visibility: 'master' },
  ]);
  assert.equal(features[0].provenance, 'agent-choice');
  assert.equal(features[0].visibility, 'public');
  assert.equal(features[1].provenance, 'document');
  assert.equal(features[1].visibility, 'master');
  assert.deepEqual(features[1].sources, [{ file: 'map.md' }]);
});
