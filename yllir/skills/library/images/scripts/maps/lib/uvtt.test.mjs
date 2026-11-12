import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUvtt } from './uvtt.mjs';
import { encodePng } from './png.mjs';

const LAYOUT = {
  cols: 8,
  rows: 8,
  walls: [[2, 1, 3, 1]],
  doors: [
    { id: 'door-h', cell: [3, 1], side: 'h' },
    { id: 'door-v', cell: [2, 4], side: 'v' },
  ],
  exits: [],
  start: [0, 0],
  points: [],
};

function picture(cols, rows) {
  return encodePng(cols * 64, rows * 64, new Uint8Array(cols * 64 * rows * 64 * 3));
}

test('buildUvtt writes the format header and the wall ring in grid units', () => {
  const uvtt = buildUvtt({ layout: LAYOUT, imagePng: picture(8, 8) });
  assert.equal(uvtt.format, 0.3);
  assert.deepEqual(uvtt.resolution, {
    map_origin: { x: 0, y: 0 },
    map_size: { x: 8, y: 8 },
    pixels_per_grid: 64,
  });
  // the wall [2, 1, 3, 1] with the door cell [3, 1] cut out: two rings
  assert.deepEqual(uvtt.line_of_sight, [
    [
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 1 },
    ],
    [
      { x: 4, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 1 },
    ],
  ]);
  assert.deepEqual(uvtt.environment, { baked_lighting: false, ambient_light: 'ffffffff' });
});

test('a horizontal door and a vertical door have the expected shapes', () => {
  const uvtt = buildUvtt({ layout: LAYOUT, imagePng: picture(8, 8) });
  assert.deepEqual(uvtt.portals[0], {
    position: { x: 3.5, y: 1.5 },
    bounds: [
      { x: 3, y: 1.5 },
      { x: 4, y: 1.5 },
    ],
    rotation: 0,
    closed: true,
    freestanding: false,
  });
  assert.deepEqual(uvtt.portals[1], {
    position: { x: 2.5, y: 4.5 },
    bounds: [
      { x: 2.5, y: 4 },
      { x: 2.5, y: 5 },
    ],
    rotation: 1.5707963267948966,
    closed: true,
    freestanding: false,
  });
});

test('a door in a horizontal wall splits the wall into two rings and keeps the portal', () => {
  const layout = {
    cols: 8,
    rows: 8,
    walls: [[2, 3, 5, 1]],
    doors: [{ id: 'door-mid', cell: [4, 3], side: 'h' }],
    exits: [],
    start: [0, 0],
    points: [],
  };
  const uvtt = buildUvtt({ layout, imagePng: picture(8, 8) });
  assert.equal(uvtt.line_of_sight.length, 2);
  assert.deepEqual(uvtt.line_of_sight[0], [
    { x: 2, y: 3 },
    { x: 4, y: 3 },
    { x: 4, y: 4 },
    { x: 2, y: 4 },
    { x: 2, y: 3 },
  ]);
  assert.deepEqual(uvtt.line_of_sight[1], [
    { x: 5, y: 3 },
    { x: 7, y: 3 },
    { x: 7, y: 4 },
    { x: 5, y: 4 },
    { x: 5, y: 3 },
  ]);
  assert.deepEqual(uvtt.portals, [
    {
      position: { x: 4.5, y: 3.5 },
      bounds: [
        { x: 4, y: 3.5 },
        { x: 5, y: 3.5 },
      ],
      rotation: 0,
      closed: true,
      freestanding: false,
    },
  ]);
});

test('the image is the base64 of the PNG and decodes back to the same bytes', () => {
  const png = picture(8, 8);
  const uvtt = buildUvtt({ layout: LAYOUT, imagePng: png });
  assert.ok(Buffer.from(uvtt.image, 'base64').equals(png));
});

test('buildUvtt refuses a picture of the wrong size', () => {
  assert.throws(() => buildUvtt({ layout: LAYOUT, imagePng: picture(7, 8) }), /image-size/);
  assert.throws(() => buildUvtt({ layout: LAYOUT, imagePng: Buffer.from('not a png') }), /image-size/);
});
