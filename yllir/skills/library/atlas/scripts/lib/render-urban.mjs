// Renderer of the urban atlas (settlement and district scale): the layers become one SVG in the look
// of the chosen style. Colours come only from the style (its `urban` section and the other keys),
// textures from its manifest. Pure and deterministic: the same inputs give the same string.
// Layers are drawn in this order, each in a group `data-layer="<name>"`: ground, green, walls,
// streets, blocks, buildings, districts, labels.
// Decisions (the simplest reading of the contract):
// - A gate is a gap in the wall: a line in the ground colour along the wall direction, over the wall
//   stroke, then the gate symbol. The gap is as thick as the thickest wall of the layer.
// - A district with a `place` is a `<g class="place" data-place>` with pointer-events none, so its
//   fills never hide the buildings under them. Its name, in the labels layer, carries the same
//   class and data-place, so the name is the clickable part.
// - A named building (its place has a name) is drawn at least 1.6 times its default size, and never
//   below 14 x 14 when the feature gives its size (namedSize in urban-assets.mjs).
// - A building's name sits under it, with a halo; a district's name sits at the centre of its largest
//   polygon, beneath every building name, at a lower opacity. When its box (width = characters * size *
//   0.6, height = size) overlaps a building name, it moves up by one font size, at most three times.
// - A lot is skipped when its rectangle overlaps a building that the audience sees.
// - The labels layer can override the text, size and position of a label, or hide it, as in render.mjs.
// - Opacities keep three decimals (one decimal would turn 0.12 into 0.1).
// - An island (a land feature of ground) is drawn over a water canvas: sea pieces are filled without an edge,
//   the island has a soft shore (a 6-unit water stroke at 0.35 opacity, under the land fill) and its own edge.

import { escapeXml } from './render.mjs';
import { isFinitePoint, isUsablePolygon } from './geometry.mjs';
import { DEFAULT_STYLE, FONT_FILES, loadStyle } from './styles.mjs';
import { buildingSvg, defaultSize, gateSvg, namedSize, towerSvg } from './urban-assets.mjs';
import { centroid, polygonArea, rectCorners, rectsOverlap } from './urban/shapes.mjs';

const AUDIENCES = ['master', 'players'];
const URBAN_LAYERS = ['ground', 'green', 'walls', 'streets', 'blocks', 'buildings', 'districts'];
const STREET_RANKS = ['main', 'secondary', 'lane'];
const DEFAULT_STREET_WIDTH = { main: 14, secondary: 9, lane: 5 };
const DEFAULT_GATE_WIDTH = 6;
// The island's soft shore: a wide water stroke under its outline, at this opacity.
const SHORE_WIDTH = 6;
const SHORE_OPACITY = 0.35;
const HEX_RE = /^#[0-9a-f]{6}$/i;
// District names are drawn fainter than the style's district opacity: they sit beneath the buildings.
const DISTRICT_LABEL_FACTOR = 0.6;
const LABEL_SHIFTS = 3;
const LABEL_WIDTH = 0.6; // average glyph width, in font sizes
// The ridge lines of the lots: one path per kind, at this opacity.
const RIDGE_OPACITY = 0.35;
const LOT_STROKE = 0.4;
// A lot kind without a roof colour is drawn in the house colour, as in urban-assets.mjs.
const FALLBACK_LOT_KIND = 'house';

const isPositive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isAngle = (value) => typeof value === 'number' && Number.isFinite(value);
const validSize = (value) => Array.isArray(value) && value.length === 2 && value.every(isPositive);
const hasPlace = (feature) => typeof feature.place === 'string' && feature.place !== '';
const sizeOf = (feature) => (validSize(feature.size) ? feature.size : defaultSize(feature.kind));
const angleOf = (feature) => (isAngle(feature.angle) ? feature.angle : 0);
const rankOf = (rank) => (STREET_RANKS.includes(rank) ? rank : 'lane');

