// Scatter of the atlas stamps: evenly spaced points inside a polygon (Bridson's Poisson disc
// sampling, seeded), and the choice, scale and mirroring of each stamp. Deterministic: the same
// seed and input give the same points. No Math.random and no dates.

import { isUsablePolygon, pointInPolygon } from './geometry.mjs';
import { fbm, mulberry32 } from './noise.mjs';

const TRIES = 30;

/** Seed of one sub-generator: a 32-bit FNV-1a hash of the key, mixed with the seed. */
export function subSeed(seed, key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h ^ (seed >>> 0)) >>> 0;
}

/** Bounding box of a polygon: [minX, minY, maxX, maxY]. */
function boundsOf(polygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Points spread at least `spacing` apart inside `polygon` and outside every `avoid` polygon
 * (Bridson's algorithm, with candidates accepted only when they are inside and not avoided).
 * @param {{ polygon: number[][], spacing: number, seed: number, avoid?: number[][][] }} options
 * @returns {number[][]} points [x, y], in generation order
 */
export function poissonInPolygon({ polygon, spacing, seed, avoid = [] }) {
  if (!isUsablePolygon(polygon) || !(spacing > 0)) return [];
  const rand = mulberry32(seed >>> 0);
  const [minX, minY, maxX, maxY] = boundsOf(polygon);
  const r2 = spacing * spacing;
  const cellSize = spacing / Math.SQRT2;
  const grid = new Map();
  const points = [];
  const active = [];

  const accept = (p) => pointInPolygon(p, polygon) && !avoid.some((a) => pointInPolygon(p, a));
  const keyOf = (x, y) => `${Math.floor((x - minX) / cellSize)},${Math.floor((y - minY) / cellSize)}`;

  const fits = (p) => {
    const gx = Math.floor((p[0] - minX) / cellSize);
    const gy = Math.floor((p[1] - minY) / cellSize);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const other = grid.get(`${gx + dx},${gy + dy}`);
        if (other === undefined) continue;
        const ex = other[0] - p[0];
        const ey = other[1] - p[1];
        if (ex * ex + ey * ey < r2) return false;
      }
    }
    return true;
  };

  const add = (p) => {
    points.push(p);
    active.push(p);
    grid.set(keyOf(p[0], p[1]), p);
  };

  // First point: the first accepted candidate of a seeded scan of the bounding box.
  for (let i = 0; i < 10000 && points.length === 0; i++) {
    const p = [minX + rand() * (maxX - minX), minY + rand() * (maxY - minY)];
    if (accept(p)) add(p);
  }

  while (active.length > 0) {
    const index = Math.floor(rand() * active.length);
    const base = active[index];
    let found = false;
    for (let k = 0; k < TRIES && !found; k++) {
      const angle = rand() * 2 * Math.PI;
      const radius = spacing * (1 + rand());
      const p = [base[0] + Math.cos(angle) * radius, base[1] + Math.sin(angle) * radius];
      if (p[0] < minX || p[0] > maxX || p[1] < minY || p[1] > maxY) continue;
      if (accept(p) && fits(p)) {
        add(p);
        found = true;
      }
    }
    if (!found) {
      active[index] = active[active.length - 1];
      active.pop();
    }
  }
  return points;
}

/** Stamp width and spacing per kind, in cells (cell = max(canvas) / 512). */
export const STAMP_KINDS = {
  mountains: { category: 'mountains', width: 26, spacing: 13, mirror: false },
  hills: { category: 'hills', width: 18, spacing: 11, mirror: false },
  forest: { width: 9, spacing: 4.5, mirror: true },
  swamp: { category: 'swamp', width: 11, spacing: 9, mirror: false },
  desert: { category: 'dunes', width: 16, spacing: 14, mirror: true },
};

