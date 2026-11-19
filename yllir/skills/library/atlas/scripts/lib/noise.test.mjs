import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, valueNoise2d, fbm } from './noise.mjs';

test('mulberry32 gives the same floats for the same seed, in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const first = Array.from({ length: 20 }, () => a());
  assert.deepEqual(first, Array.from({ length: 20 }, () => b()));
  assert.ok(first.every((v) => v >= 0 && v < 1));
});

test('valueNoise2d and fbm give the same output for the same inputs', () => {
  assert.equal(valueNoise2d(7, 3.25, -1.5), valueNoise2d(7, 3.25, -1.5));
  assert.equal(fbm(7, 12.5, 4.75), fbm(7, 12.5, 4.75));
});

test('a different seed gives a different output', () => {
  assert.notEqual(valueNoise2d(7, 3.25, 1.5), valueNoise2d(8, 3.25, 1.5));
  assert.notEqual(fbm(7, 12.5, 4.75), fbm(8, 12.5, 4.75));
});

test('valueNoise2d and fbm stay in [0, 1] over 1000 samples', () => {
  const rng = mulberry32(99);
  for (let n = 0; n < 1000; n++) {
    const x = (rng() - 0.5) * 500;
    const y = (rng() - 0.5) * 500;
    const v = valueNoise2d(3, x, y);
    const f = fbm(3, x, y);
    assert.ok(v >= 0 && v <= 1, `valueNoise2d out of range: ${v}`);
    assert.ok(f >= 0 && f <= 1, `fbm out of range: ${f}`);
  }
});
