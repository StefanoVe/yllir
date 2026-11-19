// Water generator of the atlas: turns the `river` constraints into river paths that start on land
// and end at water, deterministically from the seed. Problems are { code, file, path, message }.

import { isFinitePoint, isUsablePolygon } from './geometry.mjs';
import { mulberry32 } from './noise.mjs';
import { landMask, gridOf, featureMeta, clampPoint, isPlainObject, isPointList } from './landmask.mjs';

const FILE = 'water.json';

/** Five rounds of midpoint displacement; the random numbers come in a fixed order from one generator. */
function meanderPath(points, meander, rand) {
  let path = points;
  for (let round = 0; round < 5; round++) {
    const next = [];
    for (let k = 0; k + 1 < path.length; k++) {
      const [ax, ay] = path[k];
      const [bx, by] = path[k + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const mid = [(ax + bx) / 2, (ay + by) / 2];
      const nx = len === 0 ? 0 : -(by - ay) / len;
      const ny = len === 0 ? 0 : (bx - ax) / len;
      const offset = meander * 0.18 * len * (rand() * 2 - 1);
      next.push([ax, ay], [mid[0] + nx * offset, mid[1] + ny * offset]);
    }
    next.push(path[path.length - 1]);
    path = next;
  }
  return path;
}

/**
 * Generates the water layer from the river constraints. Lakes come from the terrain layer only.
 * @param {{ canvas: { width: number, height: number }, seed: number, constraints?: object[],
 *   layers?: Record<string, { features?: object[] }>, locked?: { features: object[], constraintCount: number } | null }} input
 * @returns {{ features: object[], problems: object[] }}
 */
export function generateWater({ canvas, seed, constraints = [], layers = {}, locked = null }) {
  const grid = gridOf(canvas);
  const { cell } = grid;
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

  const features = [];
  for (const [c, k] of list) {
    if (c.kind !== 'river' || k < firstNew) continue;
    const path = `constraints[${k}]`;
    const meander = typeof c.meander === 'number' ? c.meander : 0.5;
    if (!isFinitePoint(c.source) || !isFinitePoint(c.mouth) || !(c.via === undefined || isPointList(c.via))) {
      problems.push({ code: 'bad-constraint', file: FILE, path, message: `river ${c.id} needs a source, a mouth and optional via points` });
      continue;
    }

    const control = [c.source, ...(c.via ?? []), c.mouth];
    const rand = mulberry32(seed + k + 51);
    const points = meanderPath(control, meander, rand).map((p) => clampPoint(p, canvas));

    let failed = false;
    if (!mask.isLand(c.source[0], c.source[1])) {
      problems.push({ code: 'river-source-not-land', file: FILE, path: `${path}.source`, message: `river ${c.id} starts at sea` });
      failed = true;
    }
    if (mask.waterDistance(c.mouth[0], c.mouth[1]) > cell * 3) {
      problems.push({ code: 'river-mouth-not-water', file: FILE, path: `${path}.mouth`, message: `river ${c.id} ends inland, away from water` });
      failed = true;
    }
    // The last 4 percent of the points (at least one) may reach the water; the rest may not.
    const tail = Math.ceil(points.length * 0.04);
    const crosses = points.slice(0, points.length - tail).some(([x, y]) => mask.isWater(x, y));
    if (crosses) {
      problems.push({ code: 'river-crosses-sea', file: FILE, path, message: `river ${c.id} runs through the sea or a lake before its mouth` });
      failed = true;
    }
    if (failed) continue;

    features.push({ id: c.id, type: 'river', path: points, ...featureMeta(c) });
  }

  return { features: [...lockedFeatures, ...features], problems };
}
