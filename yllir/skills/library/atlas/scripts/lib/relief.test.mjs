import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from './geometry.mjs';
import { generateRelief } from './relief.mjs';
import { landMask } from './landmask.mjs';

const sq = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const canvas = { width: 1000, height: 1000 };
const layers = { terrain: { layer: 'terrain', features: [{ id: 'land-1', type: 'land', polygon: sq(100, 100, 900, 900) }] } };
const range = (extra = {}) => ({
  kind: 'range', id: 'peaks', type: 'mountains', spine: [[200, 500], [800, 500]], width: 120, ...extra,
});

test('a range across a landmass gives a mountains polygon fully on land', () => {
  const { features, problems } = generateRelief({ canvas, seed: 3, constraints: [range()], layers });
  assert.deepEqual(problems, []);
  assert.equal(features.length, 1);
  const feature = features[0];
  assert.equal(feature.id, 'peaks');
  assert.equal(feature.type, 'mountains');
  const mask = landMask({ canvas, terrain: layers.terrain });
  for (const [x, y] of feature.polygon) assert.ok(mask.isLand(x, y), `vertex ${x},${y} is on land`);
});

test('a range entirely at sea gives range-not-on-land', () => {
  const sea = range({ spine: [[20, 20], [60, 20]], width: 30 });
  const { features, problems } = generateRelief({ canvas, seed: 3, constraints: [sea], layers });
  assert.deepEqual(features, []);
  assert.deepEqual(problems.map((p) => p.code), ['range-not-on-land']);
});

test('no terrain land gives missing-prerequisite', () => {
  const { problems } = generateRelief({ canvas, seed: 3, constraints: [range()], layers: {} });
  assert.deepEqual(problems.map((p) => p.code), ['missing-prerequisite']);
});

test('the same input gives the same features; another seed changes them', () => {
  const a = generateRelief({ canvas, seed: 3, constraints: [range()], layers });
  const b = generateRelief({ canvas, seed: 3, constraints: [range()], layers });
  assert.equal(canonicalJson(a.features), canonicalJson(b.features));
  const c = generateRelief({ canvas, seed: 4, constraints: [range()], layers });
  assert.notEqual(canonicalJson(a.features), canonicalJson(c.features));
});

test('after a lock only the appended range is generated; the locked one is unchanged', () => {
  const first = generateRelief({ canvas, seed: 3, constraints: [range()], layers }).features;
  const second = range({ id: 'hills-east', type: 'hills', spine: [[600, 300], [800, 300]], width: 80 });
  const out = generateRelief({
    canvas,
    seed: 3,
    constraints: [range(), second],
    layers,
    locked: { features: first, constraintCount: 1 },
  });
  assert.equal(canonicalJson(out.features.slice(0, first.length)), canonicalJson(first));
  assert.ok(out.features.slice(first.length).every((f) => f.id.startsWith('hills-east')));
  assert.ok(out.features.length > first.length);
});

test('provenance and sources of the constraint are copied onto the feature', () => {
  const sourced = range({ provenance: 'document', sources: [{ file: 'World/North/North.md' }] });
  const { features } = generateRelief({ canvas, seed: 3, constraints: [sourced], layers });
  assert.equal(features[0].provenance, 'document');
  assert.deepEqual(features[0].sources, [{ file: 'World/North/North.md' }]);
  assert.equal(features[0].visibility, 'public');
});