/** Number for an attribute: one decimal, no "-0". */
const num = (value) => String(Math.round(value * 10) / 10 + 0);
/** Opacity: three decimals. */
const fmt = (value) => String(Math.round(value * 1000) / 1000 + 0);

const patternId = (role) => `tex-${role}`;
const ringD = (polygon) => `M${polygon.map(([x, y]) => `${num(x)} ${num(y)}`).join(' L')} Z`;
const lineD = (points) => `M${points.map(([x, y]) => `${num(x)} ${num(y)}`).join(' L')}`;
const isLine = (path) => Array.isArray(path) && path.length >= 2 && path.every(isFinitePoint);
const midpoint = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
/** The ridge of a lot: the segment between the midpoints of its two short sides, so it runs along the long side. */
function ridgeOf(lot) {
  const [c0, c1, c2, c3] = rectCorners(lot);
  return lot.size[0] >= lot.size[1]
    ? [midpoint(c0, c3), midpoint(c1, c2)]
    : [midpoint(c0, c1), midpoint(c2, c3)];
}

/** Visible features of a layer for the audience: master-only items are dropped for the players. */
function visibleFeatures(layer, audience) {
  const features = Array.isArray(layer?.features) ? layer.features : [];
  return audience === 'players' ? features.filter((f) => f?.visibility !== 'master') : features;
}

/** A layer group, always present (empty when nothing is drawn). */
const group = (name, inner) => [`<g id="layer-${name}" data-layer="${name}">`, ...inner, '</g>'];

/**
 * Renders the urban atlas to SVG.
 * @param {object} options
 * @param {{ canvas: { width: number, height: number }, seed: number }} options.manifest the atlas.json object
 * @param {Record<string, { features?: object[] }>} [options.layers] urban layer objects by name; any may be missing
 * @param {{ style: object, manifest: object, dir: string }} [options.style] the result of loadStyle (default: fantasy-color)
 * @param {Record<string, string>} [options.names] place id -> display title
 * @param {'master'|'players'} [options.audience]
 * @param {string} [options.assetBase] URL prefix of the styles and fonts
 * @param {boolean} [options.vignette] accepted for parity with renderAtlasSvg and ignored: the urban map has no vignette
 * @returns {{ svg: string, stats: { lots: number, buildings: number, districts: number, labels: number } }}
 */
