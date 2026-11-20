// Territories of the atlas: masks computed from the land mask and the territory rules, outline
// paths for the exporter, area and a label position. Pure functions, no file access, no dependencies.
// Masks are { width, height, data } with data a Uint8Array of 0/1, origin top-left (see mask.mjs).

import {
  components,
  countOnes,
  intersectMasks,
  newMask,
  polygonMask,
  subtractMasks,
  unionMasks,
} from './mask.mjs';
import { marchingSquares, ringArea, simplify, smooth } from './contour.mjs';

/** Rings whose area, in pixels, is below this value are dropped (specks and noise). */
const MIN_RING_AREA = 20;

/** Union of the masks of several polygons; an empty or missing list gives an empty mask. */
function polygonUnion(width, height, polygons) {
  let mask = newMask(width, height);
  for (const points of polygons ?? []) {
    mask = unionMasks(mask, polygonMask(width, height, points));
  }
  return mask;
}

/** Seed rounded to integer pixels; throws when it is not a pair of finite numbers. */
function roundedSeed(id, seed) {
  const x = Array.isArray(seed) ? Math.round(seed[0]) : Number.NaN;
  const y = Array.isArray(seed) ? Math.round(seed[1]) : Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`territory ${id}: seed ${JSON.stringify(seed)} is not a point [x,y]`);
  }
  return [x, y];
}

/**
 * Masks of every territory, in array order.
 * For each territory: land minus its `separate` polygons gives the cut land; the components of the
 * cut that contain a seed form the base; then `add` polygons are united, `remove` polygons are
 * subtracted, the masks of the earlier territories listed in `subtract` are subtracted, and the
 * result is intersected with the land so that no border crosses the sea.
 * @param {{width: number, height: number, data: Uint8Array}} landMask 1 = land
 * @param {object[]} territories [{ id, seeds, separate, add, remove, subtract }]
 * @returns {Map<string, {width: number, height: number, data: Uint8Array}>}
 */
export function computeTerritories(landMask, territories) {
  const { width, height } = landMask;
  const result = new Map();
  for (const territory of territories ?? []) {
    const { id } = territory;
    if (result.has(id)) throw new Error(`territory ${id}: duplicate id`);

    const cut = subtractMasks(landMask, polygonUnion(width, height, territory.separate));
    const parts = components(cut);
    const kept = new Uint8Array(parts.count + 1);
    for (const seed of territory.seeds ?? []) {
      const [x, y] = roundedSeed(id, seed);
      const inside = x >= 0 && x < width && y >= 0 && y < height;
      const label = inside ? parts.labels[y * width + x] : 0;
      if (label === 0) throw new Error(`territory ${id}: seed [${x},${y}] is not on land`);
      kept[label] = 1;
    }

    const base = newMask(width, height);
    for (let p = 0; p < base.data.length; p++) {
      const label = parts.labels[p];
      base.data[p] = label !== 0 && kept[label] ? 1 : 0;
    }

    let area = unionMasks(base, polygonUnion(width, height, territory.add));
    area = subtractMasks(area, polygonUnion(width, height, territory.remove));
    for (const other of territory.subtract ?? []) {
      if (!result.has(other)) {
        throw new Error(`territory ${id}: subtract "${other}" is unknown or is not earlier in the list`);
      }
      area = subtractMasks(area, result.get(other));
    }
    result.set(id, intersectMasks(area, landMask));
  }
  return result;
}

/** SVG path data of one ring, coordinates rounded to one decimal. */
function pathOf(shape) {
  const fmt = (v) => String(Math.round(v * 10) / 10);
  const parts = shape.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${fmt(x)} ${fmt(y)}`);
  return `${parts.join(' ')} Z`;
}

/**
 * Outlines of the 1-regions of a mask as SVG path data, one closed path per ring (holes included
 * as separate rings: use evenodd fill). Pixel x covers [x, x+1] x [y, y+1].
 * @returns {string[]}
 */
export function maskToPaths(mask, { tolerance = 1.5, smoothIterations = 1 } = {}) {
  const { width, height, data } = mask;
  // One pixel of sea around the mask, so that every ring closes at the border.
  const gw = width + 2;
  const gh = height + 2;
  const field = new Float32Array(gw * gh);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      field[(y + 1) * gw + (x + 1)] = data[y * width + x] ? 1 : 0;
    }
  }
  const paths = [];
  for (const padded of marchingSquares(field, gw, gh, 1, 0.5)) {
    if (Math.abs(ringArea(padded)) < MIN_RING_AREA) continue;
    // Padded coordinates: pixel x is centred on x + 1, its edges lie at x + 0.5 and x + 1.5.
    // Shift back so that the pixel edges sit at integer canvas coordinates.
    const ring = padded.map(([x, y]) => [x - 0.5, y - 0.5]);
    let shape = simplify(ring, tolerance);
    if (smoothIterations > 0) shape = smooth(shape, smoothIterations);
    paths.push(pathOf(shape));
  }
  return paths;
}

/** Number of pixels of the territory. */
export function territoryAreaPixels(mask) {
  return countOnes(mask);
}

/**
 * Pixel inside the mask that is closest to its centroid, so that a label placed there lies on the
 * territory. @returns {[number, number] | null} null for an empty mask
 */
export function territoryCentroid(mask) {
  const { width, height, data } = mask;
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[y * width + x]) continue;
      n += 1;
      sumX += x;
      sumY += y;
    }
  }
  if (n === 0) return null;
  const cx = sumX / n;
  const cy = sumY / n;
  let best = null;
  let bestDistance = Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[y * width + x]) continue;
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bestDistance) {
        bestDistance = d;
        best = [x, y];
      }
    }
  }
  return best;
}
