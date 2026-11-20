import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBlocks } from './blocks.mjs';
import { bufferPath, rectsOverlap } from './shapes.mjs';
import { pointInPolygon } from '../geometry.mjs';

const CANVAS = { width: 400, height: 300 };
const RIVER_PATH = [[0, 240], [200, 220], [400, 250]];
const MAIN_PATH = [[40, 60], [360, 60]];
const RING = [[20, 20], [380, 20], [380, 280], [20, 280]];

const water = (polygon) => ({ id: 'river', type: 'water', kind: 'river', polygon, provenance: 'agent-choice', visibility: 'public', sources: [] });
const streetFeatures = () => [{ id: 'main', type: 'street', rank: 'main', width: 14, path: MAIN_PATH }];
const wallFeatures = () => [{ id: 'wall', type: 'wall', path: [...RING, RING[0]], closed: true, thickness: 4 }];

/** The standard test layers: a river, one main street and a closed wall. */
function standardLayers() {
  return {
    ground: [water(bufferPath(RIVER_PATH, 24))],
    green: [],
    walls: wallFeatures(),
    streets: streetFeatures(),
  };
}

const generate = (constraints = [{ kind: 'fill', id: 'town' }], layers = standardLayers(), canvas = CANVAS) =>
  generateBlocks({ canvas, seed: 7, constraints, layers });

/** Points of a polygon and the midpoints of its edges. */
function samplesOf(polygon) {
  return polygon.flatMap((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]];
  });
}

/** Distance from a point to the boundary of a polygon's edges. */
function distanceToEdges(p, polygon) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return best;
}

test('blocks exist and none reaches the water, the street or the wall', () => {
  const { features, problems } = generate();
  assert.deepEqual(problems, []);
  assert.ok(features.length > 0);
  const layers = standardLayers();
  const waterPolygon = layers.ground[0].polygon;
  const streetBand = bufferPath(MAIN_PATH, 14);
  const ring = [...RING];
  for (const block of features) {
    assert.equal(block.type, 'block');
    for (const p of samplesOf(block.polygon)) {
      // The contour sits up to about 2 units from the last free cell centre (grid precision).
      if (pointInPolygon(p, waterPolygon)) {
        assert.ok(distanceToEdges(p, waterPolygon) <= 2.5, `block ${block.id} runs into the water at ${p}`);
      }
      assert.ok(!pointInPolygon(p, streetBand), `block ${block.id} touches the street at ${p}`);
      assert.ok(pointInPolygon(p, ring), `block ${block.id} lies outside the wall at ${p}`);
    }
  }
});

test('lots lie inside their block, do not overlap and have the sizes of their character', () => {
  const { features } = generate();
  const all = [];
  for (const block of features) {
    for (const lot of block.lots) {
      assert.ok(pointInPolygon(lot.at, block.polygon), `lot of ${block.id} outside its block`);
      assert.ok(['house', 'rowhouse', 'shop', 'barn'].includes(lot.kind));
      assert.ok(lot.size[0] >= 8 && lot.size[0] <= 12 && lot.size[1] >= 7 && lot.size[1] <= 10);
      all.push({ block: block.id, at: lot.at, size: lot.size, angle: lot.angle });
    }
    for (let i = 0; i < block.lots.length; i++) {
      for (let j = i + 1; j < block.lots.length; j++) {
        assert.ok(!rectsOverlap(block.lots[i], block.lots[j]), `lots overlap in ${block.id}`);
      }
    }
  }
  assert.ok(all.length > 0);
});

test('the same input gives the same blocks', () => {
  assert.deepEqual(generate(), generate());
  const other = generateBlocks({ canvas: CANVAS, seed: 8, constraints: [{ kind: 'fill' }], layers: standardLayers() });
  assert.notDeepEqual(other.features.map((f) => f.lots), generate().features.map((f) => f.lots));
});

test('block ids are numbered by position and carry the fill character', () => {
  const { features } = generate([{ kind: 'fill', id: 'town', character: 'rich' }]);
  assert.deepEqual(features.map((f) => f.id), features.map((_, i) => `block-${i + 1}`));
  const tops = features.map((f) => Math.min(...f.polygon.map((p) => p[1])));
  assert.deepEqual(tops, [...tops].sort((a, b) => a - b));
  assert.ok(features.every((f) => f.character === 'rich'));
});

test('no fill constraint gives common blocks', () => {
  const { features } = generateBlocks({ canvas: CANVAS, seed: 7, constraints: [], layers: standardLayers() });
  assert.ok(features.length > 0);
  assert.ok(features.every((f) => f.character === 'common'));
});