export function renderUrbanSvg({ manifest, layers = {}, style, names = {}, audience = 'master', assetBase = 'assets/', vignette: _vignette }) {
  if (!AUDIENCES.includes(audience)) throw new Error(`audience must be one of ${AUDIENCES.join(', ')}`);
  const bundle = style ?? loadStyle(DEFAULT_STYLE);
  const S = bundle.style;
  const M = bundle.manifest;
  const U = S.urban;
  const L = S.labels;
  const W = manifest.canvas.width;
  const H = manifest.canvas.height;
  const cell = Math.max(W, H) / 512;
  const tile = Math.max(W, H) / 9;
  const base = escapeXml(assetBase);
  const styleBase = `${base}styles/${escapeXml(S.id)}/`;
  const colour = (value) => escapeXml(value);

  const features = Object.fromEntries(URBAN_LAYERS.map((name) => [name, visibleFeatures(layers[name], audience)]));
  const labelOverrides = visibleFeatures(layers.labels, audience);
  // A building is named when its place has a name: only then is it drawn at the enlarged size.
  const isNamed = (feature) => hasPlace(feature) && typeof names[feature.place] === 'string' && names[feature.place] !== '';
  const drawnSize = (feature) => (isNamed(feature) ? namedSize(feature.kind, validSize(feature.size) ? feature.size : undefined) : sizeOf(feature));

  // Fonts and textures. A texture is used only when the style's manifest has it.
  const defs = [
    '<style>',
    ...[...new Set(Object.values(S.fonts))].map((family) => `@font-face { font-family: '${escapeXml(family)}'; src: url('${base}${FONT_FILES[family]}'); }`),
    '</style>',
  ];
  const textured = {};
  for (const role of ['land', 'sea']) {
    const entry = (M.textures ?? []).find((t) => t.id === S.textures[role]);
    if (!entry) continue;
    textured[role] = `url(#${patternId(role)})`;
    defs.push(
      `<pattern id="${patternId(role)}" patternUnits="userSpaceOnUse" x="0" y="0" width="${num(tile)}" height="${num(tile)}">`
      + `<image href="${styleBase}${escapeXml(entry.file)}" x="0" y="0" width="${num(tile)}" height="${num(tile)}"/></pattern>`,
    );
  }

  // 1. Ground. Without an island the land is the whole canvas, as before. With an island the canvas is
  // water, the water polygons follow (sea pieces without an edge, they would show seams), then the island:
  // a soft shore, the land fill, and its outline.
  const islands = features.ground.filter((f) => f.type === 'land' && isUsablePolygon(f.polygon));
  const ground = [];
  if (islands.length > 0) {
    ground.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${colour(U.water)}"/>`);
    if (textured.sea) ground.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${textured.sea}"/>`);
  } else {
    ground.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${colour(U.ground)}"/>`);
    if (textured.land) ground.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${textured.land}"/>`);
  }
  for (const f of features.ground) {
    if (f.type !== 'water' || !isUsablePolygon(f.polygon)) continue;
    const d = ringD(f.polygon);
    ground.push(`<path d="${d}" fill="${colour(U.water)}"/>`);
    if (textured.sea) ground.push(`<path d="${d}" fill="${textured.sea}"/>`);
    if (f.kind !== 'sea') ground.push(`<path d="${d}" fill="none" stroke="${colour(U.waterEdge)}" stroke-width="0.8" stroke-linejoin="round"/>`);
  }
  for (const f of islands) {
    const d = ringD(f.polygon);
    ground.push(`<path d="${d}" fill="none" stroke="${colour(U.water)}" stroke-width="${SHORE_WIDTH}" stroke-linejoin="round" opacity="${fmt(SHORE_OPACITY)}"/>`);
    ground.push(`<path d="${d}" fill="${colour(U.ground)}"/>`);
    if (textured.land) ground.push(`<path d="${d}" fill="${textured.land}"/>`);
    ground.push(`<path d="${d}" fill="none" stroke="${colour(U.waterEdge)}" stroke-width="0.8" stroke-linejoin="round"/>`);
  }

  // 2. Green areas, by type.
  const green = [];
  for (const f of features.green) {
    if (!isUsablePolygon(f.polygon) || !Object.hasOwn(U.green, f.type)) continue;
    green.push(`<path d="${ringD(f.polygon)}" fill="${colour(U.green[f.type])}"/>`);
  }

  // 3. Walls: each wall in its stone with an outline, then the gaps of the gates, the towers and the gates.
  const wallFeatures = features.walls.filter((f) => f.type === 'wall' && isLine(f.path));
  const thickness = (f) => (isPositive(f.thickness) ? f.thickness : 1);
  const maxThickness = Math.max(1, ...wallFeatures.map(thickness));
  const walls = [];
  for (const f of wallFeatures) {
    const d = lineD(f.path) + (f.closed === true ? ' Z' : '');
    walls.push(
      `<path d="${d}" fill="none" stroke="${colour(U.wall.outline)}" stroke-width="${num(thickness(f) + 1.6)}" stroke-linejoin="round" stroke-linecap="round"/>`,
      `<path d="${d}" fill="none" stroke="${colour(U.wall.stone)}" stroke-width="${num(thickness(f))}" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  }
  const gates = features.walls.filter((f) => f.type === 'gate' && isFinitePoint(f.at));
  for (const g of gates) {
    const half = (isPositive(g.width) ? g.width : DEFAULT_GATE_WIDTH) / 2;
    const degrees = (angleOf(g) * 180) / Math.PI;
    walls.push(
      `<g transform="translate(${num(g.at[0])} ${num(g.at[1])}) rotate(${num(degrees)})">`
      + `<line x1="${num(-half)}" y1="0" x2="${num(half)}" y2="0" stroke="${colour(U.ground)}" stroke-width="${num(maxThickness + 1.6)}"/></g>`,
    );
  }
  for (const f of features.walls) {
    if (f.type === 'tower' && isFinitePoint(f.at)) {
      walls.push(towerSvg({ at: f.at, radius: isPositive(f.radius) ? f.radius : maxThickness, urban: U }));
    }
  }
  for (const g of gates) {
    walls.push(gateSvg({ at: g.at, angle: angleOf(g), width: isPositive(g.width) ? g.width : DEFAULT_GATE_WIDTH, urban: U }));
  }

  // 4. Streets: a casing wider than the street, then the street in the colour of its rank; bridges
  // with flat ends; squares filled with an outline.
  const streets = [];
  for (const f of features.streets) {
    if (f.type === 'street' && isLine(f.path)) {
      const width = isPositive(f.width) ? f.width : DEFAULT_STREET_WIDTH[rankOf(f.rank)];
      const d = lineD(f.path);
      streets.push(
        `<path d="${d}" fill="none" stroke="${colour(U.street.casing)}" stroke-width="${num(width + 2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
        `<path d="${d}" fill="none" stroke="${colour(U.street[rankOf(f.rank)])}" stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    } else if (f.type === 'bridge' && isLine(f.path)) {
      const width = isPositive(f.width) ? f.width : DEFAULT_STREET_WIDTH.main;
      const d = lineD(f.path);
      streets.push(
        `<path d="${d}" fill="none" stroke="${colour(U.street.casing)}" stroke-width="${num(width + 2)}" stroke-linecap="butt"/>`,
        `<path d="${d}" fill="none" stroke="${colour(U.street.main)}" stroke-width="${num(width)}" stroke-linecap="butt"/>`,
      );
    } else if (f.type === 'square' && isUsablePolygon(f.polygon)) {
      streets.push(`<path d="${ringD(f.polygon)}" fill="${colour(U.square)}" stroke="${colour(U.outline)}" stroke-width="0.6" stroke-linejoin="round"/>`);
    }
  }

  // 5. Blocks, with their lots. A lot under a building the audience sees is left out. The lots are
  // grouped by kind: one path for their roofs (a closed rectangle each, in the roof colour of the kind)
  // and one path for their ridge lines, so that a city of thousands of lots stays a few elements.
  const buildingBoxes = features.buildings
    .filter((f) => isFinitePoint(f.at) && typeof f.kind === 'string')
    .map((f) => ({ at: f.at, size: drawnSize(f), angle: angleOf(f) }));
  const blocks = [];
  const lotsByKind = new Map();
  let lotCount = 0;
  for (const f of features.blocks) {
    if (f.type !== 'block' || !isUsablePolygon(f.polygon)) continue;
    blocks.push(`<path d="${ringD(f.polygon)}" fill="${colour(U.block)}"/>`);
    for (const lot of Array.isArray(f.lots) ? f.lots : []) {
      if (!isFinitePoint(lot?.at) || typeof lot.kind !== 'string') continue;
      const box = { at: lot.at, size: sizeOf(lot), angle: angleOf(lot) };
      if (buildingBoxes.some((building) => rectsOverlap(box, building))) continue;
      if (!lotsByKind.has(lot.kind)) lotsByKind.set(lot.kind, []);
      lotsByKind.get(lot.kind).push(box);
      lotCount++;
    }
  }
  for (const [kind, lots] of lotsByKind) {
    const roof = Object.hasOwn(U.roof, kind) ? U.roof[kind] : U.roof[FALLBACK_LOT_KIND];
    const outline = colour(U.outline);
    blocks.push(
      `<path d="${lots.map((lot) => ringD(rectCorners(lot))).join(' ')}" fill="${colour(roof)}" stroke="${outline}" stroke-width="${num(LOT_STROKE)}"/>`,
      `<path d="${lots.map((lot) => lineD(ridgeOf(lot))).join(' ')}" fill="none" stroke="${outline}" stroke-width="${num(LOT_STROKE)}" opacity="${fmt(RIDGE_OPACITY)}"/>`,
    );
  }

  // 6. Buildings: a named one is wrapped as a place (clickable in the viewer).
  const buildings = [];
  for (const f of features.buildings) {
    if (!isFinitePoint(f.at) || typeof f.kind !== 'string') continue;
    const svg = buildingSvg({ kind: f.kind, at: f.at, size: drawnSize(f), angle: angleOf(f), urban: U });
    buildings.push(hasPlace(f) ? `<g class="place" data-place="${escapeXml(f.place)}">${svg}</g>` : svg);
  }
  const buildingCount = buildings.length;

  // 7. Districts: a tinted fill and a dashed outline, which do not take the pointer.
  const districts = [];
  for (const f of features.districts) {
    if (f.type !== 'district') continue;
    const polygons = (Array.isArray(f.polygons) ? f.polygons : [f.polygon]).filter(isUsablePolygon);
    if (polygons.length === 0) continue;
    const stroke = HEX_RE.test(f.color ?? '') ? f.color : U.outline;
    const inner = polygons.flatMap((polygon) => {
      const d = ringD(polygon);
      return [
        `<path d="${d}" fill="${colour(stroke)}" fill-opacity="${fmt(U.district.fillOpacity)}"/>`,
        `<path d="${d}" fill="none" stroke="${colour(stroke)}" stroke-width="${num(cell * 0.8)}" stroke-dasharray="${num(cell * 3)} ${num(cell * 2)}"/>`,
      ];
    });
    const attrs = hasPlace(f) ? ` class="place" data-place="${escapeXml(f.place)}"` : '';
    districts.push(`<g${attrs} pointer-events="none">${inner.join('')}</g>`);
  }

  // 8. Labels: computed ones first (building names under the building, district names at the centre
  // of the largest polygon), then the overrides of the labels layer.
  const computed = new Map();
  for (const f of features.buildings) {
    if (!isFinitePoint(f.at) || !hasPlace(f)) continue;
    const title = names[f.place];
    if (typeof title !== 'string' || title === '') continue;
    const size = cell * L.placeSize.other;
    computed.set(`buildings/${f.id}`, {
      kind: 'point', text: title, x: f.at[0], y: f.at[1] + Math.max(...drawnSize(f)) / 2 + size,
      size, font: 'place', fill: L.fill, halo: true,
    });
  }
  for (const f of features.districts) {
    if (f.type !== 'district') continue;
    const title = typeof f.name === 'string' && f.name !== '' ? f.name : (hasPlace(f) ? names[f.place] : undefined);
    if (typeof title !== 'string' || title === '') continue;
    const polygons = (Array.isArray(f.polygons) ? f.polygons : [f.polygon]).filter(isUsablePolygon);
    if (polygons.length === 0) continue;
    const largest = polygons.reduce((best, p) => (polygonArea(p) > polygonArea(best) ? p : best));
    const area = polygons.reduce((sum, p) => sum + polygonArea(p), 0);
    const [x, y] = centroid(largest);
    const size = Math.min(cell * L.realmSize.max, Math.max(cell * L.realmSize.min, Math.sqrt(area) / L.realmSize.areaDivisor));
    computed.set(`districts/${f.id}`, {
      kind: 'point', text: title, x, y, size, font: 'realm', fill: U.outline, halo: false,
      opacity: U.district.labelOpacity * DISTRICT_LABEL_FACTOR, place: hasPlace(f) ? f.place : undefined,
    });
  }

  const targetExists = (target) => {
    const match = /^([a-z]+)\/(.+)$/.exec(String(target));
    if (match === null || !Object.hasOwn(features, match[1])) return false;
    return features[match[1]].some((f) => f.id === match[2]);
  };
  const overrides = new Map();
  for (const label of labelOverrides) overrides.set(label.target, label);

  const districtLabels = [];
  const otherLabels = [];
  for (const [target, label] of computed) {
    const override = overrides.get(target);
    if (override?.hidden === true) continue;
    const merged = { ...label, target };
    if (override?.text !== undefined) merged.text = override.text;
    if (override?.size !== undefined) merged.size = override.size;
    if (Array.isArray(override?.at)) {
      merged.kind = 'point';
      merged.x = override.at[0];
      merged.y = override.at[1];
    }
    if (target.startsWith('districts/')) {
      // A district name moved by hand stays where it was put.
      if (!Array.isArray(override?.at)) merged.movable = true;
      districtLabels.push(merged);
    } else {
      otherLabels.push(merged);
    }
  }
  for (const [target, override] of overrides) {
    if (computed.has(target) || override.hidden === true) continue;
    if (!targetExists(target) || typeof override.text !== 'string' || !Array.isArray(override.at)) continue;
    const size = override.size ?? cell * L.featureSize;
    otherLabels.push({
      target, kind: 'point', text: override.text, x: override.at[0], y: override.at[1],
      size, font: 'feature', fill: L.featureFill, halo: false, letterSpacing: size * L.featureSpacing,
    });
  }
  // A district name that overlaps a building name moves up by one font size, at most LABEL_SHIFTS times.
  const boxOf = (label) => {
    const w = String(label.text).length * label.size * LABEL_WIDTH;
    return { x0: label.x - w / 2, x1: label.x + w / 2, y0: label.y - label.size, y1: label.y + label.size * 0.25 };
  };
  const boxesOverlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  for (const label of districtLabels) {
    if (!label.movable) continue;
    for (let n = 0; n < LABEL_SHIFTS && otherLabels.some((o) => boxesOverlap(boxOf(label), boxOf(o))); n++) {
      label.y -= label.size;
    }
  }
  // District names first, so that they are drawn beneath the building names.
  const finalLabels = [...districtLabels.map(({ movable: _movable, ...label }) => label), ...otherLabels];

  const labelSvg = (label) => {
    const family = escapeXml(`'${S.fonts[label.font]}', serif`);
    const body = escapeXml(label.font === 'realm' ? String(label.text).toUpperCase() : String(label.text));
    const target = escapeXml(label.target ?? '');
    const size = num(label.size);
    const italic = label.font === 'feature' ? ' font-style="italic"' : '';
    const spacing = label.letterSpacing !== undefined ? ` letter-spacing="${num(label.letterSpacing)}"` : '';
    const position = `x="${num(label.x)}" y="${num(label.y)}" text-anchor="middle" font-family="${family}" font-size="${size}"${spacing}${italic}`;
    const place = label.place ? ` class="place" data-place="${escapeXml(label.place)}"` : '';
    const opacity = label.opacity !== undefined ? ` opacity="${fmt(label.opacity)}"` : '';
    let out = '';
    if (label.halo) {
      out += `<text data-target="${target}" ${position} fill="${colour(L.halo)}" stroke="${colour(L.halo)}" `
        + `stroke-width="${num(label.size * L.haloWidth)}" stroke-linejoin="round" opacity="${fmt(L.haloOpacity)}">${body}</text>`;
    }
    out += `<text data-target="${target}"${place} ${position} fill="${colour(label.fill)}"${opacity}>${body}</text>`;
    return out;
  };

  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    '<defs>',
    ...defs,
    '</defs>',
    ...group('ground', ground),
    ...group('green', green),
    ...group('walls', walls),
    ...group('streets', streets),
    ...group('blocks', blocks),
    ...group('buildings', buildings),
    ...group('districts', districts),
    ...group('labels', finalLabels.map(labelSvg)),
    '</svg>',
    '',
  ].join('\n');
  return {
    svg,
    stats: { lots: lotCount, buildings: buildingCount, districts: districts.length, labels: finalLabels.length },
  };
}
