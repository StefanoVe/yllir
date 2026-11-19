// Deterministic noise for the atlas: a seeded generator and smooth value noise.
// Same seed and same input give the same output. No Math.random anywhere.

/**
 * Seeded generator (mulberry32). Each call returns a float in [0, 1).
 * @param {number} seed integer
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer avalanche hash, 32 bits. */
function mix(value) {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Value of one lattice corner, in [0, 1). */
function lattice(seed, ix, iy) {
  const h = mix(mix(mix(seed) ^ Math.imul(ix | 0, 0x27d4eb2d)) ^ Math.imul(iy | 0, 0x165667b1));
  return h / 4294967296;
}

const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Smooth 2D value noise: the lattice corners around (x, y) are hashed from (seed, ix, iy),
 * then interpolated with smoothstep.
 * @returns {number} in [0, 1]
 */
export function valueNoise2d(seed, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const a = lattice(seed, x0, y0);
  const b = lattice(seed, x0 + 1, y0);
  const c = lattice(seed, x0, y0 + 1);
  const d = lattice(seed, x0 + 1, y0 + 1);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

/**
 * Fractal noise: a sum of value-noise octaves, normalised to [0, 1].
 * @param {number} seed
 * @param {number} x
 * @param {number} y
 * @param {{ octaves?: number, lacunarity?: number, gain?: number }} [options]
 */
export function fbm(seed, x, y, { octaves = 5, lacunarity = 2, gain = 0.5 } = {}) {
  let sum = 0;
  let norm = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise2d(seed + o * 1013, x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return norm === 0 ? 0 : sum / norm;
}

/**
 * Domain warp: moves the point (x, y) by up to `amplitude` in each direction, using two fbm fields.
 * The warp is smooth, so it bends outlines without tearing them.
 * @returns {[number, number]}
 */
export function warp(seed, x, y, scale, amplitude) {
  const u = fbm(seed + 101, x / scale, y / scale);
  const v = fbm(seed + 202, x / scale, y / scale);
  return [x + amplitude * (u - 0.5) * 2, y + amplitude * (v - 0.5) * 2];
}
