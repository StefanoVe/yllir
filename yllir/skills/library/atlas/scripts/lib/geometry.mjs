// Pure geometry and hashing helpers of the atlas. No file access.

import { createHash } from 'node:crypto';

const EPSILON = 1e-9;

/** True when a value is a point: an array of exactly two finite numbers. */
export function isFinitePoint(value) {
  return Array.isArray(value) && value.length === 2 && value.every((n) => Number.isFinite(n));
}

/** True when a value is a polygon with at least three finite points. */
export function isUsablePolygon(value) {
  return Array.isArray(value) && value.length >= 3 && value.every(isFinitePoint);
}

function onSegment(point, a, b) {
  const [px, py] = point;
  const cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  if (Math.abs(cross) > EPSILON) return false;
  return px >= Math.min(a[0], b[0]) - EPSILON && px <= Math.max(a[0], b[0]) + EPSILON
    && py >= Math.min(a[1], b[1]) - EPSILON && py <= Math.max(a[1], b[1]) + EPSILON;
}

/**
 * Even-odd ray casting. A point exactly on an edge counts as inside.
 * @param {number[]} point [x, y]
 * @param {number[][]} polygon list of [x, y]
 * @returns {boolean}
 */
export function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (onSegment(point, b, a)) return true;
    const crosses = (a[1] > y) !== (b[1] > y);
    if (crosses && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * Two polygons overlap when a vertex of one lies inside the other (edge included),
 * in either direction. Crossing edges without any inside vertex are not detected.
 */
export function vertexOverlap(polygonA, polygonB) {
  return polygonA.some((p) => pointInPolygon(p, polygonB))
    || polygonB.some((p) => pointInPolygon(p, polygonA));
}

/** JSON with object keys sorted recursively, arrays in order, no whitespace. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Hex SHA-256 digest of a text. */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Digest of one feature, independent of the key order of its object. */
export function featureHash(feature) {
  return sha256(canonicalJson(feature));
}
