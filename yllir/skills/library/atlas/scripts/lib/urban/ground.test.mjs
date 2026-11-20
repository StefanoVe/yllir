import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateGround } from './ground.mjs';
import { pointInPolygon } from '../geometry.mjs';
import { centroid, inAnyPolygon, polygonArea } from './shapes.mjs';
import { generateBlocks } from './blocks.mjs';
import { crossLayerProblems } from '../model.mjs';

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

const ISLAND = { kind: 'island', id: 'home-isle', at: [1200, 900], radius: [1000, 700], provenance: 'master', sources: [] };
const islandOf = (features) => features.find((f) => f.type === 'land');
const seasOf = (features) => features.filter((f) => f.kind === 'sea');
const CANVAS_AREA = CANVAS.width * CANVAS.height;

test('an island gives one land feature and four sea pieces, one per quadrant, with the island meta', () => {
  const { features, problems } = generate([ISLAND]);
  assert.deepEqual(problems, []);
  assert.deepEqual(features.map((f) => [f.id, f.type, f.kind]), [
    ['home-isle', 'land', 'island'],
    ['home-isle-sea-ne', 'water', 'sea'],
    ['home-isle-sea-se', 'water', 'sea'],
    ['home-isle-sea-sw', 'water', 'sea'],
    ['home-isle-sea-nw', 'water', 'sea'],
  ]);
  for (const f of features) {
    assert.deepEqual([f.provenance, f.visibility, f.sources], ['master', 'public', []]);
    assert.ok(insideCanvas(f.polygon));
  }
});

test('the island outline is closed, with 96 points and the four axis points present', () => {
  const land = islandOf(generate([ISLAND]).features);
  const [ax, ay] = ISLAND.at;
  assert.equal(land.polygon.length, 96);
  assert.deepEqual(land.polygon[0], [land.polygon[0][0], ay]); // east: same y as the centre
  assert.ok(land.polygon[0][0] > ax);
  assert.equal(land.polygon[24][0], ax); // south
  assert.ok(land.polygon[24][1] > ay);
  assert.equal(land.polygon[48][1], ay); // west
  assert.ok(land.polygon[48][0] < ax);
  assert.equal(land.polygon[72][0], ax); // north
  assert.ok(land.polygon[72][1] < ay);
});

test('the island and its four sea pieces cover the canvas: areas sum to the canvas within 1 percent', () => {
  const { features } = generate([ISLAND]);
  const total = features.reduce((sum, f) => sum + polygonArea(f.polygon), 0);
  assert.ok(Math.abs(total - CANVAS_AREA) / CANVAS_AREA < 0.01, `total ${total}`);
});

test('no sea piece contains the island centre', () => {
  const { features } = generate([ISLAND]);
  for (const sea of seasOf(features)) {
    assert.equal(pointInPolygon(ISLAND.at, sea.polygon), false);
  }
});

test('the island outline is the same for the same seed and changes with the seed', () => {
  const a = islandOf(generateGround({ canvas: CANVAS, seed: 1, constraints: [ISLAND] }).features);
  assert.deepEqual(a, islandOf(generateGround({ canvas: CANVAS, seed: 1, constraints: [ISLAND] }).features));
  const b = islandOf(generateGround({ canvas: CANVAS, seed: 2, constraints: [ISLAND] }).features);
  assert.notDeepEqual(a.polygon, b.polygon);
});

test('an island that leaves the canvas gives a problem and no feature', () => {
  const far = { ...ISLAND, at: [1200, 900], radius: [1400, 700] };
  const { features, problems } = generate([far]);
  assert.deepEqual(features, []);
  assert.deepEqual(problems, [{
    code: 'bad-constraint', file: 'ground.json', path: 'constraints[0]', message: 'the island must fit inside the canvas',
  }]);
});

test('a second island is a problem; the first one stays', () => {
  const second = { ...ISLAND, id: 'other-isle', at: [400, 400], radius: [200, 150] };
  const { features, problems } = generate([ISLAND, second]);
  assert.deepEqual(problems, [{
    code: 'bad-constraint', file: 'ground.json', path: 'constraints[1]', message: 'only one island per ground layer',
  }]);
  assert.ok(features.every((f) => !f.id.startsWith('other-isle')));
  assert.equal(islandOf(features).id, 'home-isle');
});

test('a river and a pond work on an island as they do on land', () => {
  const river = { kind: 'river', id: 'the-river', source: [0, 300], mouth: [2400, 1500], width: 60, provenance: 'master', sources: [] };
  const { features, problems } = generate([ISLAND, river, POND]);
  assert.deepEqual(problems, []);
  assert.deepEqual(features.filter((f) => f.type === 'water' && f.kind !== 'sea').map((f) => f.kind), ['river', 'pond']);
});

