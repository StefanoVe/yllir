// Shared geometry helpers for the urban generators (settlement, district). Pure functions on
// points [x, y] in canvas coordinates (y grows downwards). Coordinates, lengths and areas are
// rounded to one decimal; angles are raw radians.
// Decisions: bufferPath returns [] for fewer than two distinct points; boundingBox returns null
// for an empty list; crossings only reports stretches with at least two points inside.

import { isUsablePolygon, pointInPolygon } from '../geometry.mjs';
import { ringArea } from '../contour.mjs';
import { fbm } from '../noise.mjs';

const EPSILON = 1e-9;

/** Rounds to one decimal. */
export const r1 = (value) => Math.round(value * 10) / 10;

const copyPoint = (p) => [p[0], p[1]];
const roundPoint = (p) => [r1(p[0]), r1(p[1])];

/** Removes consecutive duplicate points (copies the rest). */
function distinctConsecutive(path) {
  const out = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > EPSILON) out.push(copyPoint(p));
  }
  return out;
}

/** Open path resampled so that no segment is longer than `step` (rounded), keeping the original vertices. */
export function densify(path, step) {
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const [x0, y0] = path[i];
    if (i === path.length - 1) {
      out.push(roundPoint([x0, y0]));
      break;
    }
    const [x1, y1] = path[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const parts = step > 0 ? Math.max(1, Math.ceil(len / step)) : 1;
    for (let k = 0; k < parts; k++) {
      const t = k / parts;
      out.push(roundPoint([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]));
    }
  }
  return out;
}

/** Chaikin corner cutting on an open path; the first and last points are kept. */
export function smoothPath(path, iterations = 2) {
  let current = path.map(copyPoint);
  for (let round = 0; round < iterations && current.length >= 2; round++) {
    const next = [copyPoint(current[0])];
    for (let i = 0; i < current.length - 1; i++) {
      const [px, py] = current[i];
      const [qx, qy] = current[i + 1];
      next.push([0.75 * px + 0.25 * qx, 0.75 * py + 0.25 * qy], [0.25 * px + 0.75 * qx, 0.25 * py + 0.75 * qy]);
    }
    next.push(copyPoint(current[current.length - 1]));
    current = next;
  }
  return current.map(roundPoint);
}

/**
 * Polygon around an open path, `width / 2` on each side. Each vertex moves along the average of
 * the normals of its two segments (scaled so the band keeps its width, capped at a 2x miter);
 * the ends are flat. Returns the left side forward, then the right side reversed.
 * Returns [] when the path has fewer than two distinct points.
 */
export function bufferPath(path, width) {
  const pts = distinctConsecutive(path);
  if (pts.length < 2) return [];
  const half = width / 2;
  const normals = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    normals.push([-dy / len, dx / len]);
  }
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    let offset;
    if (i === 0) {
      offset = [normals[0][0] * half, normals[0][1] * half];
    } else if (i === pts.length - 1) {
      const n = normals[normals.length - 1];
      offset = [n[0] * half, n[1] * half];
    } else {
      const a = normals[i - 1];
      const b = normals[i];
      const sx = a[0] + b[0];
      const sy = a[1] + b[1];
      const slen = Math.hypot(sx, sy);
      const m = slen < EPSILON ? b : [sx / slen, sy / slen];
      const cos = Math.max(m[0] * b[0] + m[1] * b[1], 0.5);
      const scale = half / cos;
      offset = [m[0] * scale, m[1] * scale];
    }
    const [x, y] = pts[i];
    left.push(roundPoint([x + offset[0], y + offset[1]]));
    right.push(roundPoint([x - offset[0], y - offset[1]]));
  }
  return [...left, ...right.reverse()];
}

/**
 * Closed noisy polygon around `at`. The radius varies with fbm sampled on a circle in noise space,
 * so the outline closes smoothly. Variation is up to roughness * 0.35 * radius, never below 0.4 * radius.
 */
export function blob({ at, radius, roughness = 0.5, seed, points = 48 }) {
  const out = [];
  for (let i = 0; i < points; i++) {
    const angle = (2 * Math.PI * i) / points;
    const f = fbm(seed, 10 + 1.5 * Math.cos(angle), 10 + 1.5 * Math.sin(angle));
    const r = Math.max(0.4 * radius, radius + (2 * f - 1) * roughness * 0.35 * radius);
    out.push(roundPoint([at[0] + r * Math.cos(angle), at[1] + r * Math.sin(angle)]));
  }
  return out;
}

/** Absolute area of a polygon (rounded). */
export function polygonArea(polygon) {
  return r1(Math.abs(ringArea(polygon)));
}

/** Axis-aligned bounding box of a point list, or null when the list is empty. */
export function boundingBox(polygon) {
  if (polygon.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX: r1(minX), minY: r1(minY), maxX: r1(maxX), maxY: r1(maxY) };
}

