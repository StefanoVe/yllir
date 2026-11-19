// Land mask of the atlas and the grid helpers shared by the layer generators. The grid is
// cell = max(width, height) / 512, with grid point (i, j) at (i * cell, j * cell), the same grid
// as terrain.mjs. The mask says sea, land or lake for every grid point and how far each land
// point is from the nearest water. Pure functions, no file access.

import { isFinitePoint, isUsablePolygon, pointInPolygon } from './geometry.mjs';
import { marchingSquares, ringArea, simplify, smooth } from './contour.mjs';
import { MinHeap } from './pathfind.mjs';

export const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export const SEA = 0;
export const LAND = 1;
export const LAKE = 2;

const SQRT2 = Math.SQRT2;
const round1 = (value) => Math.round(value * 10) / 10;
const clampTo = (value, max) => Math.min(max, Math.max(0, value));

/** Grid of a canvas: cell size and the number of grid points on each axis. */
export function gridOf(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const cell = Math.max(width, height) / 512;
  const gw = Math.ceil(width / cell) + 1;
  const gh = Math.ceil(height / cell) + 1;
  return { width, height, cell, gw, gh };
}

/** Grid index of the grid point nearest to (x, y), clamped to the grid. */
function nearestIndex(grid, x, y) {
  const i = Math.min(grid.gw - 1, Math.max(0, Math.round(x / grid.cell)));
  const j = Math.min(grid.gh - 1, Math.max(0, Math.round(y / grid.cell)));
  return j * grid.gw + i;
}

/**
 * Grid points inside any of the polygons, as a mask of gw * gh bytes. Scanline fill: for each grid
 * row, the crossings of the polygon edges with that row give the spans of inside points. Cheap even
 * for outlines with a thousand vertices.
 */
export function coverOf(polygons, grid) {
  const { cell, gw, gh } = grid;
  const mask = new Uint8Array(gw * gh);
  for (const polygon of polygons) {
    if (!isUsablePolygon(polygon)) continue;
    const ys = polygon.map((p) => p[1]);
    const j0 = Math.max(0, Math.ceil(Math.min(...ys) / cell));
    const j1 = Math.min(gh - 1, Math.floor(Math.max(...ys) / cell));
    for (let j = j0; j <= j1; j++) {
      const y = j * cell;
      const crossings = [];
      for (let k = 0; k < polygon.length; k++) {
        const [ax, ay] = polygon[k];
        const [bx, by] = polygon[(k + 1) % polygon.length];
        if ((ay > y) !== (by > y)) crossings.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
      crossings.sort((a, b) => a - b);
      for (let c = 0; c + 1 < crossings.length; c += 2) {
        const i0 = Math.max(0, Math.ceil(crossings[c] / cell));
        const i1 = Math.min(gw - 1, Math.floor(crossings[c + 1] / cell));
        for (let i = i0; i <= i1; i++) mask[j * gw + i] = 1;
      }
    }
  }
  return mask;
}

/** The mask grown by `margin` grid cells in every direction (square neighbourhood). */
export function grow(mask, gw, gh, margin) {
  const out = new Uint8Array(mask.length);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      if (mask[j * gw + i] !== 1) continue;
      for (let dj = -margin; dj <= margin; dj++) {
        for (let di = -margin; di <= margin; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni >= 0 && nj >= 0 && ni < gw && nj < gh) out[nj * gw + ni] = 1;
        }
      }
    }
  }
  return out;
}

/** The polygons of a feature: `polygons` (a list) or the legacy `polygon`, only the usable ones. */
export function polygonsOf(feature) {
  if (!isPlainObject(feature)) return [];
  const list = Array.isArray(feature.polygons) ? feature.polygons : [feature.polygon];
  return list.filter(isUsablePolygon);
}

/**
 * Land mask of the terrain layer.
 * kind: 0 sea, 1 land (inside a land polygon and not inside a lake polygon), 2 lake.
 * coastDistance: for each land point, the distance in canvas units to the nearest water point
 * (sea or lake), by a shortest-path search from all water points with 8 neighbours (steps of cell
 * or cell * sqrt 2). Water points have 0.
 * @param {{ canvas: { width: number, height: number }, terrain?: { features?: object[] } }} input
 */
