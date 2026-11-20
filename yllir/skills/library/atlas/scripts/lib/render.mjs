// Renderer of the atlas: the layers become one SVG in the look of the chosen style (a hand-painted
// fantasy map by default). Deterministic: the same inputs give a byte-identical SVG (no Math.random,
// no dates). Pure functions, no file access. Every colour, size, font and texture comes from the
// style; the stamps and textures come from the style's manifest. The URLs are built under
// `assetBase`: `<assetBase>styles/<id>/<file>` and `<assetBase>fonts/<file>`.

import { isFinitePoint, isUsablePolygon, pointInPolygon } from './geometry.mjs';
import { planStamps, sortStamps } from './scatter.mjs';
import { DEFAULT_STYLE, FONT_FILES, loadStyle } from './styles.mjs';
import { urbanLayerGroups, bakeGroupSvg, placeHitGroupSvg } from './render-urban.mjs';

const AUDIENCES = ['master', 'players'];
// Urban layers in drawing order (the same order as render-urban.mjs). The labels come after them.
const URBAN_LAYERS = ['ground', 'green', 'walls', 'streets', 'blocks', 'buildings', 'districts'];
// Texture roles of a style (style.json `textures`) and the pattern id of each.
const TEXTURE_ROLES = ['land', 'sand', 'snow', 'sea', 'deepSea'];
// Average advance of a character of the label font, in em (a crude estimate, good enough for fitting).
const CHAR_EM = 0.62;

/** Number for an attribute: at most two decimals, no "-0". */
const num = (value) => String(Math.round(value * 100) / 100 + 0);
/** Number with three decimals, for the fit data attributes. */
const fmt3 = (value) => String(Math.round(value * 1000) / 1000 + 0);

const patternId = (role) => `tex-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** Escapes text for XML (element text and attribute values). */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** SVG path data of a polygon, closed. */
function ringD(polygon) {
  return `M${polygon.map(([x, y]) => `${num(x)} ${num(y)}`).join(' L')} Z`;
}

/** SVG path data of an open line. */
function lineD(points) {
  return `M${points.map(([x, y]) => `${num(x)} ${num(y)}`).join(' L')}`;
}

function signedArea(polygon) {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Area centroid of a polygon, or the vertex mean when the area is empty. */
function centroidOf(polygon) {
  const a = signedArea(polygon);
  if (Math.abs(a) < 1e-9) {
    const n = polygon.length;
    return [polygon.reduce((s, p) => s + p[0], 0) / n, polygon.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/**
 * Colour scaled per channel by a factor (0.6 is 40% darker, 1.2 is 20% lighter, clamped).
 * Invalid colours fall back to a dark grey.
 */
function scaleColour(hex, factor) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex));
  if (!match) return '#444444';
  const n = Number.parseInt(match[1], 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.min(255, Math.round(v * factor)));
  return `#${channels.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Principal axis of a polygon through its centroid: the direction, the centroid and the extent along it. */
function arcGeometry(polygon) {
  const n = polygon.length;
  const mean = [polygon.reduce((s, p) => s + p[0], 0) / n, polygon.reduce((s, p) => s + p[1], 0) / n];
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of polygon) {
    const dx = x - mean[0];
    const dy = y - mean[1];
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let dx = Math.cos(theta);
  let dy = Math.sin(theta);
  if (dx < 0) {
    dx = -dx;
    dy = -dy;
  }
  const [cx, cy] = centroidOf(polygon);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y] of polygon) {
    const t = (x - cx) * dx + (y - cy) * dy;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return { cx, cy, dx, dy, extent: hi - lo };
}

/** Quadratic path data of an arc of the given length through the geometry's centre. Left to right, so the text stays upright. */
function arcPath(geometry, length) {
  const { cx, cy, dx, dy } = geometry;
  const start = [cx - dx * (length / 2), cy - dy * (length / 2)];
  const end = [cx + dx * (length / 2), cy + dy * (length / 2)];
  const nx = -dy;
  const ny = dx;
  const control = [cx - nx * length * 0.1, cy - ny * length * 0.1];
  return `M${num(start[0])} ${num(start[1])} Q${num(control[0])} ${num(control[1])} ${num(end[0])} ${num(end[1])}`;
}

