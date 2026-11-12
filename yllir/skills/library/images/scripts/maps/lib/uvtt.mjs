// Universal VTT map file (format 0.3) built from a layout. Coordinates are in
// grid cells, not pixels.

import { CELL_PX, collisionRects } from './map-layout.mjs';
import { pngSize } from './png.mjs';

const QUARTER_TURN = 1.5707963267948966;

function wallRing(x, y, w, h) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
    { x, y },
  ];
}

function doorPortal([c, r], side) {
  if (side === 'h') {
    return {
      position: { x: c + 0.5, y: r + 0.5 },
      bounds: [
        { x: c, y: r + 0.5 },
        { x: c + 1, y: r + 0.5 },
      ],
      rotation: 0,
      closed: true,
      freestanding: false,
    };
  }
  return {
    position: { x: c + 0.5, y: r + 0.5 },
    bounds: [
      { x: c + 0.5, y: r },
      { x: c + 0.5, y: r + 1 },
    ],
    rotation: QUARTER_TURN,
    closed: true,
    freestanding: false,
  };
}

/**
 * Universal VTT object for a layout and its fitted picture.
 * @param {{ layout: object, imagePng: Buffer }} args a valid layout and the PNG of size cols*64 x rows*64
 * @returns {object}
 * @throws {Error} message `image-size` when the picture does not fit the layout
 */
export function buildUvtt({ layout, imagePng }) {
  const { cols, rows } = layout;
  const size = pngSize(imagePng);
  if (size === null || size.width !== cols * CELL_PX || size.height !== rows * CELL_PX) {
    throw new Error('image-size');
  }
  return {
    format: 0.3,
    resolution: {
      map_origin: { x: 0, y: 0 },
      map_size: { x: cols, y: rows },
      pixels_per_grid: CELL_PX,
    },
    line_of_sight: collisionRects(layout).map(([x, y, w, h]) => wallRing(x, y, w, h)),
    objects_line_of_sight: [],
    portals: (layout.doors ?? []).map((door) => doorPortal(door.cell, door.side)),
    environment: { baked_lighting: false, ambient_light: 'ffffffff' },
    lights: [],
    image: imagePng.toString('base64'),
  };
}
