import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marchingSquares, ringArea, simplify, smooth } from './contour.mjs';

function discField(width, height, cell, cx, cy, radius) {
  const gw = Math.ceil(width / cell) + 1;
  const gh = Math.ceil(height / cell) + 1;
  const field = new Float64Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const d = Math.hypot(i * cell - cx, j * cell - cy);
      field[j * gw + i] = 1 - d / radius;
    }
  }
  return { field, gw, gh };
}

test('marchingSquares on a circular field gives one ring with an area within 5% of pi r^2', () => {
  const cell = 1000 / 256;
  const radius = 300;
  const { field, gw, gh } = discField(1000, 1000, cell, 500, 500, radius);
  const rings = marchingSquares(field, gw, gh, cell, 0);
  assert.equal(rings.length, 1);
  const area = Math.abs(ringArea(rings[0]));
  const expected = Math.PI * radius * radius;
  assert.ok(Math.abs(area - expected) / expected < 0.05, `area ${area} vs ${expected}`);
});

test('ringArea is signed: reversing a ring flips its sign', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(ringArea(square), 100);
  assert.equal(ringArea([...square].reverse()), -100);
});

test('simplify keeps at least 3 points and the shape of a square', () => {
  const ring = [];
  for (let k = 0; k < 40; k++) ring.push([k * 0.5, 0]);
  ring.push([20, 0], [20, 20], [0, 20]);
  const out = simplify(ring, 0.1);
  assert.ok(out.length >= 3);
  assert.ok(Math.abs(Math.abs(ringArea(out)) - 400) < 1e-6);
  assert.ok(simplify([[0, 0], [1, 0], [0, 1]], 5).length >= 3);
});

test('smooth doubles the points each iteration', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(smooth(square, 1).length, 8);
  assert.equal(smooth(square, 2).length, 16);
});