/** Crude advance of a text: characters times size, plus the letter spacing between them. */
export function textAdvance(chars, size, spacing) {
  return chars * size * CHAR_EM + Math.max(0, chars - 1) * spacing;
}

/**
 * Fits a realm name on its arc. Order: shrink the size down to the floor; then shrink the letter
 * spacing down to its minimum share of the size; then lengthen the arc up to 90% of the polygon
 * extent (the default is 60%). Only if the name still does not fit is the size reduced further.
 * The text never exceeds the arc: `advance <= arc` always holds on return.
 * @returns {{ size: number, spacing: number, arc: number, advance: number }}
 */
export function fitArcLabel({ chars, size, ratio, minRatio, extent, floor }) {
  const perSize = chars * CHAR_EM + Math.max(0, chars - 1) * ratio;
  let arc = 0.6 * extent;
  const maxArc = 0.9 * extent;
  let s = size;
  let spacing = s * ratio;

  // 1. Size down, to the floor, with the spacing kept as a share of the size.
  if (textAdvance(chars, s, spacing) > arc) s = Math.min(s, Math.max(floor, arc / perSize));
  spacing = s * ratio;

  // 2. Spacing down, to its minimum share of the size.
  if (textAdvance(chars, s, spacing) > arc && chars > 1) {
    const minSpacing = s * minRatio;
    spacing = Math.max(minSpacing, (arc - chars * CHAR_EM * s) / (chars - 1));
  }

  // 3. Arc longer, up to 90% of the extent.
  if (textAdvance(chars, s, spacing) > arc) arc = Math.min(maxArc, textAdvance(chars, s, spacing));

  // 4. Last resort: the name is too long for the polygon even then, so the size goes below the floor.
  if (textAdvance(chars, s, spacing) > arc) {
    s = arc / (chars * CHAR_EM + Math.max(0, chars - 1) * minRatio);
    spacing = s * minRatio;
  }
  return { size: s, spacing, arc, advance: textAdvance(chars, s, spacing) };
}

/** Visible features of a layer for the audience: master-only items are dropped everywhere. */
function visibleFeatures(layer, audience) {
  const features = Array.isArray(layer?.features) ? layer.features : [];
  return audience === 'players' ? features.filter((f) => f?.visibility !== 'master') : features;
}

/** Size class of a place icon: capital, city, or the other icons. */
const iconKind = (icon) => (icon === 'capital' || icon === 'city' ? icon : 'other');

/**
 * Renders the atlas to SVG.
 * @param {object} options
 * @param {{ canvas: { width: number, height: number }, seed: number }} options.manifest the atlas.json object
 * @param {object} options.layers layer objects `{ layer, features }` by name; any may be missing
 * @param {{ style: object, manifest: object, dir: string }} [options.style] the result of loadStyle (default: fantasy-color)
 * @param {Record<string, string>} [options.names] place id -> display title
 * @param {'master'|'players'} [options.audience]
 * @param {string} [options.assetBase] URL prefix of the styles and fonts
 * @param {boolean} [options.vignette=true] draw the vignette inside the SVG; the viewer draws it itself when false
 * @param {boolean} [options.overlays=true] false: no labels and no place icons, only the drawn map (the input of a bake)
 * @param {{ href: string }|null} [options.bake=null] ONE image replaces everything drawn between the defs and the labels;
 *   the labels stay (SVG text) and every place with a point gets an invisible hit target (`g.place`, see render-urban.mjs)
 * Urban layers, when present, are drawn in the same canvas: their groups go after the places and before
 * the labels (the ground goes right after the sea when there is no terrain land, as the base of the map).
 * Stamps keep off the urban footprint (blocks, green, squares, closed walls, ground water). A place inside
 * a block has no icon. Ambiguity resolved: the urban ground without terrain land is the land of the stamps,
 * and an island or the whole canvas, as in the urban map.
 * Ambiguity resolved (bake): with a bake and overlays false there is no labels group, but the hit targets stay.
 * @returns {{ svg: string, stats: { stamps: number, places: number, labels: number, lots: number, buildings: number, districts: number } }}
 */
