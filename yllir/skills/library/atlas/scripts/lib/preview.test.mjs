import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pngSize } from '../../../../../scripts/lib/png.mjs';
import { renderPreview } from './preview.mjs';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test('renderPreview gives a PNG whose size follows the canvas and the requested width', () => {
  const canvas = { width: 2000, height: 1000 };
  const layers = {
    terrain: {
      features: [
        { id: 'land-1', type: 'land', polygon: [[400, 300], [1600, 300], [1600, 700], [400, 700]] },
        { id: 'lake-1', type: 'lake', polygon: [[900, 450], [1100, 450], [1100, 550], [900, 550]] },
      ],
    },
    biomes: { features: [{ id: 'forest-1', type: 'forest', polygon: [[450, 350], [700, 350], [700, 500], [450, 500]] }] },
    water: { features: [{ id: 'river-1', type: 'river', path: [[0, 500], [2000, 520]] }] },
    places: { features: [{ id: 'north', place: 'north', at: [1000, 400], icon: 'town' }] },
  };
  const png = renderPreview({ canvas, layers, width: 1024 });
  assert.deepEqual([...png.subarray(0, 8)], SIGNATURE);
  assert.deepEqual(pngSize(png), { width: 1024, height: 512 });
});

test('renderPreview works with no layers at all', () => {
  const png = renderPreview({ canvas: { width: 1000, height: 500 }, layers: {}, width: 256 });
  assert.deepEqual(pngSize(png), { width: 256, height: 128 });
});

test('realm borders and routes change the drawing and keep the size', () => {
  const canvas = { width: 1000, height: 1000 };
  const base = {
    terrain: { features: [{ id: 'land-1', type: 'land', polygon: [[100, 100], [900, 100], [900, 900], [100, 900]] }] },
  };
  const plain = renderPreview({ canvas, layers: base, width: 512 });
  const drawn = renderPreview({
    canvas,
    width: 512,
    layers: {
      ...base,
      political: { features: [{ id: 'north', type: 'realm', color: '#aa3322', seeds: [[300, 300]], polygons: [[[100, 100], [500, 100], [500, 900], [100, 900]]] }] },
      routes: { features: [
        { id: 'road-ab', type: 'road', path: [[150, 150], [850, 850]] },
        { id: 'trail-ab', type: 'trail', path: [[150, 850], [850, 150]] },
        { id: 'sea-ab', type: 'sea-route', path: [[50, 50], [950, 50]] },
      ] },
    },
  });
  assert.deepEqual(pngSize(drawn), pngSize(plain));
  assert.notDeepEqual(drawn, plain);
});

test('an urban layer set gives a PNG of the canvas, and buildings change the drawing', () => {
  const canvas = { width: 2400, height: 1800 };
  const base = {
    ground: { features: [{ id: 'harbour', type: 'water', kind: 'coast', polygon: [[0, 1500], [2400, 1500], [2400, 1800], [0, 1800]] }] },
    streets: { features: [{ id: 'high', type: 'street', rank: 'main', width: 14, path: [[200, 400], [2200, 420]] }] },
    blocks: { features: [{ id: 'block-1', type: 'block', polygon: [[200, 500], [1000, 500], [1000, 1000], [200, 1000]], lots: [{ kind: 'house', at: [300, 600], size: [10, 8] }] }] },
  };
  const plain = renderPreview({ canvas, layers: base, width: 600 });
  assert.deepEqual([...plain.subarray(0, 8)], SIGNATURE);
  assert.deepEqual(pngSize(plain), { width: 600, height: 450 });
  const built = renderPreview({
    canvas,
    width: 600,
    layers: {
      ...base,
      walls: { features: [{ id: 'wall', type: 'wall', path: [[100, 100], [2300, 100], [2300, 1700], [100, 1700]], closed: true, thickness: 12 }] },
      buildings: { features: [{ id: 'hall', place: 'hall', at: [600, 800], kind: 'tavern' }] },
    },
  });
  assert.deepEqual(pngSize(built), { width: 600, height: 450 });
  assert.notDeepEqual(built, plain);
});

test('an urban layer set with only a district still takes the urban branch', () => {
  const png = renderPreview({
    canvas: { width: 1000, height: 1000 },
    width: 200,
    layers: { districts: { features: [{ id: 'docks', type: 'district', color: '#8844aa', polygon: [[100, 100], [900, 100], [900, 900]] }] } },
  });
  assert.deepEqual([...png.subarray(0, 8)], SIGNATURE);
  assert.deepEqual(pngSize(png), { width: 200, height: 200 });
});
