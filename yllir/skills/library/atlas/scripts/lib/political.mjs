// Political generator of the atlas: turns the `realm` constraints into territories. Each land grid
// point goes to the realm whose seeds reach it first over land (4 neighbours), cut lines block the
// way, and locked realms keep their land. Borders are the outlines of each realm's cells.
// Problems are { code, file, path, message }.

import { isUsablePolygon } from './geometry.mjs';
import {
  landMask, gridOf, coverOf, contourPolygons, featureMeta, isPlainObject, polygonsOf, isPointList,
} from './landmask.mjs';

const FILE = 'political.json';
const COLOR = /^#[0-9a-f]{6}$/i;
const NONE = -1;

/**
 * Assigns every land grid point to a realm. Pure: used by generatePolitical and by the tests.
 * @param {object} input
 * @param {{ width: number, height: number }} input.canvas
 * @param {object} input.terrain the terrain layer object
 * @param {Array<{ seeds: number[][], cuts?: number[][][], reach?: number }>} input.realms new realms, in order
 * @param {number[][][]} [input.cuts] cut segments blocking every realm (defaults to the cuts of `realms`)
 * @param {number[][][]} [input.lockedPolygons] polygons of locked realms: their cells are taken
 * @returns {{ owner: Int16Array, grid: object, problems: object[] }} owner is the realm index or -1
 */
export function assignRealms({ canvas, terrain, realms, cuts, lockedPolygons = [] }) {
  const grid = gridOf(canvas);
  const { cell, gw, gh } = grid;
  const mask = landMask({ canvas, terrain });
  const problems = [];

  // Blocked for everyone: sea, locked realms, and the cells crossed by a cut segment.
  const blocked = new Uint8Array(gw * gh);
  const lockedCover = coverOf(lockedPolygons, grid);
  for (let index = 0; index < blocked.length; index++) {
    if (mask.kind[index] !== 1 || lockedCover[index] === 1) blocked[index] = 1;
  }
  const allCuts = cuts ?? realms.flatMap((r) => r.cuts ?? []);
  for (const [a, b] of allCuts) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(length / cell));
    for (let s = 0; s <= steps; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / steps;
      const y = a[1] + ((b[1] - a[1]) * s) / steps;
      blocked[mask.indexOf(x, y)] = 1;
    }
  }

  // Seeds, in realm order then seed order. A seed off land is a problem; a seed already taken stays with the first realm.
  const owner = new Int16Array(gw * gh).fill(NONE);
  const dist = new Int32Array(gw * gh).fill(NONE);
  let frontier = [];
  realms.forEach((realm, r) => {
    for (const seed of realm.seeds) {
      const index = mask.indexOf(seed[0], seed[1]);
      if (mask.kind[index] !== 1) {
        problems.push({ code: 'realm-seed-not-land', file: FILE, path: `seeds`, message: `a seed of realm ${r} is not on land` });
        continue;
      }
      if (blocked[index] === 1 || owner[index] !== NONE) continue;
      owner[index] = r;
      dist[index] = 0;
      frontier.push(index);
    }
  });

  // Level-by-level search. Within a level a cell takes the lowest realm index among its claimants,
  // so the result does not depend on the order of the queue.
  let level = 0;
  while (frontier.length > 0) {
    const next = [];
    for (const index of frontier) {
      const r = owner[index];
      const reach = realms[r].reach;
      if (reach !== undefined && (level + 1) * cell > reach) continue;
      const i = index % gw;
      const j = Math.floor(index / gw);
      const neighbours = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
      for (const [ni, nj] of neighbours) {
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        const n = nj * gw + ni;
        if (blocked[n] === 1) continue;
        if (dist[n] === NONE) {
          dist[n] = level + 1;
          owner[n] = r;
          next.push(n);
        } else if (dist[n] === level + 1 && r < owner[n]) {
          owner[n] = r;
        }
      }
    }
    frontier = next;
    level++;
  }
  return { owner, grid, problems };
}

/**
 * Generates the political layer from the realm constraints.
 * @param {{ canvas: { width: number, height: number }, seed: number, constraints?: object[],
 *   layers?: Record<string, { features?: object[] }>, locked?: { features: object[], constraintCount: number } | null }} input
 * @returns {{ features: object[], problems: object[] }}
 */
export function generatePolitical({ canvas, seed, constraints = [], layers = {}, locked = null }) {
  const list = (Array.isArray(constraints) ? constraints : []).map((c, k) => [isPlainObject(c) ? c : {}, k]);
  const firstNew = locked ? locked.constraintCount : 0;
  const lockedFeatures = locked && Array.isArray(locked.features) ? locked.features.filter(isPlainObject) : [];

  const hasLand = (layers.terrain?.features ?? []).some((f) => isPlainObject(f) && f.type === 'land' && isUsablePolygon(f.polygon));
  if (!hasLand) {
    return {
      features: [],
      problems: [{ code: 'missing-prerequisite', file: FILE, path: '', message: 'the terrain layer has no land: generate terrain first' }],
    };
  }

  const problems = [];
  const newRealms = [];
  const newIndexes = [];
  for (const [c, k] of list) {
    if (c.kind !== 'realm' || k < firstNew) continue;
    const path = `constraints[${k}]`;
    const valid = typeof c.id === 'string' && COLOR.test(c.color ?? '') && isPointList(c.seeds, 1)
      && (c.cuts === undefined || (Array.isArray(c.cuts) && c.cuts.every((cut) => isPointList(cut, 2))))
      && (c.reach === undefined || (c.reach > 0))
      && (c.name === undefined || (typeof c.name === 'string' && c.name.trim() !== ''))
      && (c.place === undefined || typeof c.place === 'string');
    if (!valid) {
      problems.push({ code: 'bad-constraint', file: FILE, path, message: `realm ${c.id} needs an id, a colour, seeds and optional cuts, reach, name and place` });
      continue;
    }
    newRealms.push({ seeds: c.seeds, cuts: c.cuts, reach: c.reach, name: c.name, place: c.place });
    newIndexes.push(k);
  }

  const allCuts = list.filter(([c]) => c.kind === 'realm' && Array.isArray(c.cuts)).flatMap(([c]) => c.cuts);
  const lockedPolygons = lockedFeatures.filter((f) => f.type === 'realm').flatMap(polygonsOf);
  const { owner, grid, problems: seedProblems } = assignRealms({
    canvas,
    terrain: layers.terrain,
    realms: newRealms,
    cuts: allCuts,
    lockedPolygons,
  });
  problems.push(...seedProblems);

  const features = [];
  newRealms.forEach((realm, r) => {
    const c = list[newIndexes[r]][0];
    const k = newIndexes[r];
    const field = new Float64Array(owner.length);
    for (let index = 0; index < owner.length; index++) field[index] = owner[index] === r ? 1 : -1;
    const polygons = contourPolygons(field, grid);
    if (polygons.length === 0) {
      problems.push({ code: 'realm-not-on-land', file: FILE, path: `constraints[${k}]`, message: `realm ${c.id} holds no land` });
      return;
    }
    // A realm keeps its name and its place (the world's place sheet it stands for) when the constraint has them.
    const naming = {};
    if (c.name !== undefined) naming.name = c.name;
    if (c.place !== undefined) naming.place = c.place;
    features.push({ id: c.id, type: 'realm', color: c.color, seeds: c.seeds, polygons, ...naming, ...featureMeta(c) });
  });

  return { features: [...lockedFeatures, ...features], problems };
}
