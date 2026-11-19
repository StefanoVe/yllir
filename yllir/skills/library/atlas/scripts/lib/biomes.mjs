// Biome generator of the atlas: turns the `biome` constraints into forest, swamp, desert, ice and
// grassland polygons, deterministically from the seed, on land only and, by default, off the
// mountains. Problems are { code, file, path, message }.

import { isFinitePoint, isUsablePolygon } from './geometry.mjs';
import { fbm } from './noise.mjs';
import {
  landMask, gridOf, coverOf, grow, contourPolygons, featureMeta, pieceFeatures, isPlainObject, polygonsOf,
} from './landmask.mjs';

const FILE = 'biomes.json';
const TYPES = ['forest', 'swamp', 'desert', 'ice', 'grassland'];
// A forest may say which trees it has: conifer (needles) or broadleaf (deciduous).
const VARIANTS = ['conifer', 'broadleaf'];
// Biomes keep this many grid cells away from mountains, so that the two simplified outlines never touch.
const MOUNTAIN_MARGIN = 2;

/**
 * Generates the biomes layer from the biome constraints.
 * @param {{ canvas: { width: number, height: number }, seed: number, constraints?: object[],
 *   layers?: Record<string, { features?: object[] }>, locked?: { features: object[], constraintCount: number } | null }} input
 * @returns {{ features: object[], problems: object[] }}
 */
export function generateBiomes({ canvas, seed, constraints = [], layers = {}, locked = null }) {
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
  const mountainCover = grow(coverOf(
    (layers.relief?.features ?? []).filter((f) => isPlainObject(f) && f.type === 'mountains').flatMap(polygonsOf),
    grid,
  ), gw, gh, MOUNTAIN_MARGIN);
  const lockedCover = coverOf(lockedFeatures.flatMap(polygonsOf), grid);

  const features = [];
  for (const [c, k] of list) {
    if (c.kind !== 'biome' || k < firstNew) continue;
    const path = `constraints[${k}]`;
    const roughness = typeof c.roughness === 'number' ? c.roughness : 0.5;
    const avoidRelief = c.avoidRelief !== false;
    if (!TYPES.includes(c.type) || !isFinitePoint(c.at) || !(c.radius > 0)) {
      problems.push({ code: 'bad-constraint', file: FILE, path, message: `biome ${c.id} needs a type, a point and a radius` });
      continue;
    }
    if (c.variant !== undefined && (c.type !== 'forest' || !VARIANTS.includes(c.variant))) {
      problems.push({ code: 'bad-constraint', file: FILE, path, message: `biome ${c.id} takes a variant only as a forest: conifer or broadleaf` });
      continue;
    }
    const avoidMountains = avoidRelief && c.type !== 'ice';

    // Field: positive within about one radius of the centre, with two noise terms on the edge.
    const field = new Float64Array(gw * gh);
    const r = c.radius;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const x = i * cell;
        const y = j * cell;
        const index = j * gw + i;
        const d = Math.hypot(x - c.at[0], y - c.at[1]) / r;
        const big = (fbm(seed + k + 41, x / (r * 0.6), y / (r * 0.6), { octaves: 4 }) - 0.5) * 2;
        const fine = (fbm(seed + k + 41, x / (cell * 10), y / (cell * 10), { octaves: 6 }) - 0.5) * 2;
        const v = 1 - d + roughness * 0.45 * big + roughness * 0.18 * fine;
        const blocked = mask.kind[index] !== 1
          || lockedCover[index] === 1
          || (avoidMountains && mountainCover[index] === 1);
        field[index] = blocked ? -1 : v;
      }
    }

    const polygons = contourPolygons(field, grid);
    if (polygons.length === 0) {
      problems.push({ code: 'biome-not-on-land', file: FILE, path, message: `biome ${c.id} has no part on land` });
      continue;
    }
    // The variant of a forest is copied onto each of its pieces.
    const variant = c.type === 'forest' && c.variant !== undefined ? { variant: c.variant } : {};
    features.push(...pieceFeatures(c.id, polygons, c.type, { ...featureMeta(c), ...variant }));
  }

  return { features: [...lockedFeatures, ...features], problems };
}
