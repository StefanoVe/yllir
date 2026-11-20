// Urban symbols of the atlas: the vector drawings of lots, buildings, towers and gates, as SVG
// fragments in the look of a style (its `urban` section). Pure functions: the same input gives the
// same string. No ids (the fragments sit inside the renderer's own groups). Numbers are rounded to
// one decimal; text, if any, goes through escapeXml.
// Assumptions (the simplest reading of the contract): `at` is the centre of the footprint, `size`
// is [w, h] before the rotation, and `angle` is in radians clockwise, the same unit as the street
// and gate features (the transform takes degrees).

import { escapeXml } from './render.mjs';

export const DEFAULT_SIZES = Object.freeze({
  house: [10, 8],
  rowhouse: [12, 8],
  shop: [9, 8],
  barn: [16, 12],
  tavern: [16, 12],
  inn: [18, 14],
  temple: [26, 34],
  shrine: [8, 8],
  palace: [40, 30],
  castle: [44, 40],
  keep: [30, 30],
  tower: [14, 14],
  mill: [12, 12],
  warehouse: [24, 16],
  market: [22, 18],
  guildhall: [22, 16],
  smithy: [12, 10],
  gatehouse: [14, 8],
  landmark: [12, 12],
});

// Kind drawn when a kind is unknown.
const FALLBACK_KIND = 'house';
// A named building is drawn at least this much bigger than its default size, and never below the
// minimum side when the feature gives its own size (so that it can be seen on the map).
export const NAMED_SCALE = 1.6;
export const MIN_NAMED_SIZE = 14;

const num = (value) => String(Math.round(value * 10) / 10 + 0);
const paint = (value) => escapeXml(value);
const polyD = (points) => `M${points.map(([x, y]) => `${num(x)} ${num(y)}`).join(' L')} Z`;

/** Default [w, h] of a building or lot kind (a copy); an unknown kind gets the house size. */
export function defaultSize(kind) {
  return [...(Object.hasOwn(DEFAULT_SIZES, kind) ? DEFAULT_SIZES[kind] : DEFAULT_SIZES[FALLBACK_KIND])];
}

/**
 * Drawn [w, h] of a named building: its own size (or the default of its kind), but at least
 * NAMED_SCALE times the default; when the feature gives its own size, never below MIN_NAMED_SIZE per side.
 * Rounded to one decimal.
 */
export function namedSize(kind, size) {
  const base = defaultSize(kind);
  const given = Array.isArray(size) && size.length === 2 && size.every((v) => typeof v === 'number' && v > 0) ? size : null;
  return base.map((fallback, i) => {
    let side = Math.max(given ? given[i] : fallback, fallback * NAMED_SCALE);
    if (given) side = Math.max(side, MIN_NAMED_SIZE);
    return Math.round(side * 10) / 10;
  });
}

const roofOf = (urban, kind) => (Object.hasOwn(urban.roof, kind) ? urban.roof[kind] : urban.roof[FALLBACK_KIND]);

// Opens the group of one symbol: moved to its centre and turned by its angle.
const openGroup = (at, angle) => `<g transform="translate(${num(at[0])} ${num(at[1])}) rotate(${num((angle * 180) / Math.PI)})">`;

// The footprint: a rectangle centred on the origin, with a ridge line along its long side.
function footprint(w, h, roof, urban, stroke) {
  const rect = `<rect x="${num(-w / 2)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h)}" fill="${paint(roof)}" stroke="${paint(urban.outline)}" stroke-width="${stroke}"/>`;
  const ridge = w >= h
    ? `<line x1="${num(-w / 2)}" y1="0" x2="${num(w / 2)}" y2="0"`
    : `<line x1="0" y1="${num(-h / 2)}" x2="0" y2="${num(h / 2)}"`;
  return `${rect}${ridge} stroke="${paint(urban.outline)}" stroke-width="${stroke}" opacity="0.35"/>`;
}