test('end to end: blocks fill the island, and no block centroid is in the sea', () => {
  const ring = [[700, 650], [1700, 650], [1700, 1150], [700, 1150]];
  const { features } = generate([ISLAND]);
  const sea = seasOf(features).map((f) => f.polygon);
  const land = islandOf(features).polygon;
  const layers = {
    ground: { features },
    green: { features: [] },
    walls: { features: [{ id: 'town-wall', type: 'wall', path: [...ring, ring[0]], closed: true, thickness: 4 }] },
    streets: { features: [{ id: 'main', type: 'street', rank: 'main', width: 14, path: [[700, 900], [1700, 900]] }] },
  };
  const blocks = generateBlocks({ canvas: CANVAS, seed: 7, constraints: [{ kind: 'fill', id: 'town' }], layers });
  assert.deepEqual(blocks.problems, []);
  assert.ok(blocks.features.length > 0, 'the island must hold blocks');
  for (const block of blocks.features) {
    const c = centroid(block.polygon);
    assert.equal(inAnyPolygon(c, sea), false, `${block.id} centroid is in the sea`);
    assert.equal(pointInPolygon(c, land), true, `${block.id} centroid is off the island`);
  }
});

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const TRACED = {
  kind: 'island', id: 'traced-isle', at: [1200, 900],
  outline: [[600, 400], [1000, 250], [1500, 300], [1900, 500], [1800, 1000], [1900, 1400], [1300, 1550], [700, 1300]],
  provenance: 'master', sources: [],
};

test('an island with an outline gives one land feature on the outline and one keyhole sea piece', () => {
  const { features, problems } = generate([TRACED]);
  assert.deepEqual(problems, []);
  assert.deepEqual(features.map((f) => f.type), ['land', 'water']);
  const outline = TRACED.outline;
  const land = islandOf(features);
  for (const [x, y] of land.polygon) {
    const nearest = Math.min(...outline.map((_, e) => distanceToSegment([x, y], outline[e], outline[(e + 1) % outline.length])));
    assert.ok(nearest <= 25, `point ${x},${y} is ${nearest} from the outline`);
  }
});

test('an island whose centre is outside its outline gives a problem and no feature', () => {
  const { features, problems } = generate([{ ...TRACED, at: [200, 200] }]);
  assert.deepEqual(features, []);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, 'bad-constraint');
  assert.match(problems[0].message, /the island centre must be inside its outline$/);
});

// A rectangle 1600 x 1000 around the centre, with a bay 400 wide and 500 deep cut into its south side.
const HARBOUR = {
  kind: 'island', id: 'harbour-isle', at: [1200, 900],
  outline: [[400, 400], [2000, 400], [2000, 1400], [1400, 1400], [1400, 900], [1000, 900], [1000, 1400], [400, 1400]],
  provenance: 'master', sources: [],
};

test('a traced island keeps its bay: the land is the outline and the sea is one keyhole piece', () => {
  const { features, problems } = generate([HARBOUR]);
  assert.deepEqual(problems, []);
  assert.deepEqual(features.map((f) => [f.id, f.type, f.kind]), [
    ['harbour-isle', 'land', 'island'],
    ['harbour-isle-sea', 'water', 'sea'],
  ]);
  const land = features[0].polygon;
  const sea = features[1].polygon;
  assert.deepEqual(land, HARBOUR.outline);
  assert.equal(pointInPolygon([1200, 1200], land), false, 'the bay is not land');
  assert.equal(pointInPolygon([1200, 1200], sea), true, 'the bay is sea');
  assert.equal(pointInPolygon([1200, 600], land), true, 'the middle of the island is land');
  assert.equal(pointInPolygon([1200, 600], sea), false, 'the middle of the island is not sea');
  assert.equal(pointInPolygon([500, 200], sea), true, 'the sea beside the slit is sea');
  assert.equal(pointInPolygon([0, 0], sea), true, 'a canvas corner is sea');
  assert.equal(pointInPolygon([0, 0], land), false);
  assert.ok(insideCanvas(sea));
  const distinct = new Set(sea.map((p) => p.join(','))).size;
  assert.ok(distinct <= 4 + HARBOUR.outline.length + 2, `${distinct} distinct points`);
  assert.ok(Math.abs(polygonArea(sea) + polygonArea(land) - CANVAS_AREA) / CANVAS_AREA < 0.001);
});

test('a building in the bay of a traced island is in water; one on the island is not', () => {
  const { features } = generate([HARBOUR]);
  const withBuilding = (at) => crossLayerProblems({ ground: { features }, buildings: { features: [{ id: 'tavern', at }] } }, {});
  assert.ok(withBuilding([1200, 1200]).some((p) => p.code === 'building-in-water'));
  assert.ok(!withBuilding([1200, 600]).some((p) => p.code === 'building-in-water'));
});
