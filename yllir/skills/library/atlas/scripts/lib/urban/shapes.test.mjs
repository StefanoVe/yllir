import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  densify, smoothPath, bufferPath, blob, polygonArea, boundingBox, centroid, nearestOnPath,
  rectCorners, inAnyPolygon, pathPiecesOutside, pathPiecesInside, crossings, rectsOverlap,
} from './shapes.mjs';

const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]];
const FAR_SQUARE = [[100, 100], [110, 100], [110, 110], [100, 110]];

const maxSegment = (path) => Math.max(...path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1])));

test('densify keeps the original vertices and caps segment length', () => {
  const out = densify([[0, 0], [10, 0], [10, 3]], 2);
  assert.deepEqual(out[0], [0, 0]);
  assert.ok(out.some((p) => p[0] === 10 && p[1] === 0));
  assert.deepEqual(out[out.length - 1], [10, 3]);
  assert.ok(maxSegment(out) <= 2 + 0.1);
});

test('densify leaves a short path unchanged and handles a single point', () => {
  assert.deepEqual(densify([[1, 1], [2, 1]], 5), [[1, 1], [2, 1]]);
  assert.deepEqual(densify([[4, 4]], 2), [[4, 4]]);
  assert.deepEqual(densify([], 2), []);
});

test('smoothPath keeps the first and last points and adds points', () => {
  const path = [[0, 0], [10, 0], [10, 10]];
  const out = smoothPath(path, 2);
  assert.deepEqual(out[0], [0, 0]);
  assert.deepEqual(out[out.length - 1], [10, 10]);
  assert.ok(out.length > path.length);
});

test('smoothPath on a two-point path cuts it without moving the ends', () => {
  const out = smoothPath([[0, 0], [8, 0]], 1);
  assert.deepEqual(out, [[0, 0], [2, 0], [6, 0], [8, 0]]);
  assert.deepEqual(smoothPath([[0, 0], [8, 0]], 0), [[0, 0], [8, 0]]);
});

test('bufferPath returns a band of the given width around a straight path', () => {
  const band = bufferPath([[0, 0], [10, 0]], 4);
  assert.equal(band.length, 4);
  const ys = band.map((p) => p[1]).sort((a, b) => a - b);
  assert.deepEqual(ys, [-2, -2, 2, 2]);
  assert.deepEqual(band.map((p) => p[0]).sort((a, b) => a - b), [0, 0, 10, 10]);
});

test('bufferPath needs at least two distinct points', () => {
  assert.deepEqual(bufferPath([[1, 1]], 4), []);
  assert.deepEqual(bufferPath([[1, 1], [1, 1]], 4), []);
  assert.equal(bufferPath([[0, 0], [0, 10]], 2).length, 4);
});

test('blob is deterministic, closed in size and stays above 0.4 radius', () => {
  const a = blob({ at: [50, 50], radius: 20, seed: 7 });
  const b = blob({ at: [50, 50], radius: 20, seed: 7 });
  assert.deepEqual(a, b);
  assert.equal(a.length, 48);
  for (const p of a) {
    const d = Math.hypot(p[0] - 50, p[1] - 50);
    assert.ok(d >= 0.4 * 20 - 0.2 && d <= 20 * 1.175 + 0.2, `radius ${d} out of range`);
  }
});

test('blob with zero roughness is a circle of the given radius', () => {
  const out = blob({ at: [0, 0], radius: 10, roughness: 0, seed: 3, points: 8 });
  for (const p of out) assert.ok(Math.abs(Math.hypot(p[0], p[1]) - 10) < 0.2);
});

test('polygonArea returns the absolute area in both orientations', () => {
  assert.equal(polygonArea(SQUARE), 100);
  assert.equal(polygonArea([...SQUARE].reverse()), 100);
  assert.equal(polygonArea([]), 0);
});

test('boundingBox covers the points and is null for an empty list', () => {
  assert.deepEqual(boundingBox([[1, 2], [5, -3], [4, 9]]), { minX: 1, minY: -3, maxX: 5, maxY: 9 });
  assert.equal(boundingBox([]), null);
});

test('centroid is the area-weighted centre, and the vertex average for zero area', () => {
  assert.deepEqual(centroid(SQUARE), [5, 5]);
  const triangle = [[0, 0], [12, 0], [0, 12]];
  assert.deepEqual(centroid(triangle), [4, 4]);
  assert.deepEqual(centroid([[0, 0], [10, 0], [20, 0]]), [10, 0]);
});

test('nearestOnPath gives the closest point, segment index and segment angle', () => {
  const path = [[0, 0], [10, 0], [10, 10]];
  const near = nearestOnPath([14, 5], path);
  assert.deepEqual(near.point, [10, 5]);
  assert.equal(near.index, 1);
  assert.equal(near.distance, 4);
  assert.ok(Math.abs(near.angle - Math.PI / 2) < 1e-9);
  const first = nearestOnPath([3, -2], path);
  assert.equal(first.index, 0);
  assert.equal(first.angle, 0);
});

