import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTerrain, withTerrain } from './synthetic-terrain.mjs';

const canvas = { width: 2400, height: 1800 };
const shown = { provenance: 'master', visibility: 'public', sources: [{ title: 'map' }] };
const ring = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const groundOf = (features) => ({ layer: 'ground', constraints: [], features });

test('no ground: the land is the whole canvas, one land feature and no lakes', () => {
  const terrain = syntheticTerrain({ canvas, layers: {} });
  assert.deepEqual(terrain, {
    layer: 'terrain',
    constraints: [],
    features: [{
      id: 'land-1',
      type: 'land',
      polygon: [[0, 0], [2400, 0], [2400, 1800], [0, 1800]],
      provenance: 'agent-choice',
      visibility: 'public',
      sources: [],
    }],
  });
  // A ground layer with only a coast (no island) still gives the whole canvas as land.
  const coast = { id: 'harbour', type: 'water', kind: 'coast', polygon: ring(0, 0, 300, 1800), provenance: 'master', visibility: 'public', sources: [] };
  assert.deepEqual(syntheticTerrain({ canvas, layers: { ground: groundOf([coast]) } }).features.map((f) => f.type), ['land']);
});

test('an island in ground is the land: a copy of its polygon, with the land id and fixed meta', () => {
  const island = { id: 'isle', type: 'land', kind: 'island', polygon: [[800, 500], [1500, 500], [1500, 1200]], provenance: 'master', visibility: 'master', sources: [{ title: 'x' }] };
  const layers = { ground: groundOf([island]) };
  const terrain = syntheticTerrain({ canvas, layers });
  assert.equal(terrain.features[0].id, 'land-1');
  assert.deepEqual(terrain.features[0].polygon, island.polygon);
  assert.notEqual(terrain.features[0].polygon, island.polygon, 'the polygon is copied, not shared');
  assert.deepEqual(
    { provenance: terrain.features[0].provenance, visibility: terrain.features[0].visibility, sources: terrain.features[0].sources },
    { provenance: 'agent-choice', visibility: 'public', sources: [] },
  );
  terrain.features[0].polygon[0][0] = -1;
  assert.equal(island.polygon[0][0], 800, 'changing the terrain does not change the ground');
});

test('river, canal and pond of ground become lakes; sea pieces and coast do not', () => {
  const river = { id: 'river-main', type: 'water', kind: 'river', polygon: ring(0, 900, 2400, 960), ...shown };
  const canal = { id: 'canal-east', type: 'water', kind: 'canal', polygon: ring(1000, 100, 1100, 400), provenance: 'agent-choice', visibility: 'public', sources: [] };
  const pond = { id: 'mill-pond', type: 'water', kind: 'pond', polygon: ring(1200, 400, 1300, 500), provenance: 'document', visibility: 'master', sources: [{ title: 'book' }] };
  const seaPiece = { id: 'isle-sea-ne', type: 'water', kind: 'sea', polygon: ring(1500, 0, 2400, 500), provenance: 'master', visibility: 'public', sources: [] };
  const coast = { id: 'harbour', type: 'water', kind: 'coast', polygon: ring(0, 0, 300, 1800), provenance: 'master', visibility: 'public', sources: [] };
  const terrain = syntheticTerrain({ canvas, layers: { ground: groundOf([river, canal, pond, seaPiece, coast]) } });
  const lakes = terrain.features.filter((f) => f.type === 'lake');
  assert.deepEqual(lakes.map((f) => f.id), ['river-main', 'canal-east', 'mill-pond']);
  assert.deepEqual(lakes[0].polygon, river.polygon);
  assert.deepEqual(
    { provenance: lakes[2].provenance, visibility: lakes[2].visibility, sources: lakes[2].sources },
    { provenance: 'document', visibility: 'master', sources: [{ title: 'book' }] },
  );
  assert.equal(terrain.features.length, 4, 'one land and three lakes');
});

test('withTerrain: a terrain layer with land is kept as it is (the same object)', () => {
  const layers = {
    terrain: { layer: 'terrain', constraints: [], features: [{ id: 'land-main', type: 'land', polygon: ring(0, 0, 10, 10), provenance: 'master', visibility: 'public', sources: [] }] },
    ground: groundOf([]),
  };
  assert.equal(withTerrain(layers, canvas), layers);
});

test('withTerrain: without terrain, or with terrain that has no land, the synthetic terrain is added and the input stays unchanged', () => {
  const river = { id: 'river-main', type: 'water', kind: 'river', polygon: ring(0, 900, 2400, 960), ...shown };
  const layers = { ground: groundOf([river]) };
  const added = withTerrain(layers, canvas);
  assert.notEqual(added, layers);
  assert.equal(added.ground, layers.ground);
  assert.equal(added.terrain.features.map((f) => f.type).join(), 'land,lake');
  assert.equal(layers.terrain, undefined, 'the input is not modified');

  const lakeOnly = { terrain: { layer: 'terrain', constraints: [], features: [{ id: 'l', type: 'lake', polygon: ring(0, 0, 5, 5) }] } };
  const replaced = withTerrain(lakeOnly, canvas);
  assert.deepEqual(replaced.terrain.features.map((f) => f.type), ['land']);
  assert.equal(replaced.terrain.features[0].polygon[2][0], 2400);
});