export function landMask({ canvas, terrain }) {
  const grid = gridOf(canvas);
  const { cell, gw, gh } = grid;
  const features = Array.isArray(terrain?.features) ? terrain.features.filter(isPlainObject) : [];
  const landCover = coverOf(features.filter((f) => f.type === 'land').map((f) => f.polygon), grid);
  const lakeCover = coverOf(features.filter((f) => f.type === 'lake').map((f) => f.polygon), grid);

  const kind = new Uint8Array(gw * gh);
  for (let index = 0; index < kind.length; index++) {
    if (lakeCover[index] === 1) kind[index] = LAKE;
    else if (landCover[index] === 1) kind[index] = LAND;
    else kind[index] = SEA;
  }

  // Shortest distance from every water point, 8 neighbours. Water starts at 0; the heap keeps the
  // result exact when the steps have two lengths.
  const coastDistance = new Float32Array(gw * gh).fill(Infinity);
  const heap = new MinHeap((a, b) => a.d - b.d || a.index - b.index);
  for (let index = 0; index < kind.length; index++) {
    if (kind[index] !== LAND) {
      coastDistance[index] = 0;
      heap.push({ d: 0, index });
    }
  }
  while (heap.size > 0) {
    const { d, index } = heap.pop();
    if (d > coastDistance[index]) continue;
    const i = index % gw;
    const j = Math.floor(index / gw);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        const next = nj * gw + ni;
        const nd = d + cell * (di !== 0 && dj !== 0 ? SQRT2 : 1);
        if (nd < coastDistance[next]) {
          coastDistance[next] = nd;
          heap.push({ d: nd, index: next });
        }
      }
    }
  }

  const kindAt = (x, y) => kind[nearestIndex(grid, x, y)];
  return {
    ...grid,
    kind,
    coastDistance,
    at: kindAt,
    isLand: (x, y) => kindAt(x, y) === LAND,
    isWater: (x, y) => kindAt(x, y) !== LAND,
    waterDistance: (x, y) => coastDistance[nearestIndex(grid, x, y)],
    indexOf: (x, y) => nearestIndex(grid, x, y),
  };
}

/** Nesting depth of each ring: how many other rings contain its first point. */
function depthsOf(rings) {
  return rings.map((ring, i) => rings.reduce(
    (count, other, j) => count + (j !== i && pointInPolygon(ring[0], other) ? 1 : 0),
    0,
  ));
}

function centroidOf(polygon) {
  const sum = polygon.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / polygon.length, sum[1] / polygon.length];
}

/**
 * Outer outlines of the region where field > 0, as polygons sorted by decreasing area.
 * Rings with an odd nesting depth are holes and are left out. Each outline is simplified with
 * cell * 0.35, smoothed once, rounded to one decimal and clamped to the canvas. Outlines with an
 * area under (cell * 2)^2 are dropped.
 * @param {ArrayLike<number>} field gw * gh values
 * @param {ReturnType<typeof gridOf>} grid
 * @returns {number[][][]}
 */
export function contourPolygons(field, grid) {
  const { cell, gw, gh, width, height } = grid;
  const rings = marchingSquares(field, gw, gh, cell, 0);
  const depths = depthsOf(rings);
  const minArea = (cell * 2) ** 2;
  return rings
    .filter((_, i) => depths[i] % 2 === 0)
    .map((ring) => {
      const clamped = ring.map(([x, y]) => [clampTo(x, width), clampTo(y, height)]);
      const simplified = simplify(clamped, cell * 0.35);
      return smooth(simplified, 1)
        .map(([x, y]) => [clampTo(round1(clampTo(x, width)), width), clampTo(round1(clampTo(y, height)), height)]);
    })
    .filter((polygon) => polygon.length >= 3 && Math.abs(ringArea(polygon)) >= minArea)
    .sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a))
      || centroidOf(a)[0] - centroidOf(b)[0] || centroidOf(a)[1] - centroidOf(b)[1]);
}

/** Metadata copied from a constraint onto every feature it makes. */
export function featureMeta(constraint) {
  return {
    provenance: constraint.provenance ?? 'agent-choice',
    visibility: constraint.visibility ?? 'public',
    sources: Array.isArray(constraint.sources) ? constraint.sources.map((s) => ({ ...s })) : [],
  };
}

/**
 * One feature per polygon: the first (largest) gets the constraint id, the others get `<id>-2`,
 * `<id>-3`, ...
 */
export function pieceFeatures(id, polygons, type, meta) {
  return polygons.map((polygon, k) => ({
    id: k === 0 ? id : `${id}-${k + 1}`,
    type,
    polygon,
    ...meta,
  }));
}

/** Rounds a point to one decimal and clamps it to the canvas. */
export function clampPoint([x, y], canvas) {
  return [round1(clampTo(x, canvas.width)), round1(clampTo(y, canvas.height))];
}

/** True when a value is a list of finite points with at least `min` entries. */
export function isPointList(value, min = 0) {
  return Array.isArray(value) && value.length >= min && value.every(isFinitePoint);
}