// Top-down marks of the named buildings, in the local frame of the footprint (w and h, centred).
const MARKS = {
  temple: (w, h, urban) => {
    const a = w * 0.15;
    const b = h * 0.15;
    const cross = [[-a, -h / 2], [a, -h / 2], [a, -b], [w / 2, -b], [w / 2, b], [a, b], [a, h / 2], [-a, h / 2], [-a, b], [-w / 2, b], [-w / 2, -b], [-a, -b]];
    return `<path d="${polyD(cross)}" fill="${paint(urban.roof.temple)}" stroke="${paint(urban.outline)}" stroke-width="0.7"/>`;
  },
  tower: (w, h, urban) => `<circle cx="0" cy="0" r="${num(Math.min(w, h) / 3)}" fill="none" stroke="${paint(urban.outline)}" stroke-width="0.7"/>`,
  keep: (w, h, urban) => [0.2, 0.4].map((share) => {
    const inset = Math.min(w, h) * share;
    return `<rect x="${num(-w / 2 + inset)}" y="${num(-h / 2 + inset)}" width="${num(w - 2 * inset)}" height="${num(h - 2 * inset)}" fill="none" stroke="${paint(urban.outline)}" stroke-width="0.7"/>`;
  }).join(''),
  castle: (w, h, urban) => {
    const t = Math.min(w, h) * 0.22;
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]].map(([cx, cy]) =>
      `<rect x="${num(cx - t / 2)}" y="${num(cy - t / 2)}" width="${num(t)}" height="${num(t)}" fill="${paint(urban.roof.castle)}" stroke="${paint(urban.outline)}" stroke-width="0.7"/>`).join('');
  },
  mill: (w, h, urban) => {
    const r = Math.min(w, h) * 0.35;
    return `<circle cx="0" cy="0" r="${num(r)}" fill="none" stroke="${paint(urban.outline)}" stroke-width="0.7"/>`
      + `<path d="M${num(-r)} 0 L${num(r)} 0 M0 ${num(-r)} L0 ${num(r)}" fill="none" stroke="${paint(urban.outline)}" stroke-width="0.7"/>`;
  },
  market: (w, h, urban) => [0, 2].map((band) =>
    `<rect x="${num(-w / 2)}" y="${num(-h / 2 + (band * h) / 4)}" width="${num(w)}" height="${num(h / 4)}" fill="${paint(urban.outline)}" opacity="0.3"/>`).join(''),
  tavern: (w, h, urban) => sign(w, h, urban),
  inn: (w, h, urban) => sign(w, h, urban),
};

// The round sign of a tavern or an inn, at the centre of the roof.
function sign(w, h, urban) {
  return `<circle cx="0" cy="0" r="${num(Math.min(w, h) * 0.14)}" fill="${paint(urban.ground)}" stroke="${paint(urban.outline)}" stroke-width="0.7"/>`;
}

/**
 * A generic building seen from above: a rotated rectangle in the roof colour of the kind, with a ridge line.
 * @returns {string} an SVG group
 */
export function lotSvg({ kind, at, size, angle = 0, urban }) {
  const [w, h] = size ?? defaultSize(kind);
  return `${openGroup(at, angle)}${footprint(w, h, roofOf(urban, kind), urban, 0.4)}</g>`;
}

/**
 * A named building seen from above: the footprint of a lot with a heavier stroke, and a top-down
 * mark for its kind (the footprint alone for an unknown kind or a kind without a mark).
 * @returns {string} an SVG group
 */
export function buildingSvg({ kind, at, size, angle = 0, urban }) {
  const [w, h] = size ?? defaultSize(kind);
  const mark = Object.hasOwn(MARKS, kind) ? MARKS[kind](w, h, urban) : '';
  return `${openGroup(at, angle)}${footprint(w, h, roofOf(urban, kind), urban, 0.7)}${mark}</g>`;
}

/**
 * A tower of the wall: a stone circle with its outline.
 * @returns {string} an SVG circle
 */
export function towerSvg({ at, radius, urban }) {
  return `<circle cx="${num(at[0])}" cy="${num(at[1])}" r="${num(radius)}" fill="${paint(urban.wall.stone)}" stroke="${paint(urban.wall.outline)}" stroke-width="0.7"/>`;
}

/**
 * A gate of the wall: two small posts on both sides of the opening and a thin line across the gap,
 * turned to the direction of the wall.
 * @returns {string} an SVG group
 */
export function gateSvg({ at, angle = 0, width = 6, urban }) {
  const half = width / 2;
  const post = width / 4;
  const posts = [-half, half].map((x) =>
    `<rect x="${num(x - post / 2)}" y="${num(-post / 2)}" width="${num(post)}" height="${num(post)}" fill="${paint(urban.wall.stone)}" stroke="${paint(urban.wall.outline)}" stroke-width="0.4"/>`).join('');
  const gap = `<line x1="${num(-half)}" y1="0" x2="${num(half)}" y2="0" stroke="${paint(urban.wall.outline)}" stroke-width="0.4"/>`;
  return `${openGroup(at, angle)}${posts}${gap}</g>`;
}