/** Area-weighted centroid; the vertex average when the area is zero. */
export function centroid(polygon) {
  const area = ringArea(polygon);
  if (Math.abs(area) < EPSILON) {
    const n = polygon.length || 1;
    const sum = polygon.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return roundPoint([sum[0] / n, sum[1] / n]);
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return roundPoint([cx / (6 * area), cy / (6 * area)]);
}

/**
 * Closest point of an open path to `point`. `index` is the segment index, `angle` the direction
 * of that segment (atan2, radians). Returns null for an empty path.
 */
export function nearestOnPath(point, path) {
  if (path.length === 0) return null;
  if (path.length === 1) {
    return { point: roundPoint(path[0]), index: 0, distance: r1(Math.hypot(point[0] - path[0][0], point[1] - path[0][1])), angle: 0 };
  }
  let best = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2));
    const px = a[0] + t * dx;
    const py = a[1] + t * dy;
    const distance = Math.hypot(point[0] - px, point[1] - py);
    if (best === null || distance < best.distance) {
      best = { point: [px, py], index: i, distance, angle: Math.atan2(dy, dx) };
    }
  }
  return { point: roundPoint(best.point), index: best.index, distance: r1(best.distance), angle: best.angle };
}

/** Four corners of a rectangle centred on `at`, size [w, h], rotated by `angle` (radians). */
export function rectCorners({ at, size, angle = 0 }) {
  const hw = size[0] / 2;
  const hh = size[1] / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => roundPoint([
    at[0] + x * c - y * s,
    at[1] + x * s + y * c,
  ]));
}

/** True when the point is inside (or on the edge of) at least one usable polygon. */
export function inAnyPolygon(point, polygons) {
  return polygons.some((polygon) => isUsablePolygon(polygon) && pointInPolygon(point, polygon));
}

/** Maximal runs of consecutive densified points that satisfy `keep`, each with at least two points. */
function runsWhere(path, step, keep) {
  const dense = densify(path, step);
  const pieces = [];
  let current = [];
  for (const p of dense) {
    if (keep(p)) {
      current.push(p);
    } else {
      if (current.length >= 2) pieces.push(current);
      current = [];
    }
  }
  if (current.length >= 2) pieces.push(current);
  return pieces;
}

/** Pieces (in path order, at least two points each) of the densified path that lie outside every polygon. */
export function pathPiecesOutside(path, polygons, step = 2) {
  return runsWhere(path, step, (p) => !inAnyPolygon(p, polygons));
}

/** Pieces of the densified path that lie inside one polygon. An unusable polygon contains nothing. */
export function pathPiecesInside(path, polygon, step = 2) {
  if (!isUsablePolygon(polygon)) return [];
  return runsWhere(path, step, (p) => pointInPolygon(p, polygon));
}

/**
 * Stretches of the densified path inside each polygon: `{ polygonIndex, entry, exit }`, where entry
 * and exit are the first and last inside points. Sorted by position along the path.
 */
export function crossings(path, polygons, step = 2) {
  const dense = densify(path, step);
  const found = [];
  polygons.forEach((polygon, polygonIndex) => {
    if (!isUsablePolygon(polygon)) return;
    let start = -1;
    for (let i = 0; i <= dense.length; i++) {
      const inside = i < dense.length && pointInPolygon(dense[i], polygon);
      if (inside && start === -1) start = i;
      if (!inside && start !== -1) {
        if (i - start >= 2) {
          found.push({ start, polygonIndex, entry: dense[start], exit: dense[i - 1] });
        }
        start = -1;
      }
    }
  });
  found.sort((a, b) => a.start - b.start || a.polygonIndex - b.polygonIndex);
  return found.map(({ polygonIndex, entry, exit }) => ({ polygonIndex, entry, exit }));
}

/** Separating axis test for two rotated rectangles `{ at, size, angle }`. Touching edges do not overlap. */
export function rectsOverlap(a, b) {
  const axes = [a.angle ?? 0, b.angle ?? 0].flatMap((angle) => [
    [Math.cos(angle), Math.sin(angle)],
    [-Math.sin(angle), Math.cos(angle)],
  ]);
  const dx = b.at[0] - a.at[0];
  const dy = b.at[1] - a.at[1];
  const extent = (rect, [ux, uy]) => {
    const c = Math.cos(rect.angle ?? 0);
    const s = Math.sin(rect.angle ?? 0);
    const hw = rect.size[0] / 2;
    const hh = rect.size[1] / 2;
    return hw * Math.abs(c * ux + s * uy) + hh * Math.abs(-s * ux + c * uy);
  };
  return axes.every((axis) => {
    const distance = Math.abs(dx * axis[0] + dy * axis[1]);
    return distance < extent(a, axis) + extent(b, axis) - EPSILON;
  });
}
