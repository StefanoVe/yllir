// Green generator of the urban atlas: each park constraint becomes a green feature (a noisy blob),
// deterministically from the seed; each constraint is seeded by its own id. A point of the blob that
// falls inside a water polygon of layers.ground is pulled toward `at` in steps of 10% of the remaining
// distance, up to 20 steps; if it is still in water after that, the point is dropped. Then the points
// are clamped into the canvas. A locked layer keeps its features first and unchanged; only constraints
// from index locked.constraintCount on add features. Constraints of other kinds are ignored.
// Problems are { code, file, path, message }, file green.json.
// Decisions: a park with fewer than 3 points left, bad input, or an id that is not kebab-case gives a
// bad-constraint problem and no feature. Only the vertices avoid water: the edges between two
// vertices are not tested.

import { isFinitePoint, isUsablePolygon } from '../geometry.mjs';
import { subSeed } from '../scatter.mjs';
import { blob, inAnyPolygon, r1 } from './shapes.mjs';

const FILE = 'green.json';
const TYPES = new Set(['park', 'garden', 'field', 'wood', 'orchard']);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_PULL_STEPS = 20;
const PULL_FRACTION = 0.1;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Raised for a constraint that cannot become a feature; the message goes into the problem. */
class BadConstraint extends Error {}

function need(condition, message) {
  if (!condition) throw new BadConstraint(message);
}

/** Clamps every point into the canvas, rounds to one decimal and clamps again (stable for whole-number bounds). */
function clipToCanvas(polygon, width, height) {
  const clamp = ([x, y]) => [Math.min(width, Math.max(0, x)), Math.min(height, Math.max(0, y))];
  return polygon
    .map(clamp)
    .map(([x, y]) => [r1(x), r1(y)])
    .map(clamp);
}

/** Provenance and visibility are copied from the constraint, as lib/terrain.mjs does for lakes. */
function metaOf(constraint) {
  const sources = Array.isArray(constraint.sources) ? constraint.sources.map((s) => ({ ...s })) : [];
  const provenance = constraint.provenance === 'document' && sources.length === 0
    ? 'agent-choice'
    : (constraint.provenance ?? 'agent-choice');
  const visibility = constraint.visibility === 'master' ? 'master' : 'public';
  return { provenance, visibility, sources };
}

/** The point moved toward `at` out of every water polygon, or null when it stays in water. */
function pullOutOfWater(point, at, water) {
  let p = point;
  for (let step = 0; step <= MAX_PULL_STEPS; step++) {
    if (!inAnyPolygon(p, water)) return p;
    if (step < MAX_PULL_STEPS) p = [p[0] + (at[0] - p[0]) * PULL_FRACTION, p[1] + (at[1] - p[1]) * PULL_FRACTION];
  }
  return null;
}

/**
 * Generates the green layer from its constraints. `layers.ground.features` (water polygons of
 * type water) is read to keep the green out of water.
 * @param {{ canvas: { width: number, height: number }, seed: number, constraints?: object[],
 *   layers?: object, locked?: { features: object[], constraintCount: number } | null }} input
 * @returns {{ features: object[], problems: object[] }}
 */
export function generateGreen({ canvas, seed, constraints = [], layers = {}, locked = null }) {
  const width = canvas.width;
  const height = canvas.height;
  const list = (Array.isArray(constraints) ? constraints : []).map((c, k) => [isPlainObject(c) ? c : {}, k]);
  const firstNew = locked ? locked.constraintCount : 0;
  const lockedFeatures = locked && Array.isArray(locked.features) ? locked.features.filter(isPlainObject) : [];
  const features = [...lockedFeatures];
  const problems = [];
  const groundFeatures = Array.isArray(layers?.ground?.features) ? layers.ground.features : [];
  const water = groundFeatures
    .filter((f) => isPlainObject(f) && f.type === 'water' && isUsablePolygon(f.polygon))
    .map((f) => f.polygon);

  for (const [c, k] of list) {
    if (c.kind !== 'park' || k < firstNew) continue;
    try {
      need(typeof c.id === 'string' && KEBAB.test(c.id), 'id must be kebab-case');
      need(TYPES.has(c.type), 'park type must be park, garden, field, wood or orchard');
      need(isFinitePoint(c.at), 'a park needs an at point');
      need(Number.isFinite(c.radius) && c.radius > 0, 'park radius must be a positive number');
      const roughness = Number.isFinite(c.roughness) ? clamp01(c.roughness) : 0.5;
      const raw = blob({ at: c.at, radius: c.radius, roughness, seed: subSeed(seed, c.id) });
      const dry = raw
        .map((p) => pullOutOfWater(p, c.at, water))
        .filter((p) => p !== null);
      const polygon = clipToCanvas(dry, width, height);
      need(polygon.length >= 3, 'fewer than 3 points are outside water');
      features.push({ id: c.id, type: c.type, polygon, ...metaOf(c) });
    } catch (error) {
      if (!(error instanceof BadConstraint)) throw error;
      problems.push({
        code: 'bad-constraint',
        file: FILE,
        path: `constraints[${k}]`,
        message: `park ${c.id ?? ''}: ${error.message}`.trim(),
      });
    }
  }

  return { features, problems };
}
