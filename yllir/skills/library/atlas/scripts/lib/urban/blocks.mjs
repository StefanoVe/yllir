// Blocks generator of the urban atlas: the free ground of the canvas (not water, not green, not in a
// street, square or wall) becomes city blocks, and generic lots are put along the edges of each block.
// Deterministic from the seed (the lots of a block use subSeed(seed, block id)). Pure functions.
// Decisions (the simplest reading of the contract):
// - Cells are 4 units wide and sampled at their centres. A block is a 4-connected component of free
//   cells that share the same fill. Its contour is taken at the midpoint between free and blocked
//   centres (threshold 0.5), simplified with tolerance 2 and rounded to one decimal, without smoothing.
//   The result can therefore reach up to about 2 units into a blocked area.
// - Holes of a component are dropped from the polygon; lots never sit in a hole.
// - Several closed walls: a cell must lie inside every ring.
// - Fills: a cell belongs to the first fill whose area contains it; otherwise to the first fill
//   without an area. Cells of no fill are not free. A district is not an input here, so the
//   district of a fill is not used.
// - Lots: size[0] runs along the edge, size[1] is the depth away from it. A lot starts 3 units inside
//   the edge and stays within the edge's span. Gardens (rich only, 25%) are skipped. Barns are only
//   on far sides: edges whose outward normal points away from the canvas centre.
// - Inner rows: after the border ring, the interior is swept in axis-aligned rows (angle 0). Each pass
//   starts its first row further inside than the previous one (by one depth plus one gap), and passes
//   repeat until one adds no lot. A lot must keep 3 units from the block edge, lie inside the polygon
//   and stay one gap away from every lot already placed. Rich blocks skip inner lots (gardens: 50%,
//   15% on big blocks). A big block is one whose bounding box is over 150 units on both sides, and it
//   reads as dense housing because its interior gardens are few.
// - Provenance, visibility and sources of a block come from its fill (a document without sources
//   becomes agent-choice, as in terrain.mjs). `locked` is ignored: blocks are always recomputed.

import { isUsablePolygon, pointInPolygon } from '../geometry.mjs';
import { marchingSquares, ringArea, simplify } from '../contour.mjs';
import { subSeed } from '../scatter.mjs';
import { mulberry32 } from '../noise.mjs';
import { featureMeta } from '../landmask.mjs';
import { boundingBox, bufferPath, r1, rectsOverlap } from './shapes.mjs';

const FILE = 'blocks.json';
const CELL = 4;
const MIN_AREA = 150;
const MAX_LOTS = 400;
const MAX_PASSES = 30;
const INSET = 3;
const BIG_SIDE = 150;
const CHARACTERS = Object.freeze({
  poor: { width: [6, 9], depth: [5, 8], gap: 1, skip: 0, innerSkip: 0, bigInnerSkip: 0 },
  common: { width: [8, 12], depth: [7, 10], gap: 2, skip: 0, innerSkip: 0, bigInnerSkip: 0 },
  rich: { width: [11, 16], depth: [9, 13], gap: 4, skip: 0.25, innerSkip: 0.5, bigInnerSkip: 0.15 },
});

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const roundPoint = (p) => [r1(p[0]), r1(p[1])];

/** Features of a layer, given as a feature list or as { features }. */
function featuresOf(layer) {
  const list = Array.isArray(layer) ? layer : layer?.features;
  return Array.isArray(list) ? list.filter(isPlainObject) : [];
}

/** Usable polygons of features that carry `polygon` (or `polygons`). */
function polygonsOf(features) {
  return features.flatMap((f) => (Array.isArray(f.polygons) ? f.polygons : [f.polygon])).filter(isUsablePolygon);
}