test('character changes lot sizes and density', () => {
  const poor = generate([{ kind: 'fill', id: 'town', character: 'poor' }]).features;
  const rich = generate([{ kind: 'fill', id: 'town', character: 'rich' }]).features;
  const lotsOf = (blocks) => blocks.flatMap((b) => b.lots);
  const poorLots = lotsOf(poor);
  const richLots = lotsOf(rich);
  assert.ok(poorLots.every((l) => l.size[0] >= 6 && l.size[0] <= 9 && l.size[1] >= 5 && l.size[1] <= 8));
  assert.ok(richLots.every((l) => l.size[0] >= 11 && l.size[0] <= 16 && l.size[1] >= 9 && l.size[1] <= 13));
  assert.ok(richLots.length < poorLots.length);
});

test('an area-limited fill only fills its area, and a fill without area covers the rest', () => {
  const west = [[0, 0], [200, 0], [200, 300], [0, 300]];
  const { features, problems } = generate([
    { kind: 'fill', id: 'old-town', area: west, character: 'rich' },
    { kind: 'fill', id: 'outskirts', character: 'poor' },
  ]);
  assert.deepEqual(problems, []);
  assert.ok(features.some((f) => f.character === 'rich'));
  assert.ok(features.some((f) => f.character === 'poor'));
  for (const block of features) {
    const xs = block.polygon.map((p) => p[0]);
    if (block.character === 'rich') assert.ok(Math.max(...xs) <= 202.5, `${block.id} leaves the area`);
    else assert.ok(Math.min(...xs) >= 197.5, `${block.id} enters the area`);
  }
});

test('an area-limited fill alone leaves the rest of the canvas without blocks', () => {
  const west = [[0, 0], [100, 0], [100, 300], [0, 300]];
  const { features } = generate([{ kind: 'fill', id: 'corner', area: west }]);
  assert.ok(features.length > 0);
  assert.ok(features.every((f) => f.polygon.every((p) => p[0] <= 102.5)));
});

test('a green park covering the canvas gives no blocks and the no-blocks problem', () => {
  const layers = { ...standardLayers(), green: [{ id: 'all', type: 'park', polygon: [[0, 0], [400, 0], [400, 300], [0, 300]] }] };
  const { features, problems } = generate([{ kind: 'fill', id: 'town' }], layers);
  assert.deepEqual(features, []);
  assert.deepEqual(problems, [{ code: 'no-blocks', file: 'blocks.json', path: '', message: problems[0].message }]);
});

// A big block: the ring of wall above, with no river and no street inside it (360 x 260 units).
const BIG_CANVAS = { width: 400, height: 300 };
const bigLayers = () => ({ ground: [], green: [], streets: [], walls: wallFeatures() });
const bigBlocks = (character) => generateBlocks({
  canvas: BIG_CANVAS, seed: 7, constraints: [{ kind: 'fill', id: 'town', character }], layers: bigLayers(),
}).features;

test('a big block gets lots inside, not only along its border ring', () => {
  const [block] = bigBlocks('common');
  const lots = block.lots;
  const ringLimit = 3 + 10; // inset of the ring plus the deepest common lot
  const interior = lots.filter((l) => distanceToEdges(l.at, block.polygon) > ringLimit);
  assert.ok(interior.length > 20, `only ${interior.length} lots inside the ring`);
  assert.ok(lots.length > 200, `only ${lots.length} lots in a big block`);
  assert.ok(lots.length <= 400, 'the cap of 400 lots per block is kept');
});

test('inner lots keep the same rules: inside the block, sized by character, no overlap', () => {
  for (const character of ['poor', 'common', 'rich']) {
    const [block] = bigBlocks(character);
    const sizes = CHARACTERS_SIZES[character];
    for (const lot of block.lots) {
      assert.ok(pointInPolygon(lot.at, block.polygon), `${character} lot outside its block`);
      assert.ok(lot.size[0] >= sizes.width[0] && lot.size[0] <= sizes.width[1], `${character} width ${lot.size[0]}`);
      assert.ok(lot.size[1] >= sizes.depth[0] && lot.size[1] <= sizes.depth[1], `${character} depth ${lot.size[1]}`);
    }
    for (let i = 0; i < block.lots.length; i++) {
      for (let j = i + 1; j < block.lots.length; j++) {
        assert.ok(!rectsOverlap(block.lots[i], block.lots[j]), `${character} lots ${i} and ${j} overlap`);
      }
    }
  }
});

test('rich blocks keep gardens: fewer lots than common blocks of the same size', () => {
  const common = bigBlocks('common')[0].lots.length;
  const rich = bigBlocks('rich')[0].lots.length;
  assert.ok(rich < common, `rich ${rich} is not sparser than common ${common}`);
  assert.ok(rich > 0);
});

const CHARACTERS_SIZES = {
  poor: { width: [6, 9], depth: [5, 8] },
  common: { width: [8, 12], depth: [7, 10] },
  rich: { width: [11, 16], depth: [9, 13] },
};
