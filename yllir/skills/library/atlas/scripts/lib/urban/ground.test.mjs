import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateGround } from './ground.mjs';
import { pointInPolygon } from '../geometry.mjs';
import { polygonArea } from './shapes.mjs';

const CANVAS = { width: 2400, height: 1800 };
const generate = (constraints, extra = {}) => generateGround({ canvas: CANVAS, seed: 7, constraints, ...extra });

const insideCanvas = (polygon) => polygon.every(([x, y]) => x >= 0 && x <= CANVAS.width && y >= 0 && y <= CANVAS.height);

const RIVER = {
  kind: 'river', id: 'the-river', source: [0, 300], via: [[800, 500]], mouth: [2400, 1200], width: 60,
  provenance: 'master', sources: [],
};
const COAST = { kind: 'coast', id: 'north-sea', side: 'north', depth: 200, provenance: 'master', sources: [] };
const POND = { kind: 'pond', id: 'mill-pond', at: [600, 900], radius: 120, provenance: 'master', sources: [] };
const CANAL = { kind: 'canal', id: 'market-canal', path: [[100, 100], [1000, 100]], width: 40, provenance: 'master', sources: [] };

test('same input gives the same output', () => {
  const constraints = [RIVER, COAST, POND, CANAL];
  assert.deepEqual(generate(constraints), generate(constraints));
});

test('the seed changes the noisy shapes but not the kind or the id of each feature', () => {
  const a = generateGround({ canvas: CANVAS, seed: 1, constraints: [POND] }).features[0];
  const b = generateGround({ canvas: CANVAS, seed: 2, constraints: [POND] }).features[0];
  assert.notDeepEqual(a.polygon, b.polygon);
  assert.equal(a.id, b.id);
  assert.equal(a.kind, b.kind);
});

test('each kind gives one water feature with its kind, inside the canvas', () => {
  const { features, problems } = generate([RIVER, COAST, POND, CANAL]);
  assert.deepEqual(problems, []);
  assert.deepEqual(features.map((f) => [f.id, f.type, f.kind]), [
    ['the-river', 'water', 'river'],
    ['north-sea', 'water', 'coast'],
    ['mill-pond', 'water', 'pond'],
    ['market-canal', 'water', 'canal'],
  ]);
  for (const feature of features) {
    assert.ok(feature.polygon.length >= 3);
    assert.ok(insideCanvas(feature.polygon), `${feature.id} leaves the canvas`);
    assert.ok(polygonArea(feature.polygon) >= 100);
  }
});

test('the river follows its path and is as wide as requested', () => {
  const { features } = generate([{ ...RIVER, meander: 0 }]);
  const polygon = features[0].polygon;
  assert.ok(pointInPolygon([400, 400], polygon));
  assert.ok(!pointInPolygon([400, 1500], polygon));
});

test('river meander changes the course, and the default is 0.3', () => {
  const straight = generate([{ ...RIVER, meander: 0 }]).features[0].polygon;
  const curvy = generate([{ ...RIVER, meander: 1 }]).features[0].polygon;
  const byDefault = generate([RIVER]).features[0].polygon;
  const explicit = generate([{ ...RIVER, meander: 0.3 }]).features[0].polygon;
  assert.notDeepEqual(straight, curvy);
  assert.deepEqual(byDefault, explicit);
});

test('a river running off the canvas is clipped to it', () => {
  const { features, problems } = generate([{ ...RIVER, source: [-500, 300], via: [[-300, 900]], mouth: [3000, 1500] }]);
  assert.deepEqual(problems, []);
  assert.ok(insideCanvas(features[0].polygon));
});

test('a coast covers the north edge down to its depth', () => {
  const { features } = generate([{ ...COAST, roughness: 0 }]);
  const polygon = features[0].polygon;
  assert.ok(pointInPolygon([1200, 10], polygon));
  assert.ok(pointInPolygon([300, 120], polygon));
  assert.ok(!pointInPolygon([1200, 900], polygon));
  assert.ok(insideCanvas(polygon));
});

