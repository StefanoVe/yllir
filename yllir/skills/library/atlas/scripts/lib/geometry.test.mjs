import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointInPolygon, vertexOverlap, canonicalJson, sha256, featureHash, isFinitePoint, isUsablePolygon,
} from './geometry.mjs';

const SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]];

test('pointInPolygon: inside, outside and on the edge', () => {
  assert.equal(pointInPolygon([5, 5], SQUARE), true);
  assert.equal(pointInPolygon([15, 5], SQUARE), false);
  assert.equal(pointInPolygon([10, 5], SQUARE), true, 'a point on an edge is inside');
  assert.equal(pointInPolygon([0, 0], SQUARE), true, 'a vertex is inside');
});

test('pointInPolygon: concave polygon', () => {
  const notch = [[0, 0], [10, 0], [10, 10], [5, 5], [0, 10]];
  assert.equal(pointInPolygon([2, 8], notch), true);
  assert.equal(pointInPolygon([5, 8], notch), false, 'inside the notch');
});

test('vertexOverlap: a vertex of either polygon inside the other', () => {
  const inner = [[2, 2], [4, 2], [4, 4]];
  const far = [[20, 20], [30, 20], [30, 30]];
  assert.equal(vertexOverlap(inner, SQUARE), true);
  assert.equal(vertexOverlap(SQUARE, inner), true);
  assert.equal(vertexOverlap(far, SQUARE), false);
});

test('canonicalJson sorts keys recursively and keeps array order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, 1], c: null } }), '{"a":{"c":null,"d":[2,1]},"b":1}');
});

test('featureHash does not depend on key order, but depends on content', () => {
  const one = { id: 'x', type: 'land', polygon: SQUARE };
  const two = { polygon: SQUARE, type: 'land', id: 'x' };
  assert.equal(featureHash(one), featureHash(two));
  assert.notEqual(featureHash(one), featureHash({ ...one, type: 'lake' }));
});

test('sha256 gives the hex digest of the text', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('isFinitePoint and isUsablePolygon reject malformed values', () => {
  assert.equal(isFinitePoint([1, 2]), true);
  assert.equal(isFinitePoint([1]), false);
  assert.equal(isFinitePoint([1, Number.NaN]), false);
  assert.equal(isUsablePolygon(SQUARE), true);
  assert.equal(isUsablePolygon([[0, 0], [1, 1]]), false);
});
