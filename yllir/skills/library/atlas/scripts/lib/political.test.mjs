import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, pointInPolygon } from './geometry.mjs';
import { assignRealms, generatePolitical } from './political.mjs';
import { gridOf, landMask } from './landmask.mjs';

const sq = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const canvas = { width: 1000, height: 1000 };
const realm = (id, color, seeds, extra = {}) => ({ kind: 'realm', id, color, seeds, ...extra });

// One landmass: two blocks joined by a narrow neck along y = 500.
const dumbbell = {
  layer: 'terrain',
  features: [
    { id: 'west', type: 'land', polygon: sq(100, 300, 450, 700) },
    { id: 'east', type: 'land', polygon: sq(550, 300, 900, 700) },
    { id: 'neck', type: 'land', polygon: sq(440, 480, 560, 520) },
  ],
};
const islands = {
  layer: 'terrain',
  features: [
    { id: 'west', type: 'land', polygon: sq(100, 300, 400, 700) },
    { id: 'far', type: 'land', polygon: sq(600, 300, 900, 700) },
  ],
};

test('two realms on one landmass split it: every land cell belongs to exactly one realm', () => {
  const realms = [{ seeds: [[200, 500]] }, { seeds: [[800, 500]] }];
  const { owner, grid } = assignRealms({ canvas, terrain: dumbbell, realms });
  const mask = landMask({ canvas, terrain: dumbbell });
  let landCells = 0;
  let owned = 0;
  for (let index = 0; index < owner.length; index++) {
    if (mask.kind[index] !== 1) continue;
    landCells++;
    if (owner[index] === 0 || owner[index] === 1) owned++;
  }
  assert.equal(owned, landCells);
  assert.ok(grid.gw > 0);
  assert.ok(owner.some((r) => r === 0) && owner.some((r) => r === 1));
});

test('a cut across the isthmus keeps a realm on its side', () => {
  const cut = [[[500, 430], [500, 570]]];
  const withCut = assignRealms({ canvas, terrain: dumbbell, realms: [{ seeds: [[200, 500]], cuts: cut }] });
  const withoutCut = assignRealms({ canvas, terrain: dumbbell, realms: [{ seeds: [[200, 500]] }] });
  const eastOwned = (owner, grid) => {
    let n = 0;
    for (let j = 0; j < grid.gh; j++) for (let i = 0; i < grid.gw; i++) {
      if (i * grid.cell > 600 && owner[j * grid.gw + i] === 0) n++;
    }
    return n;
  };
  assert.equal(eastOwned(withCut.owner, withCut.grid), 0);
  assert.ok(eastOwned(withoutCut.owner, withoutCut.grid) > 0);
});

test('realm polygons are drawn from the owner cells and carry the colour and seeds', () => {
  const { features, problems } = generatePolitical({
    canvas,
    seed: 1,
    constraints: [realm('north', '#aa3322', [[200, 500]]), realm('south', '#2233aa', [[800, 500]])],
    layers: { terrain: dumbbell },
  });
  assert.deepEqual(problems, []);
  assert.equal(features.length, 2);
  assert.equal(features[0].type, 'realm');
  assert.equal(features[0].color, '#aa3322');
  assert.deepEqual(features[0].seeds, [[200, 500]]);
  assert.ok(features[0].polygons.length >= 1);
  assert.ok(!('polygon' in features[0]));
});

test('a seed off land gives realm-seed-not-land', () => {
  const { problems } = generatePolitical({
    canvas,
    seed: 1,
    constraints: [realm('ghost', '#000000', [[20, 20]])],
    layers: { terrain: dumbbell },
  });
  assert.ok(problems.some((p) => p.code === 'realm-seed-not-land'));
});

test('no terrain land gives missing-prerequisite', () => {
  const { problems } = generatePolitical({ canvas, seed: 1, constraints: [realm('a', '#000000', [[200, 500]])], layers: {} });
  assert.deepEqual(problems.map((p) => p.code), ['missing-prerequisite']);
});

test('lock, then an appended realm: the locked one is identical and the new one stays off the locked land', () => {
  const first = generatePolitical({
    canvas,
    seed: 1,
    constraints: [realm('north', '#aa3322', [[200, 500]])],
    layers: { terrain: islands },
  });
  const lockedFeatures = first.features;
  const out = generatePolitical({
    canvas,
    seed: 1,
    constraints: [realm('north', '#aa3322', [[200, 500]]), realm('far', '#2233aa', [[750, 500]])],
    layers: { terrain: islands },
    locked: { features: lockedFeatures, constraintCount: 1 },
  });
  assert.equal(canonicalJson(out.features[0]), canonicalJson(lockedFeatures[0]));
  assert.equal(out.features[1].id, 'far');
  const northPolygons = lockedFeatures[0].polygons;
  for (const polygon of out.features[1].polygons) {
    for (const [x, y] of polygon) {
      assert.ok(x > 550, `far vertex ${x} lies on the far island`);
      assert.equal(northPolygons.some((p) => pointInPolygon([x, y], p)), false);
    }
  }
});

test('a realm keeps its name and its place on the feature; without them the feature has neither', () => {
  const named = generatePolitical({
    canvas,
    seed: 1,
    constraints: [realm('north', '#aa3322', [[200, 500]], { name: 'Ashmark', place: 'north' }), realm('south', '#2233aa', [[800, 500]])],
    layers: { terrain: dumbbell },
  });
  assert.deepEqual(named.problems, []);
  const [north, south] = named.features;
  assert.equal(north.name, 'Ashmark');
  assert.equal(north.place, 'north');
  assert.equal(south.name, undefined);
  assert.equal(south.place, undefined);
});

test('a realm name that is not text gives bad-constraint and no feature', () => {
  const result = generatePolitical({
    canvas,
    seed: 1,
    constraints: [realm('north', '#aa3322', [[200, 500]], { name: '  ' })],
    layers: { terrain: dumbbell },
  });
  assert.deepEqual(result.problems.map((p) => p.code), ['bad-constraint']);
  assert.deepEqual(result.features, []);
});