test('a coast on the east side stays along that edge', () => {
  const { features } = generate([{ kind: 'coast', id: 'east-bay', side: 'east', depth: 150, provenance: 'master', sources: [] }]);
  const polygon = features[0].polygon;
  assert.ok(pointInPolygon([CANVAS.width - 10, 900], polygon));
  assert.ok(!pointInPolygon([CANVAS.width - 400, 900], polygon));
});

test('a pond is a blob around its centre', () => {
  const { features } = generate([POND]);
  assert.ok(pointInPolygon([600, 900], features[0].polygon));
  assert.ok(!pointInPolygon([600, 1200], features[0].polygon));
});

test('a canal runs along its path', () => {
  const { features } = generate([CANAL]);
  assert.ok(pointInPolygon([500, 100], features[0].polygon));
  assert.ok(!pointInPolygon([500, 400], features[0].polygon));
});

test('a pond too small for the 100 square units gives a bad-constraint problem', () => {
  const { features, problems } = generate([{ ...POND, radius: 3 }]);
  assert.deepEqual(features, []);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, 'bad-constraint');
  assert.equal(problems[0].file, 'ground.json');
  assert.equal(problems[0].path, 'constraints[0]');
});

test('a canal with two equal points gives a bad-constraint problem', () => {
  const { features, problems } = generate([{ ...CANAL, path: [[10, 10], [10, 10]] }]);
  assert.deepEqual(features, []);
  assert.equal(problems[0].code, 'bad-constraint');
});

test('a river without a positive width gives a bad-constraint problem and the others are kept', () => {
  const { features, problems } = generate([{ ...RIVER, width: 0 }, POND]);
  assert.deepEqual(features.map((f) => f.id), ['mill-pond']);
  assert.equal(problems[0].path, 'constraints[0]');
});

test('a constraint with a bad id gives a problem', () => {
  const { features, problems } = generate([{ ...POND, id: 'Mill Pond' }]);
  assert.deepEqual(features, []);
  assert.equal(problems[0].code, 'bad-constraint');
});

test('constraints of other kinds are ignored', () => {
  assert.deepEqual(generate([{ kind: 'park', id: 'x', type: 'park', at: [1, 1], radius: 10 }]), { features: [], problems: [] });
});

test('adding a constraint does not change the others', () => {
  const alone = generate([POND]).features[0];
  const withMore = generate([POND, CANAL, COAST]).features[0];
  assert.deepEqual(alone, withMore);
});

test('a locked layer keeps its features and only constraints after constraintCount add features', () => {
  const locked = {
    constraintCount: 1,
    features: [{ id: 'mill-pond', type: 'water', kind: 'pond', polygon: [[0, 0], [5, 0], [5, 5]], provenance: 'master', visibility: 'public', sources: [] }],
  };
  const constraints = [{ ...POND, radius: 300 }, CANAL];
  const { features, problems } = generate(constraints, { locked });
  assert.deepEqual(problems, []);
  assert.deepEqual(features[0], locked.features[0]);
  assert.deepEqual(features.map((f) => f.id), ['mill-pond', 'market-canal']);
});

test('the locked output is the same as the unlocked one for the new constraints', () => {
  const unlocked = generate([POND, CANAL]).features;
  const locked = generate([POND, CANAL], { locked: { constraintCount: 1, features: [unlocked[0]] } }).features;
  assert.deepEqual(locked, unlocked);
});

test('provenance and visibility are copied; a document without sources becomes agent-choice', () => {
  const { features } = generate([
    { ...POND, provenance: 'document', sources: [] },
    { ...CANAL, provenance: 'document', sources: [{ file: 'notes.md' }], visibility: 'master' },
  ]);
  assert.equal(features[0].provenance, 'agent-choice');
  assert.equal(features[0].visibility, 'public');
  assert.equal(features[1].provenance, 'document');
  assert.equal(features[1].visibility, 'master');
  assert.deepEqual(features[1].sources, [{ file: 'notes.md' }]);
});