/**
 * Plans every stamp of the relief and biome layers: where, which stamp, how large and whether
 * mirrored. Stamps are not placed on the sea, closer than six cells to a place, or (forests,
 * swamps and dunes) inside a relief polygon.
 * @param {object} input
 * @param {object} input.assets parsed assets/manifest.json
 * @param {number} input.cell canvas cell size
 * @param {number} input.seed atlas seed
 * @param {object[]} input.relief relief features
 * @param {object[]} input.biomes biome features
 * @param {number[][][]} input.land land polygons
 * @param {number[][][]} input.water water polygons (lakes), where no stamp goes
 * @param {number[][]} input.places anchor points of the places
 * @param {number} [input.stampScale] multiplier of every stamp size (the style's stamps.scale, 1 by default)
 * @param {boolean} [input.mirrorTrees] whether forest stamps may be mirrored (the style's stamps.mirrorTrees, true by default)
 * @returns {object[]} stamps `{ layer, feature, file, width, height, anchor, point, mirror, order }`
 */
export function planStamps({ assets, cell, seed, relief, biomes, land, water, places, stampScale = 1, mirrorTrees = true }) {
  const stamps = [];
  const stampsByCategory = new Map();
  for (const s of assets.stamps) {
    if (!stampsByCategory.has(s.category)) stampsByCategory.set(s.category, []);
    stampsByCategory.get(s.category).push(s);
  }
  const reliefPolygons = relief.flatMap((f) => (isUsablePolygon(f.polygon) ? [f.polygon] : []));
  const placeRadius2 = (cell * 6) ** 2;
  const onLand = (p) => land.some((poly) => pointInPolygon(p, poly)) && !water.some((poly) => pointInPolygon(p, poly));
  const farFromPlaces = (p) => places.every((at) => (p[0] - at[0]) ** 2 + (p[1] - at[1]) ** 2 >= placeRadius2);

  const jobs = [];
  for (const f of relief) {
    if (!isUsablePolygon(f.polygon)) continue;
    const kind = STAMP_KINDS[f.type];
    if (!kind) continue;
    jobs.push({ layer: 'relief', feature: f, kind: f.type, avoid: [] });
  }
  for (const f of biomes) {
    if (!isUsablePolygon(f.polygon)) continue;
    const kind = f.type === 'forest' ? 'forest' : f.type === 'swamp' ? 'swamp' : f.type === 'desert' ? 'desert' : null;
    if (kind === null) continue;
    jobs.push({ layer: 'biomes', feature: f, kind, avoid: reliefPolygons });
  }

  for (const job of jobs) {
    const { layer, feature, kind, avoid } = job;
    const spec = STAMP_KINDS[kind];
    const featureSeed = subSeed(seed, `${layer}:${feature.id}`);
    const rand = mulberry32(featureSeed);
    const points = poissonInPolygon({
      polygon: feature.polygon,
      spacing: spec.spacing * cell,
      seed: featureSeed,
      avoid,
    });
    for (const point of points) {
      if (!onLand(point) || !farFromPlaces(point)) continue;
      const category = kind === 'forest' ? treeCategory(feature, point, featureSeed, cell) : spec.category;
      const pool = stampsByCategory.get(category) ?? [];
      if (pool.length === 0) continue;
      const stamp = pool[Math.floor(rand() * pool.length)];
      const scale = 0.85 + 0.3 * rand();
      const mirrorRoll = spec.mirror ? rand() < 0.5 : false;
      const mirror = mirrorRoll && (kind !== 'forest' || mirrorTrees);
      const width = spec.width * cell * scale * stampScale;
      stamps.push({
        layer,
        feature: feature.id,
        file: stamp.file,
        width,
        height: (width * stamp.height) / stamp.width,
        anchor: stamp.anchor,
        point,
        mirror,
        order: stamps.length,
      });
    }
  }
  return stamps;
}

/** Tree category of a forest point, from the feature variant or a noise field for the mix. */
function treeCategory(feature, point, featureSeed, cell) {
  if (feature.variant === 'conifer') return 'trees-conifer';
  if (feature.variant === 'broadleaf') return 'trees-broadleaf';
  const n = fbm(featureSeed, point[0] / (cell * 40), point[1] / (cell * 40));
  return n > 0.55 ? 'trees-conifer' : 'trees-broadleaf';
}

/** Stamps sorted by the anchor y, then x, so nearer ones overlap farther ones. */
export function sortStamps(stamps) {
  return [...stamps].sort((a, b) => a.point[1] - b.point[1] || a.point[0] - b.point[0] || a.order - b.order);
}
