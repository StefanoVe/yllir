import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointInPolygon } from '../geometry.mjs';
import { generateDistricts } from './districts.mjs';

const canvas = { width: 1000, height: 1000 };
const sq = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const district = (id, seeds, extra = {}) => ({ kind: 'district', id, color: '#336699', seeds, ...extra });

// A walled city: closed ring from (200, 200) to (800, 800).
const walls = { features: [{ id: 'city-wall', type: 'wall', path: sq(200, 200, 800, 800), closed: true, thickness: 4 }] };
// A river across the whole canvas, from x 0 to 1000, between y 480 and 520.
const ground = { features: [{ id: 'river', type: 'water', kind: 'river', polygon: sq(0, 480, 1000, 520) }] };

const allVertices = (features) => features.flatMap((f) => (f.polygons ?? [f.polygon]).flat());

test('two districts split a walled city: both are inside the walls and lie on opposite sides', () => {
  const { features, problems } = generateDistricts({
    canvas,
    seed: 1,
    constraints: [district('north', [[500, 300]]), district('south', [[500, 700]])],
    layers: { walls },
  });
  assert.deepEqual(problems, []);
  assert.equal(features.length, 2);
  const tolerance = 8;
  for (const v of allVertices(features)) {
    assert.ok(v[0] >= 200 - tolerance && v[0] <= 800 + tolerance, `x ${v[0]} outside the walls`);
    assert.ok(v[1] >= 200 - tolerance && v[1] <= 800 + tolerance, `y ${v[1]} outside the walls`);
  }
  const [a, b] = features;
  const minY = (f) => Math.min(...(f.polygons ?? [f.polygon]).flat().map((p) => p[1]));
  const maxY = (f) => Math.max(...(f.polygons ?? [f.polygon]).flat().map((p) => p[1]));
  assert.ok(maxY(a) <= 500 + tolerance, 'north district stays north of the split');
  assert.ok(minY(b) >= 500 - tolerance, 'south district stays south of the split');
});

test('no district vertex lies in the river', () => {
  const { features } = generateDistricts({
    canvas,
    seed: 2,
    constraints: [district('north', [[300, 250]]), district('south', [[300, 750]])],
    layers: { ground },
  });
  assert.equal(features.length, 2);
  const river = ground.features[0].polygon;
  for (const v of allVertices(features)) {
    assert.equal(pointInPolygon(v, river), false, `vertex ${v} lies in the river`);
  }
});

test('features have type district, keep the constraint fields and copy the character', () => {
  const { features } = generateDistricts({
    canvas,
    seed: 3,
    constraints: [
      district('market', [[400, 400]], { character: 'rich', place: 'market-square', provenance: 'master' }),
      district('docks', [[700, 700]], { character: 'poor', name: 'The Docks' }),
    ],
    layers: { walls },
  });
  assert.equal(features.length, 2);
  for (const f of features) assert.equal(f.type, 'district');
  const market = features.find((f) => f.id === 'market');
  const docks = features.find((f) => f.id === 'docks');
  assert.equal(market.character, 'rich');
  assert.equal(market.place, 'market-square');
  assert.equal(market.provenance, 'master');
  assert.equal(market.color, '#336699');
  assert.deepEqual(market.seeds, [[400, 400]]);
  assert.equal(docks.character, 'poor');
  assert.equal(docks.name, 'The Docks');
});

test('same input and seed give the same output', () => {
  const input = {
    canvas,
    seed: 4,
    constraints: [district('north', [[300, 250]]), district('south', [[300, 750]])],
    layers: { walls, ground },
  };
  assert.deepEqual(generateDistricts(input), generateDistricts(input));
});

test('locked districts are kept unchanged and the new districts avoid their land', () => {
  const lockedDistrict = {
    id: 'old-district',
    type: 'district',
    polygons: [sq(100, 100, 400, 400)],
    color: '#112233',
    seeds: [[200, 200]],
    character: 'rich',
    provenance: 'master',
    visibility: 'public',
    sources: [],
  };
  const { features, problems } = generateDistricts({
    canvas,
    seed: 5,
    constraints: [district('old-district', [[200, 200]], { character: 'rich' }), district('new-district', [[700, 700]], { character: 'poor' })],
    layers: {},
    locked: { constraintCount: 1, features: [lockedDistrict] },
  });
  assert.deepEqual(problems, []);
  const kept = features.find((f) => f.id === 'old-district');
  assert.deepEqual(kept, lockedDistrict);
  const created = features.find((f) => f.id === 'new-district');
  assert.equal(created.type, 'district');
  assert.equal(created.character, 'poor');
  for (const v of allVertices([created])) {
    assert.equal(pointInPolygon(v, lockedDistrict.polygons[0]), false, `vertex ${v} lies in the locked district`);
  }
});
