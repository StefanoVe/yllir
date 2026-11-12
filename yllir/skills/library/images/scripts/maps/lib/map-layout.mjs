// Battle map layout in grid cells (origin top-left, x to the right, y down):
// validation, the black-and-white guide picture and the bundle for generate2dmap.
// Pure functions: no file access.

export const CELL_PX = 64;
const GUIDE_SCALE_DEFAULT = 8;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const KNOWN_KEYS = new Set(['cols', 'rows', 'walls', 'doors', 'exits', 'start', 'points']);
const DOOR_SIDES = new Set(['h', 'v']);
const ACTOR_RADIUS = 19;
const INTERACTION_REACH = 40;
const WALL = [0, 0, 0];
const DOOR = [255, 0, 0];
const EXIT = [0, 0, 255];
const START = [0, 160, 0];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSize(value) {
  return Number.isInteger(value) && value >= 8 && value <= 60;
}

function isCell(value, cols, rows) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    Number.isInteger(value[1]) &&
    value[0] >= 0 &&
    value[0] < cols &&
    value[1] >= 0 &&
    value[1] < rows
  );
}

/**
 * Checks a layout. Returns the list of problems; an empty list means valid.
 * @param {unknown} layout
 * @returns {{ code: string, message: string }[]}
 */
export function validateLayout(layout) {
  const problems = [];
  const add = (code, message) => problems.push({ code, message });
  if (!isPlainObject(layout)) {
    add('bad-layout', 'the layout must be a JSON object');
    return problems;
  }
  for (const key of Object.keys(layout)) {
    if (!KNOWN_KEYS.has(key)) add('unknown-key', `unknown key: ${key}`);
  }
  const { cols, rows } = layout;
  if (!isSize(cols) || !isSize(rows)) {
    add('bad-size', 'cols and rows must be integers from 8 to 60');
    return problems;
  }

  const listOf = (value, what) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      add(what === 'walls' ? 'bad-wall' : 'bad-cell', `${what} must be a list`);
      return [];
    }
    return value;
  };

  const wallRects = [];
  for (const wall of listOf(layout.walls, 'walls')) {
    const valid =
      Array.isArray(wall) &&
      wall.length === 4 &&
      wall.every((v) => Number.isInteger(v)) &&
      wall[2] >= 1 &&
      wall[3] >= 1 &&
      wall[0] >= 0 &&
      wall[1] >= 0 &&
      wall[0] + wall[2] <= cols &&
      wall[1] + wall[3] <= rows;
    if (!valid) {
      add('bad-wall', `wall must be [x, y, w, h] with w and h at least 1, inside the map: ${JSON.stringify(wall)}`);
    } else {
      wallRects.push(wall);
    }
  }
  const covered = (cell) =>
    wallRects.some(([x, y, w, h]) => cell[0] >= x && cell[0] < x + w && cell[1] >= y && cell[1] < y + h);

  const seenIds = new Set();
  const checkId = (id, label) => {
    if (typeof id !== 'string' || !ID_RE.test(id) || seenIds.has(id)) {
      add('bad-id', `${label} has an invalid or repeated id: ${JSON.stringify(id)}`);
    }
    if (typeof id === 'string') seenIds.add(id);
  };

  for (const door of listOf(layout.doors, 'doors')) {
    const label = 'door';
    if (!isPlainObject(door)) {
      add('bad-cell', `${label} must be an object`);
      continue;
    }
    checkId(door.id, label);
    if (!DOOR_SIDES.has(door.side)) add('bad-side', `door ${door.id} side must be h or v`);
    if (!isCell(door.cell, cols, rows)) {
      add('bad-cell', `door ${door.id} cell must be [x, y] inside the map`);
    } else if (!covered(door.cell)) {
      add('in-wall', `door ${door.id} must lie in a wall line`);
    }
  }

  for (const exit of listOf(layout.exits, 'exits')) {
    if (!isPlainObject(exit)) {
      add('bad-cell', 'exit must be an object');
      continue;
    }
    checkId(exit.id, 'exit');
    if (!isCell(exit.cell, cols, rows)) {
      add('bad-cell', `exit ${exit.id} cell must be [x, y] inside the map`);
      continue;
    }
    const [x, y] = exit.cell;
    if (x !== 0 && y !== 0 && x !== cols - 1 && y !== rows - 1) {
      add('not-border', `exit ${exit.id} must be on the outer border of the map`);
    }
  }

  if (layout.start === undefined) {
    add('missing-start', 'the layout needs a start cell');
  } else if (!isCell(layout.start, cols, rows)) {
    add('bad-cell', 'start must be [x, y] inside the map');
  } else if (covered(layout.start)) {
    add('in-wall', 'start is covered by a wall');
  }

  for (const point of listOf(layout.points, 'points')) {
    if (!isPlainObject(point)) {
      add('bad-cell', 'point must be an object');
      continue;
    }
    checkId(point.id, 'point');
    if (!isCell(point.cell, cols, rows)) {
      add('bad-cell', `point ${point.id} cell must be [x, y] inside the map`);
    } else if (covered(point.cell)) {
      add('in-wall', `point ${point.id} is covered by a wall`);
    }
  }

  return problems;
}

