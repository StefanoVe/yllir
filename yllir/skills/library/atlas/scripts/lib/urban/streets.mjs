// Streets generator of the urban atlas: turns the `street`, `square` and `grid` constraints into
// street paths, squares and bridges. Streets are smoothed once (Chaikin, endpoints kept); the
// default width depends on the rank. Water comes from the ground layer (its `water` polygons).
// Lanes are cut where they run in water and the dry pieces keep the street's id (with `-<k>` only
// when there are several pieces). Main and secondary streets keep running across the water: each
// stretch over water gets a bridge `bridge-<street id>-<n>` from entry to exit, extended 4 units
// each side, `width` = street width + 2. Grid streets are clipped to the area, their ends jittered
// along their own line by the seeded generator (the ends stay inside the area), then treated like
// any other street. The same input and seed give the same output.
// Decisions: a piece cut out of a lane is dropped when shorter than 10 units; a lane with no water
// on it is kept as it is; the grid starts from the centre of the area's bounding box; a grid piece
// keeps only its two ends (straight lines), and the clip is exact to the sampling step (1 unit).
// Problems are { code, file, path, message }.

import { isFinitePoint, isUsablePolygon } from '../geometry.mjs';
import { isPointList, isPlainObject } from '../landmask.mjs';
import { mulberry32 } from '../noise.mjs';
import { subSeed } from '../scatter.mjs';
import {
  crossings, pathPiecesInside, pathPiecesOutside, rectCorners, r1, smoothPath, inAnyPolygon,
} from './shapes.mjs';

const FILE = 'streets.json';
const RANKS = ['main', 'secondary', 'lane'];
const GRID_RANKS = ['secondary', 'lane'];
const DEFAULT_WIDTH = { main: 14, secondary: 9, lane: 5 };
const MIN_PIECE = 10;
const BRIDGE_EXTENSION = 4;
const BRIDGE_EXTRA_WIDTH = 2;
const GRID_STEP = 1;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Provenance, visibility and sources of a constraint, copied as the terrain layer does. */
function metaOf(constraint) {
  const sources = Array.isArray(constraint.sources) ? constraint.sources.map((s) => ({ ...s })) : [];
  const provenance = constraint.provenance === 'document' && sources.length === 0
    ? 'agent-choice'
    : (constraint.provenance ?? 'agent-choice');
  return { provenance, visibility: constraint.visibility ?? 'public', sources };
}

/** Length of an open polyline. */
function lengthOf(points) {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  return total;
}

/** Returns the reason a constraint is unusable, or null when it is valid. */
function invalidReason(c) {
  if (typeof c.id !== 'string' || !KEBAB.test(c.id)) return 'a street needs a kebab-case id';
  if (c.kind === 'street') {
    if (!RANKS.includes(c.rank)) return 'a street rank must be main, secondary or lane';
    if (!isPointList(c.path, 2)) return 'a street needs a path of at least two points';
    if (c.width !== undefined && !(c.width > 0)) return 'a street width must be above zero';
  } else if (c.kind === 'square') {
    if (!isFinitePoint(c.at)) return 'a square needs an at point';
    if (!Array.isArray(c.size) || c.size.length !== 2 || !c.size.every((n) => n > 0)) return 'a square size must be two lengths above zero';
    if (c.angle !== undefined && !Number.isFinite(c.angle)) return 'a square angle must be a number';
  } else if (c.kind === 'grid') {
    if (!isPointList(c.area, 3) || !isUsablePolygon(c.area)) return 'a grid needs an area polygon of at least three points';
    if (!(c.spacing > 0)) return 'a grid needs a spacing above zero';
    if (c.angle !== undefined && !Number.isFinite(c.angle)) return 'a grid angle must be a number';
    if (c.jitter !== undefined && !(c.jitter >= 0 && c.jitter <= 1)) return 'a grid jitter must be between 0 and 1';
    if (c.rank !== undefined && !GRID_RANKS.includes(c.rank)) return 'a grid rank must be secondary or lane';
  }
  return null;
}

/**
 * Clips the family of lines through `centre` along `direction` (one line every `spacing` along
 * `across`) to the area. Each piece is a [start, end] pair, in line order.
 */
function clippedLines({ area, centre, direction, across, spacing, half }) {
  const pieces = [];
  const steps = Math.ceil(half / spacing);
  for (let k = -steps; k <= steps; k++) {
    const t = k * spacing;
    const mid = [centre[0] + across[0] * t, centre[1] + across[1] * t];
    const seg = [
      [mid[0] - direction[0] * half, mid[1] - direction[1] * half],
      [mid[0] + direction[0] * half, mid[1] + direction[1] * half],
    ];
    for (const piece of pathPiecesInside(seg, area, GRID_STEP)) {
      pieces.push({ direction, start: piece[0], end: piece[piece.length - 1] });
    }
  }
  return pieces;
}

