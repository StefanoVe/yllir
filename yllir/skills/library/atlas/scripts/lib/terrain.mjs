// Terrain generator of the atlas: turns the terrain constraints into land and lake features,
// deterministically from the seed. The land field is sampled on a grid, contoured by contour.mjs,
// and checked against the constraints. Problems are { code, file, path, message }, file terrain.json.
// Locked features are returned unchanged and first; only the constraints not yet locked add land.

import { isFinitePoint, isUsablePolygon, pointInPolygon, vertexOverlap } from './geometry.mjs';
import { fbm, warp } from './noise.mjs';
import { marchingSquares, ringArea, simplify, smooth } from './contour.mjs';

const FILE = 'terrain.json';
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function distanceToEdges(p, polygon) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    best = Math.min(best, distanceToSegment(p, polygon[i], polygon[(i + 1) % polygon.length]));
  }
  return best;
}

const clampPoint = ([x, y], width, height) => [Math.min(width, Math.max(0, x)), Math.min(height, Math.max(0, y))];
const round1 = (value) => Math.round(value * 10) / 10;

/** Clamps to the canvas, rounds to one decimal and clamps again (the bounds are whole numbers, so this is stable). */
function finishRing(ring, width, height) {
  return ring
    .map((p) => clampPoint(p, width, height))
    .map(([x, y]) => [round1(x), round1(y)])
    .map((p) => clampPoint(p, width, height));
}

/** Smooths and simplifies one outer ring, oriented to a positive area. */
function shapeRing(ring, cell, width, height) {
  const oriented = ringArea(ring) < 0 ? [...ring].reverse() : ring;
  const clamped = oriented.map((p) => clampPoint(p, width, height));
  const simplified = simplify(clamped, cell * 0.35);
  return finishRing(smooth(simplified, 1), width, height);
}

/** Nesting depth of each ring: how many other rings contain its first point. Odd depth means a hole. */
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

/** A lake feature from a lake or sea constraint: sources are copied; a document without sources becomes agent-choice. */
function lakeFeature(id, polygon, constraint) {
  const sources = Array.isArray(constraint.sources) ? constraint.sources.map((s) => ({ ...s })) : [];
  const provenance = constraint.provenance === 'document' && sources.length === 0
    ? 'agent-choice'
    : (constraint.provenance ?? 'agent-choice');
  return { id, type: 'lake', polygon, provenance, visibility: 'public', sources };
}

/**
 * Generates the terrain layer from its constraints.
 * @param {{ canvas: { width: number, height: number }, seed: number, constraints?: object[],
 *   locked?: { features: object[], constraintCount: number } | null }} input
 * @returns {{ features: object[], problems: object[] }}
 */