export function renderAtlasSvg({
  manifest, layers = {}, style, names = {}, audience = 'master', assetBase = 'assets/', vignette: withVignette = true,
  overlays = true, bake = null,
}) {
  if (!AUDIENCES.includes(audience)) throw new Error(`audience must be one of ${AUDIENCES.join(', ')}`);
  if (bake !== null && (typeof bake !== 'object' || typeof bake.href !== 'string' || bake.href === '')) {
    throw new Error('bake must be { href } or null');
  }
  const bundle = style ?? loadStyle(DEFAULT_STYLE);
  const S = bundle.style;
  const M = bundle.manifest;
  const W = manifest.canvas.width;
  const H = manifest.canvas.height;
  const cell = Math.max(W, H) / 512;
  const tile = Math.max(W, H) / 9;
  const base = escapeXml(assetBase);
  const styleBase = `${base}styles/${escapeXml(S.id)}/`;
  const L = S.labels;
  let uid = 0;

  const textureFile = (role) => {
    const id = S.textures[role];
    const entry = (M.textures ?? []).find((t) => t.id === id);
    if (!entry) throw new Error(`style ${S.id} has no texture ${id}`);
    return entry.file;
  };
  const familyOf = (font) => S.fonts[font];

  const features = {
    terrain: visibleFeatures(layers.terrain, audience),
    relief: visibleFeatures(layers.relief, audience),
    water: visibleFeatures(layers.water, audience),
    biomes: visibleFeatures(layers.biomes, audience),
    political: visibleFeatures(layers.political, audience),
    places: visibleFeatures(layers.places, audience),
    routes: visibleFeatures(layers.routes, audience),
  };
  const labelOverrides = visibleFeatures(layers.labels, audience);

  const landPolygons = features.terrain.filter((f) => f.type === 'land' && isUsablePolygon(f.polygon)).map((f) => f.polygon);
  const terrainLakes = features.terrain.filter((f) => f.type === 'lake' && isUsablePolygon(f.polygon)).map((f) => f.polygon);
  const waterLakes = features.water.filter((f) => f.type === 'lake' && isUsablePolygon(f.polygon)).map((f) => f.polygon);
  const rivers = features.water.filter((f) => f.type === 'river' && Array.isArray(f.path) && f.path.length >= 2 && f.path.every(isFinitePoint));
  const places = features.places.filter((f) => isFinitePoint(f.at));
  const iconStamps = new Map((M.stamps ?? []).map((s) => [s.id, s]));

  // Urban layers (settlement and district scale) in the same canvas, when the atlas has any.
  // Mixed map: the terrain is the base. Without terrain land, the urban ground is the base (an island or the
  // whole canvas), and it is also the land the stamps may stand on.
  const urbanFeatures = Object.fromEntries(URBAN_LAYERS.map((name) => [name, visibleFeatures(layers[name], audience)]));
  const hasUrban = URBAN_LAYERS.some((name) => urbanFeatures[name].length > 0);
  const polygonsOf = (name, keep = () => true) => urbanFeatures[name]
    .filter((f) => keep(f) && isUsablePolygon(f.polygon))
    .map((f) => f.polygon);
  const urbanBlocks = polygonsOf('blocks', (f) => f.type === 'block');
  const canvasRect = [[0, 0], [W, 0], [W, H], [0, H]];
  const urbanLand = polygonsOf('ground', (f) => f.type === 'land');
  const stampLand = landPolygons.length > 0 ? landPolygons : (hasUrban ? (urbanLand.length > 0 ? urbanLand : [canvasRect]) : []);
  // Stamps keep off the urban footprint: blocks, green, squares, the inside of closed walls, and the water of the ground.
  const urbanFootprint = hasUrban ? [
    ...urbanBlocks,
    ...polygonsOf('green'),
    ...polygonsOf('streets', (f) => f.type === 'square'),
    ...urbanFeatures.walls.filter((f) => f.type === 'wall' && f.closed === true && isUsablePolygon(f.path)).map((f) => f.path),
    ...polygonsOf('ground', (f) => f.type === 'water'),
  ] : [];
  const buildingPlaces = new Set(urbanFeatures.buildings.map((f) => f.place));

  const defs = [];
  const sea = [];
  const terrain = [];
  const biomes = [];
  const water = [];
  const political = [];
  const routes = [];
  const stampGroup = [];
  const placeGroup = [];
  const labelGroup = [];
  let labelCount = 0;

  // Fonts, textures, filters and gradient.
  const families = [...new Set(Object.values(S.fonts))];
  defs.push(
    '<style>',
    ...families.map((family) => `@font-face { font-family: '${escapeXml(family)}'; src: url('${base}${FONT_FILES[family]}'); }`),
    '</style>',
  );
  for (const role of TEXTURE_ROLES) {
    defs.push(
      `<pattern id="${patternId(role)}" patternUnits="userSpaceOnUse" x="0" y="0" width="${num(tile)}" height="${num(tile)}">`
      + `<image href="${styleBase}${escapeXml(textureFile(role))}" x="0" y="0" width="${num(tile)}" height="${num(tile)}"/></pattern>`,
    );
  }
  defs.push(
    `<filter id="f-glow" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">`
    + `<feGaussianBlur stdDeviation="${num(cell * S.sea.glow.blur)}"/></filter>`,
    `<filter id="f-soft" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">`
    + `<feGaussianBlur stdDeviation="${num(cell * S.masks.blur)}"/></filter>`,
  );
  if (withVignette) {
    defs.push(
      '<radialGradient id="vignette" cx="50%" cy="50%" r="71%">'
      + '<stop offset="60%" stop-color="' + escapeXml(S.vignette.color) + '" stop-opacity="0"/>'
      + `<stop offset="100%" stop-color="${escapeXml(S.vignette.color)}" stop-opacity="${num(S.vignette.opacity)}"/></radialGradient>`,
    );
  }
  // The sea fades to nothing over the outer 6% of each side: two linear masks, nested, so their product fades both ways.
  const EDGE = 0.06;
  const fadeMask = (id, axis) => {
    const gradient = `${id}-gradient`;
    const span = axis === 'x' ? `x1="0" x2="${W}" y1="0" y2="0"` : `x1="0" x2="0" y1="0" y2="${H}"`;
    defs.push(
      `<linearGradient id="${gradient}" gradientUnits="userSpaceOnUse" ${span}>`
      + `<stop offset="0" stop-color="#000000"/><stop offset="${EDGE}" stop-color="#ffffff"/>`
      + `<stop offset="${1 - EDGE}" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient>`,
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">`
      + `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#${gradient})"/></mask>`,
    );
  };
  fadeMask('sea-fade-x', 'x');
  fadeMask('sea-fade-y', 'y');

  // Helpers that add defs and return the id.
  const clipFor = (polygon) => {
    const id = `clip-${++uid}`;
    defs.push(`<clipPath id="${id}"><path d="${ringD(polygon)}"/></clipPath>`);
    return id;
  };
  const maskFor = (polygon) => {
    const id = `mask-${++uid}`;
    defs.push(
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">`
      + `<path d="${ringD(polygon)}" fill="#ffffff" filter="url(#f-soft)"/></mask>`,
    );
    return id;
  };
  // Realm borders are hidden within coastGap / 2 cells of a coast: white everywhere, black along the land outlines.
  defs.push(
    '<mask id="border-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="' + W + '" height="' + H + '">'
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`
    + `<g fill="none" stroke="#000000" stroke-width="${num(cell * S.borders.coastGap)}" stroke-linejoin="round">`
    + landPolygons.map((polygon) => `<path d="${ringD(polygon)}"/>`).join('')
    + '</g></mask>',
  );

  // 1. Sea: deep-sea fill, shallow glow along the coasts.
  sea.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#${patternId('deepSea')})"/>`);
  if (landPolygons.length > 0) {
    sea.push(
      `<g filter="url(#f-glow)" opacity="${num(S.sea.glow.opacity)}"><g fill="none" stroke="url(#${patternId('sea')})" `
      + `stroke-width="${num(cell * S.sea.glow.width)}" stroke-linejoin="round">`,
    );
    for (const polygon of landPolygons) sea.push(`<path d="${ringD(polygon)}"/>`);
    sea.push('</g></g>');
  }

  // Lakes, drawn the same way in the terrain and in the water layers.
  const lakeSvg = (polygons) => {
    const out = [];
    for (const polygon of polygons) {
      const clip = clipFor(polygon);
      const d = ringD(polygon);
      out.push(
        `<path d="${d}" fill="url(#${patternId('sea')})"/>`,
        `<path d="${d}" fill="none" stroke="${escapeXml(S.lakes.highlight.color)}" stroke-opacity="${num(S.lakes.highlight.opacity)}" `
        + `stroke-width="${num(cell * S.lakes.highlight.width)}" clip-path="url(#${clip})"/>`,
        `<path d="${d}" fill="none" stroke="${escapeXml(S.coast.color)}" stroke-width="${num(cell * S.coast.width)}" stroke-linejoin="round"/>`,
      );
    }
    return out;
  };

  // 2. Coast ripples, outermost first, then 3. land with its shade and coastline.
  terrain.push('<g id="layer-terrain" data-layer="terrain">');
  const ripples = S.sea.ripples;
  for (let k = ripples.count; k >= 1; k--) {
    terrain.push(
      `<g fill="none" stroke="${escapeXml(ripples.color)}" stroke-opacity="${num(Math.max(0, ripples.opacity - k * ripples.step))}" `
      + `stroke-width="${num(cell * (ripples.base + k * ripples.spacing))}" stroke-linejoin="round">`,
    );
    for (const polygon of landPolygons) terrain.push(`<path d="${ringD(polygon)}"/>`);
    terrain.push('</g>');
  }
  for (const polygon of landPolygons) {
    const clip = clipFor(polygon);
    const d = ringD(polygon);
    terrain.push(
      `<path d="${d}" fill="url(#${patternId('land')})"/>`,
      `<path d="${d}" fill="none" stroke="${escapeXml(S.coast.shade.color)}" stroke-opacity="${num(S.coast.shade.opacity)}" `
      + `stroke-width="${num(cell * S.coast.shade.width)}" clip-path="url(#${clip})"/>`,
      `<path d="${d}" fill="none" stroke="${escapeXml(S.coast.color)}" stroke-width="${num(cell * S.coast.width)}" stroke-linejoin="round"/>`,
    );
  }
  terrain.push(...lakeSvg(terrainLakes), '</g>');

  // 4. Biomes: sand and snow through a soft mask, a faint tint for forests.
  biomes.push('<g id="layer-biomes" data-layer="biomes">');
  for (const f of features.biomes) {
    if (!isUsablePolygon(f.polygon)) continue;
    const fill = {
      desert: `url(#${patternId('sand')})`,
      ice: `url(#${patternId('snow')})`,
      forest: escapeXml(S.forestTint.color),
    }[f.type];
    if (fill === undefined) continue;
    const mask = maskFor(f.polygon);
    const opacity = f.type === 'forest' ? ` fill-opacity="${num(S.forestTint.opacity)}"` : '';
    biomes.push(`<path d="${ringD(f.polygon)}" fill="${fill}"${opacity} mask="url(#${mask})"/>`);
  }
  biomes.push('</g>');

  // 5. Rivers: a pale band under a blue line.
  water.push('<g id="layer-water" data-layer="water">', ...lakeSvg(waterLakes));
  for (const river of rivers) {
    const d = lineD(river.path);
    water.push(
      `<path d="${d}" fill="none" stroke="${escapeXml(S.rivers.under)}" stroke-width="${num(cell * S.rivers.underWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`,
      `<path d="${d}" fill="none" stroke="${escapeXml(S.rivers.color)}" stroke-width="${num(cell * S.rivers.width)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
  water.push('</g>');

  // 6. Borders: each realm polygon tinted, then a dashed border that stops at the coasts.
  const borderStrokes = [];
  const B = S.borders;
  political.push('<g id="layer-political" data-layer="political">');
  for (const realm of features.political) {
    const polygons = realmPolygons(realm);
    const color = escapeXml(realm.color ?? '#444444');
    for (const polygon of polygons) {
      const d = ringD(polygon);
      political.push(`<path d="${d}" fill="${color}" fill-opacity="${num(B.fillOpacity)}"/>`);
      borderStrokes.push(
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${num(cell * B.width)}" `
        + `stroke-dasharray="${num(cell * B.dash[0])} ${num(cell * B.dash[1])}" stroke-opacity="${num(B.opacity)}"/>`,
      );
    }
  }
  political.push('<g mask="url(#border-mask)">', ...borderStrokes, '</g>', '</g>');

  // 7. Routes.
  const R = S.routes;
  routes.push('<g id="layer-routes" data-layer="routes">');
  for (const route of features.routes) {
    if (!Array.isArray(route.path) || route.path.length < 2 || !route.path.every(isFinitePoint)) continue;
    const d = lineD(route.path);
    if (route.type === 'road') {
      routes.push(`<path d="${d}" fill="none" stroke="${escapeXml(R.road.color)}" stroke-width="${num(cell * R.road.width)}" stroke-dasharray="${num(cell * R.road.dash[0])} ${num(cell * R.road.dash[1])}"/>`);
    } else if (route.type === 'trail') {
      routes.push(`<path d="${d}" fill="none" stroke="${escapeXml(R.trail.color)}" stroke-width="${num(cell * R.trail.width)}" stroke-dasharray="${num(cell * R.trail.dash[0])} ${num(cell * R.trail.dash[1])}"/>`);
    } else if (route.type === 'sea-route') {
      routes.push(
        `<path d="${d}" fill="none" stroke="${escapeXml(R.sea.color)}" stroke-width="${num(cell * R.sea.width)}" `
        + `stroke-dasharray="${num(cell * R.sea.dash[0])} ${num(cell * R.sea.dash[1])}" stroke-opacity="${num(R.sea.opacity)}"/>`,
      );
    }
  }
  routes.push('</g>');

  // 8. Stamps: relief and biomes in one sorted group, each image marked with its layer.
  const stamps = sortStamps(planStamps({
    assets: M,
    cell,
    seed: manifest.seed,
    relief: features.relief,
    biomes: features.biomes,
    land: stampLand,
    water: [...terrainLakes, ...waterLakes, ...urbanFootprint],
    places: places.map((p) => p.at),
    stampScale: S.stamps.scale,
    mirrorTrees: S.stamps.mirrorTrees,
  }));
  stampGroup.push('<g id="layer-stamps">');
  for (const s of stamps) {
    const [px, py] = s.point;
    const [ax, ay] = s.anchor;
    const x = px - ax * s.width;
    const y = py - ay * s.height;
    const transform = s.mirror ? ` transform="translate(${num(2 * px)} 0) scale(-1 1)"` : '';
    stampGroup.push(
      `<image href="${styleBase}${escapeXml(s.file)}" x="${num(x)}" y="${num(y)}" width="${num(s.width)}" height="${num(s.height)}" `
      + `preserveAspectRatio="none" data-layer="${s.layer}" data-anchor="${num(px)},${num(py)}"${transform}/>`,
    );
  }
  stampGroup.push('</g>');

  // 9. Places: an icon on each place, centred on its point.
  placeGroup.push('<g id="layer-places" data-layer="places">');
  const placeIcons = new Map();
  const hiddenIcons = new Set();
  for (const place of places) {
    const icon = iconStamps.get(`icons-${place.icon}`);
    const aspect = icon ? icon.height / icon.width : 1;
    const width = cell * S.icons[iconKind(place.icon)];
    const height = width * aspect;
    placeIcons.set(place.id, height);
    // A place inside a block is drawn by its buildings instead of by an icon.
    if (urbanBlocks.some((block) => pointInPolygon(place.at, block))) {
      hiddenIcons.add(place.id);
      continue;
    }
    const x = place.at[0] - width / 2;
    const y = place.at[1] - height / 2;
    const href = icon ? icon.file : `stamps/icons/${place.icon}.webp`;
    placeGroup.push(
      `<g class="place" data-place="${escapeXml(place.id)}" data-layer="places">`
      + `<image href="${styleBase}${escapeXml(href)}" x="${num(x)}" y="${num(y)}" `
      + `width="${num(width)}" height="${num(height)}" preserveAspectRatio="none"/></g>`,
    );
  }
  placeGroup.push('</g>');

  // 9b. Urban groups and their defs. The geographic defs already hold the fonts and the textures they share
  // with the urban ones (same ids, same files), so only the new ids are added.
  const urban = hasUrban ? urbanLayerGroups({ layers, style: bundle, names, audience, canvas: manifest.canvas, assetBase }) : null;
  if (urban) {
    const known = new Set(defs.map((d) => /^<pattern id="([^"]+)"/.exec(d)?.[1]).filter((id) => id !== undefined));
    for (const d of urban.defs) {
      if (d === '<style>' || d === '</style>' || d.startsWith('@font-face')) continue;
      const id = /^<pattern id="([^"]+)"/.exec(d)?.[1];
      if (id !== undefined && known.has(id)) continue;
      defs.push(d);
    }
  }
  // The urban ground is drawn right after the sea when it is the base (no terrain land); otherwise with the
  // other urban layers. Empty groups are left out.
  const urbanSvg = (wanted) => (urban ? wanted.filter((name) => urban.stats.counts[name] > 0).map((name) => urban.groups[name]) : []);
  const groundIsBase = landPolygons.length === 0;
  const underlayGroups = groundIsBase ? urbanSvg(['ground']) : [];
  const overGroups = urbanSvg(groundIsBase ? URBAN_LAYERS.slice(1) : URBAN_LAYERS);

  // 10. Labels: computed ones first, then the overrides of the labels layer.
  const computed = new Map();
  for (const place of places) {
    const title = names[place.place];
    if (typeof title !== 'string' || title.length === 0) continue;
    if (hiddenIcons.has(place.id) && buildingPlaces.has(place.place)) continue;
    const size = cell * L.placeSize[iconKind(place.icon)];
    const iconHeight = placeIcons.get(place.id);
    computed.set(`places/${place.id}`, {
      kind: 'point', text: title, x: place.at[0], y: place.at[1] + iconHeight / 2 + size,
      size, font: 'place', fill: L.fill, halo: true,
    });
  }
  for (const realm of features.political) {
    const title = typeof realm.name === 'string' && realm.name.length > 0 ? realm.name : names[realm.place];
    if (typeof title !== 'string' || title.length === 0) continue;
    const polygons = realmPolygons(realm);
    if (polygons.length === 0) continue;
    const largest = polygons.reduce((best, p) => (Math.abs(signedArea(p)) > Math.abs(signedArea(best)) ? p : best));
    const area = polygons.reduce((s, p) => s + Math.abs(signedArea(p)), 0);
    const realmSize = L.realmSize;
    const size = Math.min(cell * realmSize.max, Math.max(cell * realmSize.min, Math.sqrt(area) / realmSize.areaDivisor));
    const geometry = arcGeometry(largest);
    const fit = fitArcLabel({
      chars: Array.from(title).length,
      size,
      ratio: L.realmSpacing,
      minRatio: L.realmSpacingMin,
      extent: geometry.extent,
      floor: cell * realmSize.fitMin,
    });
    computed.set(`political/${realm.id}`, {
      kind: 'arc', text: title, path: arcPath(geometry, fit.arc), arc: fit.arc, advance: fit.advance,
      size: fit.size, font: 'realm', fill: scaleColour(realm.color, 1 - L.realmDarken), opacity: L.realmOpacity,
      halo: false, letterSpacing: fit.spacing,
    });
  }

  const targetExists = (target) => {
    const match = /^([a-z]+)\/(.+)$/.exec(String(target));
    if (match === null || match[1] === 'labels' || !features[match[1]]) return false;
    return features[match[1]].some((f) => f.id === match[2]);
  };
  const overrides = new Map();
  for (const label of labelOverrides) overrides.set(label.target, label);

  const finalLabels = [];
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
    finalLabels.push(merged);
  }
  for (const [target, override] of overrides) {
    if (computed.has(target) || override.hidden === true) continue;
    if (!targetExists(target) || typeof override.text !== 'string' || !Array.isArray(override.at)) continue;
    const size = override.size ?? cell * L.featureSize;
    finalLabels.push({
      target, kind: 'point', text: override.text, x: override.at[0], y: override.at[1],
      size, font: 'feature', fill: L.featureFill, halo: false, letterSpacing: size * L.featureSpacing,
    });
  }

  labelGroup.push('<g id="layer-labels" data-layer="labels">');
  // Without overlays there are no labels: nothing is drawn, and no arc path is added to the defs.
  for (const label of overlays ? finalLabels : []) {
    labelCount++;
    labelGroup.push(labelSvg(label, defs, () => ++uid, { family: familyOf(label.font), labels: L }));
  }
  // The urban labels (building names, district names and the labels-layer overrides for urban targets) follow the geographic ones.
  if (urban && overlays) {
    for (const label of urban.labels) {
      labelCount++;
      labelGroup.push(label);
    }
  }
  labelGroup.push('</g>');

  // 11. Vignette.
  const vignette = withVignette
    ? [`<g id="layer-vignette"><rect x="0" y="0" width="${W}" height="${H}" fill="url(#vignette)"/></g>`]
    : [];

  // The drawn map: every layer from the sea to the urban groups, or ONE bake image in its place. The place icons
  // are part of the drawn map, so they go with the overlays. The bake's hit targets come after the labels.
  const drawnMap = bake
    ? [bakeGroupSvg(bake, W, H)]
    : [
      '<g id="layer-sea"><g mask="url(#sea-fade-x)"><g mask="url(#sea-fade-y)">',
      ...sea,
      '</g></g></g>',
      ...underlayGroups,
      ...terrain,
      ...biomes,
      ...water,
      ...political,
      ...routes,
      ...stampGroup,
      ...(overlays ? placeGroup : []),
      ...overGroups,
    ];
  const hitTargets = bake ? [placeHitGroupSvg(layers, audience, cell)] : [];
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    '<defs>',
    ...defs,
    '</defs>',
    ...drawnMap,
    ...(overlays ? labelGroup : []),
    ...hitTargets,
    ...vignette,
    '</svg>',
    '',
  ].join('\n');
  const urbanStats = urban?.stats ?? { lots: 0, buildings: 0, districts: 0 };
  return {
    svg,
    stats: {
      stamps: stamps.length,
      places: places.length,
      labels: overlays ? labelCount : 0,
      lots: urbanStats.lots,
      buildings: urbanStats.buildings,
      districts: urbanStats.districts,
    },
  };
}