/**
 * Generates the streets layer from its constraints.
 * @param {{ canvas?: { width: number, height: number }, seed: number, constraints?: object[],
 *   layers?: Record<string, { features?: object[] }>, locked?: { features: object[], constraintCount: number } | null }} input
 * @returns {{ features: object[], problems: object[] }}
 */
export function generateStreets({ canvas, seed, constraints = [], layers = {}, locked = null } = {}) {
  const list = (Array.isArray(constraints) ? constraints : []).map((c, k) => [isPlainObject(c) ? c : {}, k]);
  const firstNew = locked ? locked.constraintCount : 0;
  const lockedFeatures = locked && Array.isArray(locked.features) ? locked.features.filter(isPlainObject) : [];
  const water = (Array.isArray(layers.ground?.features) ? layers.ground.features : [])
    .filter((f) => isPlainObject(f) && f.type === 'water' && isUsablePolygon(f.polygon))
    .map((f) => f.polygon);
  const problems = [];
  const features = [...lockedFeatures];

  /** Adds one street (already smoothed or clipped) with its water cuts, or its bridges when it is main or secondary. */
  function placeStreet(street) {
    const { id, rank, width, path, meta } = street;
    if (rank === 'lane') {
      const pieces = crossings(path, water).length === 0
        ? [path]
        : pathPiecesOutside(path, water).filter((piece) => lengthOf(piece) >= MIN_PIECE);
      pieces.forEach((piece, index) => {
        const pieceId = pieces.length > 1 ? `${id}-${index + 1}` : id;
        features.push({ id: pieceId, type: 'street', rank, width, path: piece, ...meta });
      });
      return;
    }
    features.push({ id, type: 'street', rank, width, path, ...meta });
    crossings(path, water).forEach(({ entry, exit }, index) => {
      const dx = exit[0] - entry[0];
      const dy = exit[1] - entry[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return;
      const ux = dx / len;
      const uy = dy / len;
      const bridgePath = [
        [r1(entry[0] - ux * BRIDGE_EXTENSION), r1(entry[1] - uy * BRIDGE_EXTENSION)],
        [r1(exit[0] + ux * BRIDGE_EXTENSION), r1(exit[1] + uy * BRIDGE_EXTENSION)],
      ];
      features.push({ id: `bridge-${id}-${index + 1}`, type: 'bridge', path: bridgePath, width: r1(width + BRIDGE_EXTRA_WIDTH), ...meta });
    });
  }

  for (const [c, k] of list) {
    if (!['street', 'square', 'grid'].includes(c.kind) || k < firstNew) continue;
    const where = `constraints[${k}]`;
    const reason = invalidReason(c);
    if (reason !== null) {
      problems.push({ code: 'bad-constraint', file: FILE, path: where, message: reason });
      continue;
    }
    const meta = metaOf(c);

    if (c.kind === 'street') {
      const path = smoothPath(c.path, 1);
      const width = c.width ?? DEFAULT_WIDTH[c.rank];
      placeStreet({ id: c.id, rank: c.rank, width: r1(width), path, meta });
      continue;
    }

    if (c.kind === 'square') {
      features.push({ id: c.id, type: 'square', polygon: rectCorners({ at: c.at, size: c.size, angle: c.angle ?? 0 }), ...meta });
      continue;
    }

    // Grid: parallel lines of the angle, then the perpendicular ones, clipped to the area.
    const rank = c.rank ?? 'lane';
    const width = DEFAULT_WIDTH[rank];
    const jitter = c.jitter ?? 0.15;
    const angle = c.angle ?? 0;
    const along = [Math.cos(angle), Math.sin(angle)];
    const across = [-Math.sin(angle), Math.cos(angle)];
    const xs = c.area.map((p) => p[0]);
    const ys = c.area.map((p) => p[1]);
    const centre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const half = diagonal / 2 + c.spacing;
    const rand = mulberry32(subSeed(seed, c.id));
    const amplitude = jitter * c.spacing * 0.5;
    const lines = [
      ...clippedLines({ area: c.area, centre, direction: along, across, spacing: c.spacing, half }),
      ...clippedLines({ area: c.area, centre, direction: across, across: along, spacing: c.spacing, half }),
    ];
    let n = 0;
    for (const line of lines) {
      // Each end slides along its own line by up to `amplitude`; an end that would leave the area stays put.
      const slide = (point) => {
        const offset = (rand() * 2 - 1) * amplitude;
        const moved = [point[0] + line.direction[0] * offset, point[1] + line.direction[1] * offset];
        return inAnyPolygon(moved, [c.area]) ? moved : point;
      };
      const start = slide(line.start).map(r1);
      const end = slide(line.end).map(r1);
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-9) continue;
      n += 1;
      placeStreet({ id: `${c.id}-${n}`, rank, width, path: [start, end], meta });
    }
  }

  return { features, problems };
}