/** Cell centres inside any polygon, as a 0/1 mask over the gw x gh grid (scanline on the centres). */
function rasterize(polygons, gw, gh) {
  const mask = new Uint8Array(gw * gh);
  for (const polygon of polygons) {
    if (!isUsablePolygon(polygon)) continue;
    const ys = polygon.map((p) => p[1]);
    const j0 = Math.max(0, Math.ceil(Math.min(...ys) / CELL - 0.5));
    const j1 = Math.min(gh - 1, Math.floor(Math.max(...ys) / CELL - 0.5));
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * CELL;
      const xs = [];
      for (let k = 0; k < polygon.length; k++) {
        const [ax, ay] = polygon[k];
        const [bx, by] = polygon[(k + 1) % polygon.length];
        if ((ay > y) !== (by > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
      xs.sort((a, b) => a - b);
      for (let c = 0; c + 1 < xs.length; c += 2) {
        const i0 = Math.max(0, Math.ceil(xs[c] / CELL - 0.5));
        const i1 = Math.min(gw - 1, Math.floor(xs[c + 1] / CELL - 0.5));
        for (let i = i0; i <= i1; i++) mask[j * gw + i] = 1;
      }
    }
  }
  return mask;
}

/** Cells that may not hold a block: water, green, squares, streets and bridges, walls, outside a closed wall. */
function blockedMask(layers, gw, gh) {
  const blocked = new Uint8Array(gw * gh);
  const mark = (mask) => {
    for (let k = 0; k < mask.length; k++) if (mask[k]) blocked[k] = 1;
  };
  mark(rasterize(polygonsOf(featuresOf(layers.ground)), gw, gh));
  mark(rasterize(polygonsOf(featuresOf(layers.green)), gw, gh));

  const streets = featuresOf(layers.streets);
  mark(rasterize(polygonsOf(streets.filter((f) => f.type === 'square')), gw, gh));
  for (const f of streets) {
    if ((f.type !== 'street' && f.type !== 'bridge') || !Array.isArray(f.path) || !(f.width > 0)) continue;
    mark(rasterize([bufferPath(f.path, f.width + 4)], gw, gh));
  }

  const walls = featuresOf(layers.walls).filter((f) => f.type === 'wall' && Array.isArray(f.path));
  for (const f of walls) {
    if (f.closed) continue;
    mark(rasterize([bufferPath(f.path, (f.thickness ?? 0) + 2)], gw, gh));
  }
  const rings = walls.filter((f) => f.closed && f.path.length >= 3).map((f) => f.path);
  if (rings.length > 0) {
    const insideEvery = new Uint8Array(gw * gh).fill(1);
    for (const ring of rings) {
      const inside = rasterize([ring], gw, gh);
      for (let k = 0; k < insideEvery.length; k++) if (!inside[k]) insideEvery[k] = 0;
    }
    for (let k = 0; k < blocked.length; k++) if (!insideEvery[k]) blocked[k] = 1;
    // Closed walls also block their band around the ring.
    for (const f of walls.filter((w) => w.closed)) {
      const loop = [...f.path, f.path[0]];
      mark(rasterize([bufferPath(loop, (f.thickness ?? 0) + 2)], gw, gh));
    }
  }
  return blocked;
}

/** Fill constraints in order, with the area (or null) and the character of each. */
function fillsOf(constraints) {
  const fills = constraints
    .filter((c) => isPlainObject(c) && c.kind === 'fill')
    .map((c) => ({
      constraint: c,
      area: isUsablePolygon(c.area) ? c.area : null,
      character: c.character in CHARACTERS ? c.character : 'common',
    }));
  return fills.length > 0 ? fills : [{ constraint: null, area: null, character: 'common' }];
}

/** Index of the fill that owns each cell (-1 for none): first area containing it, else the first fill without area. */
function ownerMask(fills, gw, gh) {
  const owner = new Int32Array(gw * gh).fill(-1);
  fills.forEach((fill, index) => {
    if (!fill.area) return;
    const mask = rasterize([fill.area], gw, gh);
    for (let k = 0; k < mask.length; k++) if (mask[k] && owner[k] === -1) owner[k] = index;
  });
  const rest = fills.findIndex((fill) => !fill.area);
  if (rest !== -1) {
    for (let k = 0; k < owner.length; k++) if (owner[k] === -1) owner[k] = rest;
  }
  return owner;
}

/** Contours (rings in canvas coordinates) of one component of cells. */
function contoursOf(cells, gw) {
  let i0 = Infinity;
  let j0 = Infinity;
  let i1 = -Infinity;
  let j1 = -Infinity;
  for (const k of cells) {
    const i = k % gw;
    const j = (k - i) / gw;
    i0 = Math.min(i0, i);
    j0 = Math.min(j0, j);
    i1 = Math.max(i1, i);
    j1 = Math.max(j1, j);
  }
  // Local sample a sits at global cell i0 - 1 + a, so its centre is at (a + i0 - 0.5) * CELL.
  const sw = i1 - i0 + 3;
  const sh = j1 - j0 + 3;
  const field = new Uint8Array(sw * sh);
  for (const k of cells) {
    const i = k % gw;
    const j = (k - i) / gw;
    field[(j - j0 + 1) * sw + (i - i0 + 1)] = 1;
  }
  const shiftX = (i0 - 0.5) * CELL;
  const shiftY = (j0 - 0.5) * CELL;
  return marchingSquares(field, sw, sh, CELL, 0.5)
    .map((ring) => ring.map(([x, y]) => [x + shiftX, y + shiftY]));
}

/** Connected components (4-neighbours) of free cells that share the same owner. */
function componentsOf(free, owner, gw, gh) {
  const seen = new Uint8Array(free.length);
  const found = [];
  for (let start = 0; start < free.length; start++) {
    if (!free[start] || seen[start]) continue;
    const cells = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const k = stack.pop();
      cells.push(k);
      const i = k % gw;
      const j = (k - i) / gw;
      const neighbours = [];
      if (i > 0) neighbours.push(k - 1);
      if (i < gw - 1) neighbours.push(k + 1);
      if (j > 0) neighbours.push(k - gw);
      if (j < gh - 1) neighbours.push(k + gw);
      for (const n of neighbours) {
        if (free[n] && !seen[n] && owner[n] === owner[k]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    found.push({ owner: owner[start], cells });
  }
  return found;
}

/** Block polygon from one component: the largest contour, simplified, rounded and clamped to the canvas. */
function polygonOf(cells, gw, canvas) {
  const rings = contoursOf(cells, gw);
  if (rings.length === 0) return null;
  const outer = rings.reduce((best, ring) => (Math.abs(ringArea(ring)) > Math.abs(ringArea(best)) ? ring : best));
  const holes = rings.filter((ring) => ring !== outer);
  const clamp = ([x, y]) => [Math.min(canvas.width, Math.max(0, x)), Math.min(canvas.height, Math.max(0, y))];
  const polygon = simplify(outer, 2).map((p) => roundPoint(clamp(p)));
  if (polygon.length < 3) return null;
  return { polygon, holes };
}

const pick = (rng, [lo, hi]) => lo + Math.floor(rng() * (hi - lo + 1));

/** Kind of one lot from the character, the side (far or not) and whether it is on the first edge. */
function pickKind(character, rng, { first, far }) {
  let table;
  if (character === 'poor') {
    table = [['house', 0.5], ['rowhouse', 0.45], ['shop', 0.05]];
  } else if (character === 'rich') {
    table = far
      ? [['barn', 0.2], ['house', 0.45], ['shop', 0.35]]
      : [['house', 0.6], ['shop', 0.4]];
  } else {
    table = first
      ? [['shop', 0.5], ['house', 0.25], ['rowhouse', 0.25]]
      : [['house', 0.4], ['rowhouse', 0.3], ['shop', 0.3]];
  }
  const r = rng();
  let acc = 0;
  for (const [kind, p] of table) {
    acc += p;
    if (r < acc) return kind;
  }
  return table[table.length - 1][0];
}

/** Distance from a point to the nearest edge of a polygon. */
function edgeDistance([px, py], polygon) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[(i + 1) % polygon.length];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/** Points that must all be inside a lot's rectangle: the corners, the edge midpoints and the centre. */
function samplesOfRect([x, y], [w, h]) {
  const hw = w / 2;
  const hh = h / 2;
  return [
    [x - hw, y - hh], [x + hw, y - hh], [x + hw, y + hh], [x - hw, y + hh],
    [x, y - hh], [x + hw, y], [x, y + hh], [x - hw, y], [x, y],
  ];
}

/** True when an axis-aligned lot fits the block: inside, clear of the edges and holes, one gap from the other lots. */
function fitsInside(rect, { polygon, holes, rects, gap }) {
  const samples = samplesOfRect(rect.at, rect.size);
  for (const p of samples) {
    if (!pointInPolygon(p, polygon)) return false;
    if (holes.some((hole) => pointInPolygon(p, hole))) return false;
  }
  if (edgeDistance(rect.at, polygon) < INSET) return false;
  for (const corner of samples.slice(0, 4)) {
    if (edgeDistance(corner, polygon) < INSET - 0.5) return false;
  }
  // Inflated by a gap on each side, so two lots keep at least one gap between them.
  const grown = { at: rect.at, size: [rect.size[0] + 2 * gap, rect.size[1] + 2 * gap], angle: 0 };
  for (const other of rects) {
    if (Math.hypot(other.at[0] - rect.at[0], other.at[1] - rect.at[1]) > 40) continue;
    if (rectsOverlap(grown, other)) return false;
  }
  return true;
}

/**
 * Inner rows of one block: after the border ring, the interior is swept in axis-aligned rows. Pass k
 * starts its rows one depth plus one gap further in than pass k - 1; passes repeat until one adds no lot.
 */
function innerLotsOf({ polygon, holes, character, rng, lots, rects, big }) {
  const rule = CHARACTERS[character];
  const skip = big ? rule.bigInnerSkip : rule.innerSkip;
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const stepIn = rule.depth[1] + rule.gap;
  for (let pass = 0; pass < MAX_PASSES && lots.length < MAX_LOTS; pass++) {
    const before = lots.length;
    for (let y = minY + INSET + pass * stepIn; y <= maxY && lots.length < MAX_LOTS;) {
      const d = pick(rng, rule.depth);
      let x = minX;
      while (x <= maxX && lots.length < MAX_LOTS) {
        const w = pick(rng, rule.width);
        const at = roundPoint([x + w / 2, y + d / 2]);
        const size = [w, d];
        const skipped = skip > 0 && rng() < skip;
        const kind = pickKind(character, rng, { first: false, far: false });
        x += w + rule.gap * (0.5 + rng());
        if (skipped) continue;
        const rect = { at, size, angle: 0 };
        if (!fitsInside(rect, { polygon, holes, rects, gap: rule.gap })) continue;
        rects.push(rect);
        lots.push({ kind, at, size, angle: 0 });
      }
      y += d + rule.gap * (0.5 + rng());
    }
    if (lots.length === before) break;
  }
}

/** Lots of one block polygon: the border ring along the edges, in edge order, then the inner rows. */
function lotsOf({ polygon, holes, character, seed, canvas }) {
  const rule = CHARACTERS[character];
  const rng = mulberry32(seed);
  const sign = ringArea(polygon) >= 0 ? 1 : -1;
  const center = [canvas.width / 2, canvas.height / 2];
  const lots = [];
  const rects = [];

  for (let e = 0; e < polygon.length && lots.length < MAX_LOTS; e++) {
    const a = polygon[e];
    const b = polygon[(e + 1) % polygon.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < rule.width[0]) continue;
    const ux = dx / len;
    const uy = dy / len;
    const inward = [sign * -uy, sign * ux];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const outwardDot = -(inward[0] * (mid[0] - center[0]) + inward[1] * (mid[1] - center[1]));
    const far = outwardDot > 0;
    const angle = Math.atan2(dy, dx);
    let s = 0;
    while (lots.length < MAX_LOTS) {
      const w = pick(rng, rule.width);
      const d = pick(rng, rule.depth);
      if (s + w > len) break;
      const along = s + w / 2;
      const depth = INSET + d / 2;
      const at = roundPoint([a[0] + ux * along + inward[0] * depth, a[1] + uy * along + inward[1] * depth]);
      const size = [w, d];
      const skipped = rule.skip > 0 && rng() < rule.skip;
      const kind = pickKind(character, rng, { first: e === 0, far });
      s += w + rule.gap * (0.5 + rng());
      if (skipped) continue;
      const rect = { at, size, angle };
      if (!pointInPolygon(at, polygon)) continue;
      if (holes.some((hole) => pointInPolygon(at, hole))) continue;
      if (rects.some((other) => rectsOverlap(rect, other))) continue;
      rects.push(rect);
      lots.push({ kind, at, size, angle });
    }
  }
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const big = Math.max(...xs) - Math.min(...xs) > BIG_SIDE && Math.max(...ys) - Math.min(...ys) > BIG_SIDE;
  innerLotsOf({ polygon, holes, character, rng, lots, rects, big });
  return lots;
}

/**
 * Generates the blocks layer from the fills and the input layers (ground, green, walls, streets).
 * @param {{ canvas: { width: number, height: number }, seed: number, constraints?: object[],
 *   layers?: Record<string, object[] | { features?: object[] }>, locked?: object | null }} input
 * @returns {{ features: object[], problems: object[] }}
 */
export function generateBlocks({ canvas, seed, constraints = [], layers = {}, locked = null }) {
  void locked; // blocks are never locked: everything is recomputed
  const gw = Math.ceil(canvas.width / CELL);
  const gh = Math.ceil(canvas.height / CELL);
  const fills = fillsOf(constraints);
  const blocked = blockedMask(layers, gw, gh);
  const owner = ownerMask(fills, gw, gh);
  const free = new Uint8Array(gw * gh);
  for (let k = 0; k < free.length; k++) free[k] = owner[k] >= 0 && !blocked[k] ? 1 : 0;

  const drafts = [];
  for (const component of componentsOf(free, owner, gw, gh)) {
    if (component.cells.length * CELL * CELL < MIN_AREA) continue;
    const shape = polygonOf(component.cells, gw, canvas);
    if (!shape) continue;
    drafts.push({ ...shape, fill: fills[component.owner] });
  }

  const boxes = drafts.map((d) => boundingBox(d.polygon));
  const order = drafts.map((_, index) => index).sort((a, b) => boxes[a].minY - boxes[b].minY
    || boxes[a].minX - boxes[b].minX || a - b);

  const features = order.map((index, n) => {
    const draft = drafts[index];
    const id = `block-${n + 1}`;
    const character = draft.fill.character;
    const meta = draft.fill.constraint ? featureMeta(draft.fill.constraint) : featureMeta({});
    if (draft.fill.constraint?.provenance === 'document' && meta.sources.length === 0) {
      meta.provenance = 'agent-choice';
    }
    const lots = lotsOf({
      polygon: draft.polygon,
      holes: draft.holes,
      character,
      seed: subSeed(seed, id),
      canvas,
    });
    return { id, type: 'block', polygon: draft.polygon, character, ...meta, lots };
  });

  const problems = features.length === 0
    ? [{ code: 'no-blocks', file: FILE, path: '', message: 'No free ground is left for city blocks: every cell is water, green, street, wall or outside a fill.' }]
    : [];
  return { features, problems };
}