/** Polygons of a realm: `polygons` (a list) or a single `polygon`, usable ones only. */
function realmPolygons(realm) {
  const list = Array.isArray(realm.polygons) ? realm.polygons : [realm.polygon];
  return list.filter(isUsablePolygon);
}

/** SVG of one label. Halo first (same text, stroked), then the fill. */
function labelSvg(label, defs, nextId, { family, labels }) {
  const target = escapeXml(label.target ?? '');
  const familyAttr = escapeXml(`'${family}', serif`);
  const text = label.font === 'realm' ? String(label.text).toUpperCase() : String(label.text);
  const body = escapeXml(text);
  const size = num(label.size);
  if (label.kind === 'arc') {
    const id = `arc-${nextId()}`;
    defs.push(`<path id="${id}" d="${label.path}" fill="none"/>`);
    const spacing = label.letterSpacing !== undefined ? ` letter-spacing="${num(label.letterSpacing)}"` : '';
    return `<text class="realm-label" data-target="${target}" data-arc="${fmt3(label.arc)}" data-advance="${fmt3(label.advance)}" `
      + `font-family="${familyAttr}" font-size="${size}"${spacing} fill="${escapeXml(label.fill)}" opacity="${num(label.opacity)}">`
      + `<textPath href="#${id}" startOffset="50%" text-anchor="middle">${body}</textPath></text>`;
  }
  const italic = label.font === 'feature' ? ' font-style="italic"' : '';
  const spacing = label.letterSpacing !== undefined ? ` letter-spacing="${num(label.letterSpacing)}"` : '';
  const position = `x="${num(label.x)}" y="${num(label.y)}" text-anchor="middle" font-family="${familyAttr}" font-size="${size}"${spacing}${italic}`;
  let out = '';
  if (label.halo) {
    out += `<text data-target="${target}" ${position} fill="${escapeXml(labels.halo)}" stroke="${escapeXml(labels.halo)}" `
      + `stroke-width="${num(label.size * labels.haloWidth)}" stroke-linejoin="round" opacity="${num(labels.haloOpacity)}">${body}</text>`;
  }
  out += `<text data-target="${target}" ${position} fill="${escapeXml(label.fill)}">${body}</text>`;
  return out;
}
