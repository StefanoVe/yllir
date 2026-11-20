// Walls generator of the urban atlas: turns the `wall` constraints into wall paths, towers and gates.
// A wall is either a closed `ring` (the path does not repeat its first point) or an open `path`.
// Towers: `corners` puts one at each vertex, `spaced` one every `towerSpacing` along the path (by arc
// length, starting at the first point), `none` puts none. Gates are snapped to the nearest point of
// the wall. Walls have no randomness: the same input gives the same output.
// Decisions: the spaced towers are placed at distances 0, s, 2s, ... along the path, up to its end
// (for a ring, up to but not including the start again); a gate width defaults to thickness * 2.5.
// Problems are { code, file, path, message }.

import { isFinitePoint } from '../geometry.mjs';
import { isPointList, isPlainObject } from '../landmask.mjs';
import { nearestOnPath, r1 } from './shapes.mjs';

const FILE = 'walls.json';
const TOWER_MODES = ['corners', 'spaced', 'none'];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Provenance, visibility and sources of a constraint, copied as the terrain layer does. */
function metaOf(constraint) {
  const sources = Array.isArray(constraint.sources) ? constraint.sources.map((s) => ({ ...s })) : [];
  const provenance = constraint.provenance === 'document' && sources.length === 0
    ? 'agent-choice'
    : (constraint.provenance ?? 'agent-choice');
  return { provenance, visibility: constraint.visibility ?? 'public', sources };
}

/** Returns the reason a wall constraint is unusable, or null when it is valid. */
function invalidReason(c) {
  if (typeof c.id !== 'string' || !KEBAB.test(c.id)) return 'a wall needs a kebab-case id';
  if (!(c.thickness > 0)) return 'a wall needs a thickness above zero';
  const hasRing = c.ring !== undefined;
  const hasPath = c.path !== undefined;
  if (hasRing === hasPath) return 'a wall needs exactly one of ring or path';
  if (hasRing && !isPointList(c.ring, 3)) return 'a ring needs at least three points';
  if (hasPath && !isPointList(c.path, 2)) return 'a path needs at least two points';
  if (c.towers !== undefined && !TOWER_MODES.includes(c.towers)) return 'towers must be corners, spaced or none';
  if (c.towerSpacing !== undefined && !(c.towerSpacing > 0)) return 'towerSpacing must be above zero';
  if (c.gates !== undefined) {
    if (!Array.isArray(c.gates)) return 'gates must be a list';
    for (const gate of c.gates) {
      if (!isPlainObject(gate) || !isFinitePoint(gate.at)) return 'each gate needs an at point';
      if (gate.width !== undefined && !(gate.width > 0)) return 'a gate width must be above zero';
    }
  }
  return null;
}

/** Distances along the path (in order) at which spaced towers stand. */
function spacedDistances(length, spacing, closed) {
  const out = [];
  for (let d = 0; closed ? d < length - 1e-9 : d <= length + 1e-9; d += spacing) out.push(d);
  return out;
}

/** Point at arc length `distance` along a polyline (clamped to its ends). */
function pointAtDistance(points, distance) {
  let remaining = distance;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (remaining <= len || i + 2 === points.length) {
      const t = len === 0 ? 0 : Math.min(1, remaining / len);
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    }
    remaining -= len;
  }
  return points[points.length - 1];
}

/** Polyline of the wall: the ring with its start appended (so segments close), or the open path. */
function polylineOf(path, closed) {
  return closed ? [...path, path[0]] : path;
}

/** Length of a polyline. */
function lengthOf(points) {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  return total;
}

/**
 * Generates the walls layer from its constraints.
 * @param {{ canvas?: { width: number, height: number }, seed?: number, constraints?: object[],
 *   layers?: Record<string, { features?: object[] }>, locked?: { features: object[], constraintCount: number } | null }} input
 * @returns {{ features: object[], problems: object[] }}
 */
export function generateWalls({ canvas, seed, constraints = [], layers = {}, locked = null } = {}) {
  const list = (Array.isArray(constraints) ? constraints : []).map((c, k) => [isPlainObject(c) ? c : {}, k]);
  const firstNew = locked ? locked.constraintCount : 0;
  const lockedFeatures = locked && Array.isArray(locked.features) ? locked.features.filter(isPlainObject) : [];
  const problems = [];
  const features = [...lockedFeatures];

  for (const [c, k] of list) {
    if (c.kind !== 'wall' || k < firstNew) continue;
    const path = `constraints[${k}]`;
    const reason = invalidReason(c);
    if (reason !== null) {
      problems.push({ code: 'bad-constraint', file: FILE, path, message: reason });
      continue;
    }

    const closed = c.ring !== undefined;
    const vertices = (closed ? c.ring : c.path).map(([x, y]) => [r1(x), r1(y)]);
    const meta = metaOf(c);
    const thickness = r1(c.thickness);
    const wallLine = polylineOf(vertices, closed);
    const towerRadius = r1(c.thickness * 1.6);

    features.push({ id: c.id, type: 'wall', path: vertices, closed, thickness, ...meta });

    // Towers.
    const mode = c.towers ?? 'corners';
    const towerAt = [];
    if (mode === 'corners') {
      for (const p of vertices) towerAt.push(p);
    } else if (mode === 'spaced') {
      const spacing = c.towerSpacing ?? 120;
      const total = lengthOf(wallLine);
      for (const d of spacedDistances(total, spacing, closed)) towerAt.push(pointAtDistance(wallLine, d).map(r1));
    }
    towerAt.forEach((at, index) => {
      features.push({ id: `${c.id}-tower-${index + 1}`, type: 'tower', at, radius: towerRadius, ...meta });
    });

    // Gates: snapped to the nearest point of the wall, facing along the wall segment there.
    (c.gates ?? []).forEach((gate, index) => {
      const nearest = nearestOnPath(gate.at, wallLine);
      features.push({
        id: `${c.id}-gate-${index + 1}`,
        type: 'gate',
        at: nearest.point,
        angle: nearest.angle,
        width: r1(gate.width ?? thickness * 2.5),
        ...meta,
      });
    });
  }

  return { features, problems };
}
