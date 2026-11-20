// Ground generator of the urban atlas: the water constraints (river, coast, pond, canal) become
// water features, deterministically from the seed. Each constraint is seeded by its own id, so
// adding a constraint never changes the others. Every polygon is clipped to the canvas by clamping
// its points. A locked layer keeps its features first and unchanged; only constraints from index
// locked.constraintCount on add features. Problems are { code, file, path, message }, file ground.json.
// Decisions: constraints of other kinds are ignored; a constraint with bad input, a polygon with
// fewer than 3 points or under 100 square units (after clipping) gives a bad-constraint problem and
// no feature. The river meander moves the inner path points only, so source and mouth stay in place.
// The meander noise runs along the arc length (one noise unit per 150 canvas units).
// A constraint without a usable kebab-case id is a bad-constraint problem too.

import { isFinitePoint } from '../geometry.mjs';
import { fbm } from '../noise.mjs';
import { subSeed } from '../scatter.mjs';
import { blob, bufferPath, densify, polygonArea, r1, smoothPath } from './shapes.mjs';

const FILE = 'ground.json';
const KINDS = new Set(['river', 'coast', 'pond', 'canal']);
const SIDES = new Set(['north', 'south', 'east', 'west']);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MIN_AREA = 100;
const MEANDER_DEFAULT = 0.3;
const MEANDER_WAVE = 150;

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

function riverPolygon(c, seed, width, height) {
  need(isFinitePoint(c.source) && isFinitePoint(c.mouth), 'a river needs a source and a mouth point');
  const via = c.via ?? [];
  need(Array.isArray(via) && via.every(isFinitePoint), 'river via must be a list of points');
  need(Number.isFinite(c.width) && c.width > 0, 'river width must be a positive number');
  const meander = Number.isFinite(c.meander) ? clamp01(c.meander) : MEANDER_DEFAULT;
  const step = Math.max(width, height) / 60;
  const smooth = smoothPath(densify([c.source, ...via, c.mouth], step), 2);
  const amplitude = Math.max(width, height) * 0.04 * meander;
  const noise = subSeed(seed, c.id);
  let arc = 0;
  const meandered = smooth.map((p, i) => {
    if (i > 0) arc += Math.hypot(p[0] - smooth[i - 1][0], p[1] - smooth[i - 1][1]);
    if (i === 0 || i === smooth.length - 1) return p;
    const prev = smooth[i - 1];
    const next = smooth[i + 1];
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    const offset = amplitude * (2 * fbm(noise, arc / MEANDER_WAVE, 0.37) - 1);
    return [p[0] + (-ty / len) * offset, p[1] + (tx / len) * offset];
  });
  return bufferPath(meandered, c.width);
}

function coastPolygon(c, seed, width, height) {
  need(SIDES.has(c.side), 'coast side must be north, south, east or west');
  need(Number.isFinite(c.depth) && c.depth > 0, 'coast depth must be a positive number');
  const roughness = clamp01(Number.isFinite(c.roughness) ? c.roughness : 0.4);
  const horizontal = c.side === 'north' || c.side === 'south';
  const length = horizontal ? width : height;
  const count = Math.max(2, Math.ceil(length / (Math.max(width, height) / 120)));
  const noise = subSeed(seed, c.id);
  const pointAt = (t, offset) => {
    if (c.side === 'north') return [t, offset];
    if (c.side === 'south') return [t, height - offset];
    if (c.side === 'west') return [offset, t];
    return [width - offset, t];
  };
  const outer = [];
  const inner = [];
  for (let i = 0; i <= count; i++) {
    const t = (length * i) / count;
    const wave = 2 * fbm(noise, t / (Math.max(width, height) / 6), 0.37) - 1;
    const depth = Math.max(c.depth * 0.25, c.depth * (1 + roughness * 0.5 * wave));
    outer.push(pointAt(t, 0));
    inner.push(pointAt(t, depth));
  }
  return [...outer, ...inner.reverse()];
}

function pondPolygon(c, seed) {
  need(isFinitePoint(c.at), 'a pond needs an at point');
  need(Number.isFinite(c.radius) && c.radius > 0, 'pond radius must be a positive number');
  const roughness = Number.isFinite(c.roughness) ? clamp01(c.roughness) : 0.5;
  return blob({ at: c.at, radius: c.radius, roughness, seed: subSeed(seed, c.id) });
}

function canalPolygon(c) {
  need(Array.isArray(c.path) && c.path.length >= 2 && c.path.every(isFinitePoint), 'a canal needs a path of at least two points');
  need(Number.isFinite(c.width) && c.width > 0, 'canal width must be a positive number');
  return bufferPath(c.path, c.width);
}

const BUILDERS = {
  river: riverPolygon,
  coast: coastPolygon,
  pond: pondPolygon,
  canal: canalPolygon,
};

/**
 * Generates the ground layer (water only; the land is the rest of the canvas) from its constraints.
 * @param {{ canvas: { width: number, height: number }, seed: number, constraints?: object[],
 *   layers?: object, locked?: { features: object[], constraintCount: number } | null }} input
 * @returns {{ features: object[], problems: object[] }}
 */
export function generateGround({ canvas, seed, constraints = [], layers = {}, locked = null }) {
  const width = canvas.width;
  const height = canvas.height;
  const list = (Array.isArray(constraints) ? constraints : []).map((c, k) => [isPlainObject(c) ? c : {}, k]);
  const firstNew = locked ? locked.constraintCount : 0;
  const lockedFeatures = locked && Array.isArray(locked.features) ? locked.features.filter(isPlainObject) : [];
  const features = [...lockedFeatures];
  const problems = [];

  for (const [c, k] of list) {
    if (!KINDS.has(c.kind) || k < firstNew) continue;
    try {
      need(typeof c.id === 'string' && KEBAB.test(c.id), 'id must be kebab-case');
      const polygon = clipToCanvas(BUILDERS[c.kind](c, seed, width, height), width, height);
      need(polygon.length >= 3 && polygonArea(polygon) >= MIN_AREA, 'the polygon has fewer than 3 points or is under 100 square units');
      features.push({ id: c.id, type: 'water', kind: c.kind, polygon, ...metaOf(c) });
    } catch (error) {
      if (!(error instanceof BadConstraint)) throw error;
      problems.push({
        code: 'bad-constraint',
        file: FILE,
        path: `constraints[${k}]`,
        message: `${c.kind} ${c.id ?? ''}: ${error.message}`.trim(),
      });
    }
  }

  return { features, problems };
}
