// Routes generator of the atlas: turns the `road`, `trail` and `sea-route` constraints into open
// paths between places. Roads and trails walk the land, cheaper on plains and roads already built;
// sea routes walk the open sea. Problems are { code, file, path, message }.

import { isFinitePoint, isUsablePolygon } from './geometry.mjs';
import { aStar } from './pathfind.mjs';
import {
  landMask, gridOf, coverOf, grow, featureMeta, clampPoint, isPlainObject, polygonsOf, isPointList, SEA, LAND,
} from './landmask.mjs';

// The cost of mountains also applies one cell beyond their outline: smoothed outlines may overshoot a cell.
const MOUNTAIN_EDGE = 1;

const FILE = 'routes.json';
const KINDS = ['road', 'trail', 'sea-route'];
const LAND_KINDS = ['road', 'trail'];

/**
 * Douglas-Peucker on an open polyline; keeps both ends. A chord is accepted only when `clear(a, b)`
 * says it stays on passable ground, so simplification never cuts a corner through water or a mountain.
 */
export function openPath(points, tolerance, clear = () => true) {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Array(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const distance = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const stack = [[0, n - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop();
    let best = -1;
    let index = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distance(points[i], points[s], points[e]);
      if (d > best) {
        best = d;
        index = i;
      }
    }
    if (index !== -1 && (best > tolerance || !clear(points[s], points[e]))) {
      keep[index] = true;
      stack.push([s, index], [index, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Chaikin corner cutting on an open polyline, keeping both ends. */
export function chaikinOpen(points, iterations = 2) {
  let current = points;
  for (let round = 0; round < iterations; round++) {
    const next = [current[0]];
    for (let k = 0; k + 1 < current.length; k++) {
      const [ax, ay] = current[k];
      const [bx, by] = current[k + 1];
      next.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

/** Grid cells visited by a polyline, one sample per cell length along each segment. */
function cellsAlong(points, grid) {
  const out = [];
  const { cell, gw, gh } = grid;
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, ay] = points[k];
    const [bx, by] = points[k + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / cell));
    for (let s = 0; s <= steps; s++) {
      const i = Math.min(gw - 1, Math.max(0, Math.round((ax + ((bx - ax) * s) / steps) / cell)));
      const j = Math.min(gh - 1, Math.max(0, Math.round((ay + ((by - ay) * s) / steps) / cell)));
      out.push([i, j]);
    }
  }
  return out;
}

/** Nearest grid cell of the wanted kind to a point, ties by row then column. Null when none. */
function nearestOfKind(grid, kind, point, kinds) {
  const { cell, gw, gh } = grid;
  let best = null;
  let bestDistance = Infinity;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      if (kinds[j * gw + i] !== kind) continue;
      const d = Math.hypot(i * cell - point[0], j * cell - point[1]);
      if (d < bestDistance) {
        bestDistance = d;
        best = [i, j];
      }
    }
  }
  return best === null ? null : { cell: best, distance: bestDistance };
}

/**
 * Generates the routes layer from the route constraints. The places they connect come from the
 * places layer; the terrain and the relief and biomes decide the cost.
 * @param {{ canvas: { width: number, height: number }, seed: number, constraints?: object[],
 *   layers?: Record<string, { features?: object[] }>, locked?: { features: object[], constraintCount: number } | null }} input
 * @returns {{ features: object[], problems: object[] }}
 */
export function generateRoutes({ canvas, seed, constraints = [], layers = {}, locked = null }) {
  const grid = gridOf(canvas);
  const { cell, gw, gh } = grid;
  const list = (Array.isArray(constraints) ? constraints : []).map((c, k) => [isPlainObject(c) ? c : {}, k]);
  const firstNew = locked ? locked.constraintCount : 0;
  const lockedFeatures = locked && Array.isArray(locked.features) ? locked.features.filter(isPlainObject) : [];
  const problems = [];

  const hasLand = (layers.terrain?.features ?? []).some((f) => isPlainObject(f) && f.type === 'land' && isUsablePolygon(f.polygon));
  const places = (Array.isArray(layers.places?.features) ? layers.places.features : [])
    .filter((f) => isPlainObject(f) && typeof f.id === 'string' && isFinitePoint(f.at));
  if (!hasLand || places.length === 0) {
    return {
      features: [],
      problems: [{
        code: 'missing-prerequisite',
        file: FILE,
        path: '',
        message: 'routes need the terrain with land and the places layer with the places they connect',
      }],
    };
  }
  const placeAt = new Map(places.map((f) => [f.id, f.at]));

  const mask = landMask({ canvas, terrain: layers.terrain });
  const relief = Array.isArray(layers.relief?.features) ? layers.relief.features.filter(isPlainObject) : [];
  const biomes = Array.isArray(layers.biomes?.features) ? layers.biomes.features.filter(isPlainObject) : [];
  const mountains = grow(coverOf(relief.filter((f) => f.type === 'mountains').flatMap(polygonsOf), grid), gw, gh, MOUNTAIN_EDGE);
  const hills = coverOf(relief.filter((f) => f.type === 'hills').flatMap(polygonsOf), grid);
  const forest = coverOf(biomes.filter((f) => f.type === 'forest' || f.type === 'swamp').flatMap(polygonsOf), grid);

  // Cells of the roads already built (locked ones first); roads merge into them.
  const used = new Uint8Array(gw * gh);
  for (const f of lockedFeatures) {
    if (f.type === 'road' && Array.isArray(f.path)) {
      for (const [i, j] of cellsAlong(f.path, grid)) used[j * gw + i] = 1;
    }
  }

  const features = [...lockedFeatures];
  for (const [c, k] of list) {
    if (!KINDS.includes(c.kind) || k < firstNew) continue;
    const path = `constraints[${k}]`;
    const viaOk = c.via === undefined || isPointList(c.via);
    if (typeof c.id !== 'string' || typeof c.from !== 'string' || typeof c.to !== 'string' || !viaOk) {
      problems.push({ code: 'bad-constraint', file: FILE, path, message: `route ${c.id} needs an id, from, to and optional via points` });
      continue;
    }
    if (!placeAt.has(c.from) || !placeAt.has(c.to)) {
      problems.push({ code: 'unknown-route-place', file: FILE, path, message: `route ${c.id} connects a place that is not in the places layer` });
      continue;
    }

    const onLand = LAND_KINDS.includes(c.kind);
    const kind = onLand ? LAND : SEA;
    const passable = (i, j) => mask.kind[j * gw + i] === kind;
    const cost = (i, j) => {
      const index = j * gw + i;
      let multiplier = 1;
      if (mountains[index] === 1) multiplier *= 5;
      if (hills[index] === 1) multiplier *= 2;
      if (forest[index] === 1) multiplier *= 1.6;
      if (used[index] === 1) multiplier *= 0.6;
      return multiplier;
    };

    // Endpoints and via points snap to the nearest cell of the wanted kind.
    const stops = [c.from, ...(c.via ?? []), c.to].map((id) => (typeof id === 'string' ? placeAt.get(id) : id));
    const cellsOf = [];
    let snapFailed = false;
    for (const point of stops) {
      const nearest = nearestOfKind(grid, kind, point, mask.kind);
      if (nearest === null || (!onLand && nearest.distance > cell * 6)) {
        problems.push({ code: 'place-not-on-coast', file: FILE, path, message: `route ${c.id} starts or ends away from the sea` });
        snapFailed = true;
        break;
      }
      cellsOf.push(nearest.cell);
    }
    if (snapFailed) continue;

    // One A* leg between each pair of stops, joined into one list of cells.
    let cells = [];
    let found = true;
    for (let s = 0; s + 1 < cellsOf.length; s++) {
      const leg = aStar({
        gw,
        gh,
        cell,
        passable,
        cost: onLand ? cost : () => 1,
        start: cellsOf[s],
        goal: cellsOf[s + 1],
        minCost: onLand ? 0.6 : 1,
      });
      if (leg === null) {
        found = false;
        break;
      }
      cells = cells.length === 0 ? leg : cells.concat(leg.slice(1));
    }
    if (!found) {
      problems.push({ code: 'no-route', file: FILE, path, message: `no ${onLand ? 'land' : 'sea'} route for ${c.id}` });
      continue;
    }

    const clear = (a, b) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell / 4)));
      for (let s = 0; s <= steps; s++) {
        const x = a[0] + ((b[0] - a[0]) * s) / steps;
        const y = a[1] + ((b[1] - a[1]) * s) / steps;
        if (mask.kind[mask.indexOf(x, y)] !== kind) return false;
      }
      return true;
    };
    const simplified = openPath(cells.map(([i, j]) => [i * cell, j * cell]), cell * 0.6, clear);
    // Smoothing may move a vertex across a corner; the smoothed path is kept only when every vertex stays passable.
    const smoothed = chaikinOpen(simplified, 2);
    const usable = smoothed.every(([x, y]) => mask.kind[mask.indexOf(x, y)] === kind);
    const finished = (usable ? smoothed : simplified).map((p) => clampPoint(p, canvas));
    if (finished.length < 2) {
      problems.push({ code: 'no-route', file: FILE, path, message: `route ${c.id} is too short to draw` });
      continue;
    }

    if (c.kind === 'road') {
      for (const [i, j] of cells) used[j * gw + i] = 1;
    }
    features.push({ id: c.id, type: c.kind, path: finished, connects: [c.from, c.to], ...featureMeta(c) });
  }

  return { features, problems };
}
