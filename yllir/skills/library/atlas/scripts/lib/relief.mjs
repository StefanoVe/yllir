// Relief generator of the atlas: turns the `range` constraints into mountain and hill polygons,
// deterministically from the seed, on land only. Problems are { code, file, path, message }.

import { isUsablePolygon } from './geometry.mjs';
import { fbm } from './noise.mjs';
import {
  landMask, gridOf, coverOf, contourPolygons, featureMeta, pieceFeatures, isPlainObject, polygonsOf, isPointList,
} from './landmask.mjs';

const FILE = 'relief.json';
const TYPES = ['mountains', 'hills'];

/** Distance from a point to a polyline (list of points). */
function distanceToPolyline(p, points) {
  let best = Infinity;
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, ay] = points[k];
    const [bx, by] = points[k + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return best;
}

/**
 * Generates the relief layer from the range constraints.
 * @param {{ canvas: { width: number, height: number }, seed: number, constraints?: object[],
 *   layers?: Record<string, { features?: object[] }>, locked?: { features: object[], constraintCount: number } | null }} input
 * @returns {{ features: object[], problems: object[] }}
 */
export function generateRelief({ canvas, seed, constraints = [], layers = {}, locked = null }) {
  const grid = gridOf(canvas);
  const { cell, gw, gh } = grid;
  const list = (Array.isArray(constraints) ? constraints : []).map((c, k) => [isPlainObject(c) ? c : {}, k]);
  const firstNew = locked ? locked.constraintCount : 0;
  const lockedFeatures = locked && Array.isArray(locked.features) ? locked.features.filter(isPlainObject) : [];
  const problems = [];

  const hasLand = (layers.terrain?.features ?? []).some((f) => isPlainObject(f) && f.type === 'land' && isUsablePolygon(f.polygon));
  if (!hasLand) {
    return {
      features: [],
      problems: [{ code: 'missing-prerequisite', file: FILE, path: '', message: 'the terrain layer has no land: generate terrain first' }],
    };
  }
  const mask = landMask({ canvas, terrain: layers.terrain });
  const lockedCover = coverOf(lockedFeatures.flatMap(polygonsOf), grid);

  const features = [];
  for (const [c, k] of list) {
    if (c.kind !== 'range' || k < firstNew) continue;
    const path = `constraints[${k}]`;
    const roughness = typeof c.roughness === 'number' ? c.roughness : 0.5;
    if (!TYPES.includes(c.type) || !isPointList(c.spine, 2) || !(c.width > 0)) {
      problems.push({ code: 'bad-constraint', file: FILE, path, message: `range ${c.id} needs a type, a spine of two points and a width` });
      continue;
    }

    // Field: positive inside the band around the spine; forced negative off land, on the coast and under locked relief.
    const field = new Float64Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = i * cell;
        const y = j * cell;
        const index = j * gw + i;
        const noise = (fbm(seed + k + 31, x / (cell * 10), y / (cell * 10), { octaves: 5 }) - 0.5) * 2;
        const v = 1 - distanceToPolyline([x, y], c.spine) / (c.width / 2) + roughness * 0.35 * noise;
        const blocked = mask.kind[index] !== 1 || mask.coastDistance[index] < cell * 2 || lockedCover[index] === 1;
        field[index] = blocked ? -1 : v;
      }
    }

    const polygons = contourPolygons(field, grid);
    if (polygons.length === 0) {
      problems.push({ code: 'range-not-on-land', file: FILE, path, message: `range ${c.id} has no part on land` });
      continue;
    }
    features.push(...pieceFeatures(c.id, polygons, c.type, featureMeta(c)));
  }

  return { features: [...lockedFeatures, ...features], problems };
}