/**
 * Black-and-white guide picture of a layout. Colours by priority: wall black,
 * door red, exit blue, start green; everything else white.
 * @param {object} layout a valid layout
 * @param {number} [scale=8] pixels per cell
 * @returns {{ width: number, height: number, rgb: Uint8Array }}
 */
export function guidePixels(layout, scale = GUIDE_SCALE_DEFAULT) {
  const { cols, rows } = layout;
  const width = cols * scale;
  const height = rows * scale;
  const cells = new Array(cols * rows).fill(null);
  const at = (x, y) => y * cols + x;

  for (const [x, y, w, h] of layout.walls ?? []) {
    for (let cy = y; cy < y + h; cy++) {
      for (let cx = x; cx < x + w; cx++) cells[at(cx, cy)] = WALL;
    }
  }
  for (const door of layout.doors ?? []) cells[at(door.cell[0], door.cell[1])] = DOOR;
  for (const exit of layout.exits ?? []) cells[at(exit.cell[0], exit.cell[1])] = EXIT;
  cells[at(layout.start[0], layout.start[1])] = START;

  const rgb = new Uint8Array(width * height * 3).fill(255);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const colour = cells[at(x, y)];
      if (colour === null) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          rgb.set(colour, (((y * scale + dy) * width) + x * scale + dx) * 3);
        }
      }
    }
  }
  return { width, height, rgb };
}

/** Rectangles of `rect` without the single cell `cell` (up to four pieces). */
function subtractCell([x, y, w, h], [cx, cy]) {
  if (cx < x || cx >= x + w || cy < y || cy >= y + h) return [[x, y, w, h]];
  return [
    [x, y, w, cy - y],
    [x, cy + 1, w, y + h - cy - 1],
    [x, cy, cx - x, 1],
    [cx + 1, cy, x + w - cx - 1, 1],
  ].filter(([, , pw, ph]) => pw > 0 && ph > 0);
}

/**
 * Collision rectangles in cells: one per wall, with each door and exit cell cut
 * out so that an opening in a wall line can be passed. Without the cut the door's
 * own interaction point would sit inside a blocked rectangle, and an exit on the
 * border would stay walled.
 */
export function collisionRects(layout) {
  let rects = (layout.walls ?? []).map((wall) => [...wall]);
  for (const opening of [...(layout.doors ?? []), ...(layout.exits ?? [])]) {
    rects = rects.flatMap((rect) => subtractCell(rect, opening.cell));
  }
  return rects;
}

/**
 * Bundle for generate2dmap (schema generate2dmap.map_bundle.v2), in pixels of 64 per cell.
 * @param {object} layout a valid layout
 * @param {{ id: string, art?: string }} options
 * @returns {object}
 */
export function buildBundle(layout, { id, art = 'fit/background.png' }) {
  const { cols, rows } = layout;
  const C = CELL_PX;
  const centre = (cell) => [cell[0] * C + C / 2, cell[1] * C + C / 2];
  const start = centre(layout.start);
  return {
    schema: 'generate2dmap.map_bundle.v2',
    id,
    tile_size: [C, C],
    world: { width: cols * C, height: rows * C, unit: 'px' },
    layers: [
      { name: 'base', kind: 'image', image: art },
      { name: 'tokens', kind: 'objects' },
    ],
    objects: [],
    collision: {
      actorRadius: ACTOR_RADIUS,
      ySquash: 1.0,
      rects: collisionRects(layout).map(([x, y, w, h]) => [x * C, y * C, w * C, h * C]),
    },
    portals: (layout.exits ?? []).map((exit) => ({
      id: exit.id,
      rect: [exit.cell[0] * C, exit.cell[1] * C, C, C],
      to: 'outside:start',
      activation: 'crossing',
    })),
    spawns: [{ id: 'start', x: start[0], y: start[1], facing: 'east' }],
    interactions: [...(layout.doors ?? []), ...(layout.points ?? [])].map((item) => {
      const [x, y] = centre(item.cell);
      return { id: item.id, x, y, reach: INTERACTION_REACH };
    }),
    camera: { bounds: [0, 0, cols * C, rows * C] },
    qa: {},
    art_source: 'existing',
  };
}
