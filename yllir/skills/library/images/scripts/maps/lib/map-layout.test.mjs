import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLayout, guidePixels, buildBundle, collisionRects } from './map-layout.mjs';

const EXAMPLE = {
  cols: 24,
  rows: 16,
  walls: [
    [0, 0, 24, 1],
    [10, 4, 1, 6],
  ],
  doors: [{ id: 'door-cellar', cell: [10, 7], side: 'v' }],
  exits: [{ id: 'exit-street', cell: [23, 8] }],
  start: [2, 8],
  points: [{ id: 'bar', cell: [5, 3] }],
};

// 10x8 map: one wall, one door in it, one exit on the right border, one point.
const SMALL = {
  cols: 10,
  rows: 8,
  walls: [[4, 2, 1, 3]],
  doors: [{ id: 'door-a', cell: [4, 3], side: 'v' }],
  exits: [{ id: 'exit-east', cell: [9, 5] }],
  start: [1, 1],
  points: [{ id: 'well', cell: [2, 6] }],
};

function withChange(base, change) {
  const layout = structuredClone(base);
  change(layout);
  return layout;
}

function codesOf(layout) {
  return validateLayout(layout).map((problem) => problem.code);
}

test('the example layout is valid', () => {
  assert.deepEqual(validateLayout(EXAMPLE), []);
  assert.deepEqual(validateLayout(SMALL), []);
});

test('bad-size: cols outside 8..60 or not an integer', () => {
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.cols = 7))), ['bad-size']);
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.rows = 61))), ['bad-size']);
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.rows = 8.5))), ['bad-size']);
});

test('bad-wall: not four integers, empty, or outside the map', () => {
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.walls = [[4, 2, 1, 3], [0, 0, 0, 1]]))), ['bad-wall']);
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.walls = [[4, 2, 1, 3], [0, 0, 1]]))), ['bad-wall']);
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.walls = [[4, 2, 1, 3], [9, 0, 2, 1]]))), ['bad-wall']);
});

test('bad-cell: a start, point or exit cell outside the map', () => {
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.start = [10, 1]))), ['bad-cell']);
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.points[0].cell = [2, -1]))), ['bad-cell']);
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.exits[0].cell = ['9', 5]))), ['bad-cell']);
});

test('in-wall: start or point covered by a wall, and a door outside every wall', () => {
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.start = [4, 3]))), ['in-wall']);
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.points[0].cell = [4, 2]))), ['in-wall']);
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.doors[0].cell = [1, 1]))), ['in-wall']);
});

test('an exit may lie on a wall cell on the border', () => {
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.exits[0].cell = [9, 3], l.walls = [[4, 2, 1, 3], [9, 3, 1, 1]]))), []);
});

test('a map with full border walls, an exit in the border wall and a door in an inner wall is valid', () => {
  const BORDERED = {
    cols: 20,
    rows: 14,
    walls: [
      [0, 0, 20, 1],
      [0, 13, 20, 1],
      [0, 1, 1, 12],
      [19, 1, 1, 12],
      [10, 1, 1, 12],
    ],
    doors: [{ id: 'door-inner', cell: [10, 6], side: 'v' }],
    exits: [{ id: 'exit-east', cell: [19, 7] }],
    start: [3, 7],
    points: [{ id: 'point-bar', cell: [15, 3] }],
  };
  assert.deepEqual(validateLayout(BORDERED), []);
  const rects = collisionRects(BORDERED);
  // the exit cell [19, 7] and the door cell [10, 6] are cut out of their walls
  assert.equal(rects.some(([x, y, w, h]) => 19 >= x && 19 < x + w && 7 >= y && 7 < y + h), false);
  assert.equal(rects.some(([x, y, w, h]) => 10 >= x && 10 < x + w && 6 >= y && 6 < y + h), false);
  const bundle = buildBundle(BORDERED, { id: 'bordered-1' });
  assert.equal(bundle.portals.length, 1);
  assert.equal(bundle.spawns[0].x, 3 * 64 + 32);
});

test('not-border: an exit that is not on the outer row or column', () => {
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.exits[0].cell = [5, 5]))), ['not-border']);
});

test('bad-id: invalid or repeated id across doors, exits and points', () => {
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.points[0].id = 'Bad Id'))), ['bad-id']);
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.points[0].id = 'door-a'))), ['bad-id']);
});

test('bad-side: a door side other than h or v', () => {
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.doors[0].side = 'x'))), ['bad-side']);
});

test('missing-start: a layout without start', () => {
  assert.deepEqual(codesOf(withChange(SMALL, (l) => delete l.start)), ['missing-start']);
});

test('unknown-key: a top-level key the format does not have', () => {
  assert.deepEqual(codesOf(withChange(SMALL, (l) => (l.notes = 'x'))), ['unknown-key']);
});

test('buildBundle returns the exact bundle for the small layout', () => {
  const bundle = buildBundle(SMALL, { id: 'taverna-map-1', art: 'fit/background.png' });
  assert.deepEqual(bundle, {
    schema: 'generate2dmap.map_bundle.v2',
    id: 'taverna-map-1',
    tile_size: [64, 64],
    world: { width: 640, height: 512, unit: 'px' },
    layers: [
      { name: 'base', kind: 'image', image: 'fit/background.png' },
      { name: 'tokens', kind: 'objects' },
    ],
    objects: [],
    collision: {
      actorRadius: 19,
      ySquash: 1.0,
      // the wall [4, 2, 1, 3] with the door cell [4, 3] cut out
      rects: [
        [256, 128, 64, 64],
        [256, 256, 64, 64],
      ],
    },
    portals: [
      { id: 'exit-east', rect: [576, 320, 64, 64], to: 'outside:start', activation: 'crossing' },
    ],
    spawns: [{ id: 'start', x: 96, y: 96, facing: 'east' }],
    interactions: [
      { id: 'door-a', x: 288, y: 224, reach: 40 },
      { id: 'well', x: 160, y: 416, reach: 40 },
    ],
    camera: { bounds: [0, 0, 640, 512] },
    qa: {},
    art_source: 'existing',
  });
});

test('guidePixels colours walls, doors, exits and start at known cells', () => {
  const guide = guidePixels(SMALL, 8);
  assert.equal(guide.width, 80);
  assert.equal(guide.height, 64);
  const colourAt = (cx, cy) => {
    const index = ((cy * 8) * guide.width + cx * 8) * 3;
    return [...guide.rgb.subarray(index, index + 3)];
  };
  assert.deepEqual(colourAt(4, 3), [255, 0, 0]); // door
  assert.deepEqual(colourAt(4, 2), [0, 0, 0]); // wall
  assert.deepEqual(colourAt(9, 5), [0, 0, 255]); // exit
  assert.deepEqual(colourAt(1, 1), [0, 160, 0]); // start
  assert.deepEqual(colourAt(2, 6), [255, 255, 255]); // point stays floor
  assert.deepEqual(colourAt(0, 0), [255, 255, 255]); // floor
});