test('nearestOnPath handles a single point and an empty path', () => {
  assert.equal(nearestOnPath([0, 0], []), null);
  assert.deepEqual(nearestOnPath([3, 4], [[0, 0]]).distance, 5);
});

test('rectCorners returns the unrotated corners and the rotated ones', () => {
  assert.deepEqual(rectCorners({ at: [0, 0], size: [4, 2] }), [[-2, -1], [2, -1], [2, 1], [-2, 1]]);
  const rotated = rectCorners({ at: [10, 10], size: [4, 2], angle: Math.PI / 2 });
  assert.deepEqual(rotated[0], [11, 8]);
  assert.deepEqual(rotated[2], [9, 12]);
});

test('inAnyPolygon is true when one usable polygon contains the point', () => {
  assert.equal(inAnyPolygon([5, 5], [FAR_SQUARE, SQUARE]), true);
  assert.equal(inAnyPolygon([50, 50], [FAR_SQUARE, SQUARE]), false);
});

test('inAnyPolygon is false for an empty polygon list or unusable polygons', () => {
  assert.equal(inAnyPolygon([5, 5], []), false);
  assert.equal(inAnyPolygon([5, 5], [[[0, 0], [1, 1]]]), false);
});

test('pathPiecesOutside returns the whole path when there are no polygons', () => {
  const pieces = pathPiecesOutside([[0, 0], [10, 0]], [], 5);
  assert.equal(pieces.length, 1);
  assert.deepEqual(pieces[0][0], [0, 0]);
  assert.deepEqual(pieces[0][pieces[0].length - 1], [10, 0]);
});

test('pathPiecesOutside splits the path where it enters a polygon', () => {
  const pieces = pathPiecesOutside([[-10, 5], [20, 5]], [SQUARE], 1);
  assert.equal(pieces.length, 2);
  assert.ok(pieces[0][0][0] === -10 && pieces[0][pieces[0].length - 1][0] <= 0);
  assert.ok(pieces[1][0][0] >= 10 && pieces[1][pieces[1].length - 1][0] === 20);
  for (const piece of pieces) assert.ok(piece.length >= 2);
});

test('pathPiecesOutside drops pieces with fewer than two points', () => {
  const pieces = pathPiecesOutside([[2, 5], [8, 5]], [SQUARE], 1);
  assert.deepEqual(pieces, []);
});

test('pathPiecesInside keeps only the stretches inside one polygon', () => {
  const pieces = pathPiecesInside([[-10, 5], [20, 5]], SQUARE, 1);
  assert.equal(pieces.length, 1);
  assert.ok(pieces[0].every((p) => p[0] >= 0 && p[0] <= 10));
  assert.deepEqual(pathPiecesInside([[-10, 5], [20, 5]], [[0, 0], [1, 1]], 1), []);
});

test('crossings reports entry and exit of each stretch inside a polygon', () => {
  const found = crossings([[-10, 5], [20, 5]], [SQUARE, FAR_SQUARE], 1);
  assert.equal(found.length, 1);
  assert.equal(found[0].polygonIndex, 0);
  assert.equal(found[0].entry[0], 0);
  assert.equal(found[0].exit[0], 10);
});

test('crossings is empty for no polygons or a path that misses them', () => {
  assert.deepEqual(crossings([[-10, 5], [20, 5]], [], 1), []);
  assert.deepEqual(crossings([[-10, 50], [20, 50]], [SQUARE], 1), []);
});

test('rectsOverlap detects overlapping and separated rotated rectangles', () => {
  const a = { at: [0, 0], size: [10, 2], angle: 0 };
  assert.equal(rectsOverlap(a, { at: [4, 0], size: [10, 2], angle: 0 }), true);
  assert.equal(rectsOverlap(a, { at: [20, 0], size: [10, 2], angle: 0 }), false);
  // A long thin bar rotated 90 degrees crosses the horizontal one.
  assert.equal(rectsOverlap(a, { at: [0, 0], size: [10, 2], angle: Math.PI / 2 }), true);
  // A diamond (45 degrees) at (2, 2) has its near edge on x + y = 2.59, past the corner (1, 1) of the
  // axis-aligned square: the two fit side by side without overlap, though their boxes intersect.
  assert.equal(rectsOverlap({ at: [0, 0], size: [2, 2], angle: 0 }, { at: [2, 2], size: [2, 2], angle: Math.PI / 4 }), false);
  assert.equal(rectsOverlap({ at: [0, 0], size: [2, 2], angle: 0 }, { at: [1.5, 1.5], size: [2, 2], angle: Math.PI / 4 }), true);
});