export function generateTerrain({ canvas, seed, constraints = [], locked = null }) {
  const width = canvas.width;
  const height = canvas.height;
  const cell = Math.max(width, height) / 512;
  const gw = Math.ceil(width / cell) + 1;
  const gh = Math.ceil(height / cell) + 1;
  const scale = cell * 24;
  const list = (Array.isArray(constraints) ? constraints : []).map((c, k) => [isPlainObject(c) ? c : {}, k]);
  const firstNew = locked ? locked.constraintCount : 0;
  const isNew = (k) => k >= firstNew;
  const lockedFeatures = locked && Array.isArray(locked.features) ? locked.features.filter(isPlainObject) : [];
  const lockedLand = lockedFeatures.filter((f) => f.type === 'land' && isUsablePolygon(f.polygon));
  const openSides = new Set(list.filter(([c]) => c.kind === 'open-edge').map(([c]) => c.side));
  const problems = [];

  // Step 2: the land field. Sample (i, j) is at (i * cell, j * cell).
  const field = new Float64Array(gw * gh).fill(-1);
  const at = (i, j) => [i * cell, j * cell];
  const set = (i, j, value) => {
    const index = j * gw + i;
    field[index] = value;
  };
  const get = (i, j) => field[j * gw + i];

  for (const [c, k] of list) {
    if (c.kind === 'landmass' && isNew(k) && isFinitePoint(c.center)
      && Array.isArray(c.radius) && c.radius.length === 2 && c.radius.every((r) => r > 0)) {
      const [cx, cy] = c.center;
      const [rx, ry] = c.radius;
      const roughness = typeof c.roughness === 'number' ? c.roughness : 0.5;
      const m = Math.min(rx, ry);
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          const [x, y] = at(i, j);
          const [wx, wy] = warp(seed + k, x, y, m * 0.8, m * 0.35 * roughness);
          const d = Math.sqrt(((wx - cx) / rx) ** 2 + ((wy - cy) / ry) ** 2);
          const big = (fbm(seed + k + 11, x / (m * 0.5), y / (m * 0.5), { octaves: 4 }) - 0.5) * 2;
          const fine = (fbm(seed + k + 23, x / (cell * 12), y / (cell * 12), { octaves: 6, gain: 0.55 }) - 0.5) * 2;
          const v = 1 - d + roughness * 0.45 * big + roughness * 0.18 * fine;
          set(i, j, Math.max(get(i, j), v));
        }
      }
    } else if (c.kind === 'region' && isNew(k) && isFinitePoint(c.at) && c.radius > 0) {
      // Only the core of a region is forced to land, so a region does not paint a perfect disk.
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          const [x, y] = at(i, j);
          if (Math.hypot(x - c.at[0], y - c.at[1]) <= c.radius * 0.6) set(i, j, Math.max(get(i, j), 0.25));
        }
      }
    } else if (c.kind === 'open-edge' && isNew(k)) {
      const band = c.side === 'east' || c.side === 'west' ? 0.15 * width : 0.15 * height;
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          const [x, y] = at(i, j);
          const inBand = (c.side === 'west' && x <= band)
            || (c.side === 'east' && x >= width - band)
            || (c.side === 'north' && y <= band)
            || (c.side === 'south' && y >= height - band);
          if (inBand) set(i, j, Math.max(get(i, j), 0.2 + 0.3 * fbm(seed + k, x / scale, y / scale)));
        }
      }
    }
  }

  // Sea disks are noisy: the outline is warped and its radius wobbles with a fine noise term.
  for (const [c, k] of list) {
    if (c.kind !== 'sea' || !isFinitePoint(c.at) || !(c.radius > 0)) continue;
    const roughness = typeof c.roughness === 'number' ? c.roughness : 0.5;
    const reach = c.radius * (1 + 0.25 * roughness);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const [x, y] = at(i, j);
        const [wx, wy] = warp(seed + k, x, y, c.radius, c.radius * 0.4 * roughness);
        if (Math.hypot(wx - c.at[0], wy - c.at[1]) > reach) continue;
        const fineNoise = (fbm(seed + k + 23, x / (cell * 8), y / (cell * 8), { octaves: 6, gain: 0.55 }) - 0.5) * 2;
        if (Math.hypot(wx - c.at[0], wy - c.at[1]) < c.radius * (1 + 0.25 * roughness * fineNoise)) {
          set(i, j, Math.min(get(i, j), -0.5));
        }
      }
    }
  }

  // Map border: sea, except on the sides that are open.
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const border = (i === 0 && !openSides.has('west'))
        || (i === gw - 1 && !openSides.has('east'))
        || (j === 0 && !openSides.has('north'))
        || (j === gh - 1 && !openSides.has('south'));
      if (border) set(i, j, Math.min(get(i, j), -0.01));
    }
  }

  // Step 3: locked land is untouchable. Grid points inside it, or within two cells of it, are sea.
  for (const feature of lockedLand) {
    const xs = feature.polygon.map((p) => p[0]);
    const ys = feature.polygon.map((p) => p[1]);
    const margin = 2 * cell;
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - margin) / cell));
    const i1 = Math.min(gw - 1, Math.ceil((Math.max(...xs) + margin) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - margin) / cell));
    const j1 = Math.min(gh - 1, Math.ceil((Math.max(...ys) + margin) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const p = at(i, j);
        if (pointInPolygon(p, feature.polygon) || distanceToEdges(p, feature.polygon) <= margin) set(i, j, -1);
      }
    }
  }

  // Step 4 and 5: land features from the outer rings of the contour.
  const rings = marchingSquares(field, gw, gh, cell, 0);
  const depths = depthsOf(rings);
  const minArea = (cell * 3) ** 2;
  const minLandArea = (cell * 2) ** 2; // small islets near the coast survive
  const shaped = rings
    .map((ring, i) => ({ ring, depth: depths[i] }))
    .filter((r) => r.depth % 2 === 0)
    .map(({ ring }) => shapeRing(ring, cell, width, height))
    .filter((polygon) => polygon.length >= 3 && Math.abs(ringArea(polygon)) >= minLandArea)
    .map((polygon) => ({ polygon, area: Math.abs(ringArea(polygon)), centre: centroidOf(polygon) }))
    .sort((a, b) => b.area - a.area || a.centre[0] - b.centre[0] || a.centre[1] - b.centre[1]);

  let nextNumber = 1;
  for (const feature of lockedFeatures) {
    const match = typeof feature.id === 'string' ? /^land-(\d+)$/.exec(feature.id) : null;
    if (match) nextNumber = Math.max(nextNumber, Number(match[1]) + 1);
  }
  // Holes: a hole that contains the centre of a sea constraint is water inside the land and becomes
  // a lake `sea-<k>`. Other holes come from the noise and are ignored.
  const seaCentres = list.filter(([c]) => c.kind === 'sea' && isFinitePoint(c.at) && c.radius > 0);
  const seaLakes = [];
  const lockedIds = new Set(lockedFeatures.map((f) => f.id));
  rings.forEach((ring, i) => {
    if (depths[i] % 2 === 0) return;
    const hit = seaCentres.find(([c]) => pointInPolygon(c.at, ring));
    if (!hit) return;
    const [c, k] = hit;
    const id = `sea-${k}`;
    if (lockedIds.has(id) || seaLakes.some((lake) => lake.id === id)) return;
    const polygon = shapeRing(ring, cell, width, height);
    if (polygon.length < 3 || Math.abs(ringArea(polygon)) < minArea) return;
    seaLakes.push(lakeFeature(id, polygon, c));
  });

  const newLand = shaped.map(({ polygon }) => ({
    id: `land-${nextNumber++}`,
    type: 'land',
    polygon,
    provenance: 'agent-choice',
    visibility: 'public',
    sources: [],
  }));

  // Step 6: lakes, each from its own field, the largest ring of its contour.
  const newLakes = [];
  for (const [c, k] of list) {
    if (c.kind !== 'lake' || !isNew(k) || !isFinitePoint(c.at) || !(c.radius > 0)) continue;
    const roughness = typeof c.roughness === 'number' ? c.roughness : 0.3;
    const lakeField = new Float64Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const [x, y] = at(i, j);
        const [wx, wy] = warp(seed + k, x, y, c.radius, c.radius * 0.45 * roughness);
        const d = Math.hypot((wx - c.at[0]) / c.radius, (wy - c.at[1]) / c.radius);
        const fine = (fbm(seed + k + 23, x / (cell * 12), y / (cell * 12), { octaves: 6, gain: 0.55 }) - 0.5) * 2;
        lakeField[j * gw + i] = 1 - d + roughness * 0.6 * (fbm(seed + k, x / scale, y / scale) - 0.5) * 2
          + roughness * 0.2 * fine;
      }
    }
    const lakeRings = marchingSquares(lakeField, gw, gh, cell, 0);
    const largest = lakeRings.reduce((best, ring) => (best === null || Math.abs(ringArea(ring)) > Math.abs(ringArea(best))
      ? ring : best), null);
    const polygon = largest === null ? null : shapeRing(largest, cell, width, height);
    if (polygon === null || polygon.length < 3 || Math.abs(ringArea(polygon)) < minArea) {
      problems.push({ code: 'lake-too-small', file: FILE, path: `constraints[${k}].radius`, message: `lake ${c.id} is too small for the grid` });
      continue;
    }
    newLakes.push(lakeFeature(c.id, polygon, c));
  }

  const features = [...lockedFeatures, ...newLand, ...seaLakes, ...newLakes];

  // A sea constraint that falls inside locked land cannot cut it: the locked land is untouchable.
  const lockedLandNow = lockedLand.map((f) => f.polygon);
  for (const [c, k] of seaCentres) {
    if (isNew(k) && lockedLandNow.some((polygon) => pointInPolygon(c.at, polygon))) {
      problems.push({ code: 'sea-in-locked-land', file: FILE, path: `constraints[${k}].at`, message: 'a new sea lies inside locked land and cannot cut it' });
    }
  }

  // Step 7: checks.
  const landPolygons = features.filter((f) => f.type === 'land' && isUsablePolygon(f.polygon)).map((f) => f.polygon);
  const lakePolygons = features.filter((f) => f.type === 'lake' && isUsablePolygon(f.polygon)).map((f) => f.polygon);
  list.forEach(([c, k]) => {
    if (c.kind === 'region' && isFinitePoint(c.at)) {
      const onLand = landPolygons.some((polygon) => pointInPolygon(c.at, polygon));
      const inLake = lakePolygons.some((polygon) => pointInPolygon(c.at, polygon));
      if (!onLand || inLake) {
        problems.push({ code: 'region-not-land', file: FILE, path: `constraints[${k}].at`, message: `region ${c.place} is not land at its centre` });
      }
    }
    if (c.kind === 'lake' && isFinitePoint(c.at) && !landPolygons.some((polygon) => pointInPolygon(c.at, polygon))) {
      problems.push({ code: 'lake-not-inland', file: FILE, path: `constraints[${k}].at`, message: `lake ${c.id} is not inside land` });
    }
  });
  const lockedPolygons = lockedLand.map((f) => f.polygon);
  newLand.forEach((feature) => {
    if (lockedPolygons.some((polygon) => vertexOverlap(feature.polygon, polygon))) {
      problems.push({ code: 'overlaps-locked-land', file: FILE, path: `features.${feature.id}`, message: `${feature.id} overlaps locked land` });
    }
  });

  return { features, problems };
}
