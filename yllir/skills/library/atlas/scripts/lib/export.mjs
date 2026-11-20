// Export of the atlas as a static site, for the master or for the players. The site is one index.html
// (the overlay SVG drawn over the painted base, and the page data inline: no fetch, so it opens from disk)
// and a viewer under assets/. Labels, borders and place markers come from the data; the base picture is
// the only picture. The players' build is checked before it replaces the previous folder; a failed check
// keeps the previous folder. Deterministic: two exports give the same index.html. Only report.json holds the time.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAtlas, validateAtlas, atlasFolder, isPlainObject } from './model.mjs';
import { loadStyle, resolveStyleId, FONT_FILES } from './styles.mjs';
import { runAtlasChecks, reservedLinesOf } from './checks.mjs';
import { stringsFor } from './strings.mjs';
import { computeTerritories, maskToPaths, territoryCentroid } from './territory.mjs';
import { imageFromFile } from './image.mjs';
import { imageToMask } from './mask.mjs';
import { seaFileOf } from './sea.mjs';
import { folderOfPlace } from './pending.mjs';
import { buildWorldIndex } from '../../../../../scripts/lib/world-graph.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { publicBody, isPublicDocument } from '../../../../../scripts/lib/public-text.mjs';
import { pluginRootFromHere } from '../../../../../scripts/lib/adapter.mjs';

const AUDIENCES = ['master', 'players'];
const SITE_DIR = fileURLToPath(new URL('../../site/', import.meta.url));
const ASSETS_DIR = fileURLToPath(new URL('../../assets/', import.meta.url));
const DEFAULT_BASE_URL = 'http://localhost/';
const SUMMARY_MAX = 400;
const SITE_CACHE = path.join('.campaign', 'cache', 'atlas');
const VIEWER_FILES = ['viewer.js', 'viewer.css'];
const LAYERS = ['borders', 'labels', 'places'];
const CSP = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'";

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const refused = (problems) => ({ ok: false, dir: null, stats: null, checks: [], problems });
const problem = (code, file, where, message) => ({ code, file, path: where, message });

/** XML escape for text nodes and attribute values. */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Coordinates and sizes: at most two decimals, no trailing zeros, so the output is stable. */
const fmt = (value) => String(Math.round(value * 100) / 100);

/** The campaign's campaign.yaml, parsed; or the problem that stops the export. */
function readConfig(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8');
  } catch {
    return { error: problem('missing-file', 'campaign.yaml', '', 'campaign.yaml cannot be read') };
  }
  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0 || !isPlainObject(parsed.data)) {
    const detail = parsed.errors[0]?.message ?? 'campaign.yaml must be a mapping';
    return { error: problem('yaml', 'campaign.yaml', '', detail) };
  }
  return { config: parsed.data };
}

/**
 * The summary of a sheet: its first paragraph after the title, as plain text. Markdown emphasis is
 * removed, links keep their text, HTML comments go. Longer than 400 characters it is cut at a word
 * boundary and ends with an ellipsis.
 */
export function summaryOf(body) {
  const lines = String(body).replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const paragraph = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (paragraph.length === 0) {
      if (line === '' || line.startsWith('#')) continue;
      paragraph.push(line);
    } else {
      if (line === '' || line.startsWith('#')) break;
      paragraph.push(line);
    }
  }
  const text = paragraph.join(' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(text);
  if (chars.length <= SUMMARY_MAX) return text;
  let cut = chars.slice(0, SUMMARY_MAX - 1).join('');
  const space = cut.lastIndexOf(' ');
  if (space > 0) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

/** JSON for an inline script that is not executed: every character that could end or open markup is escaped. */
function inlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function pageHtml({ lang, title, svg, dataJson }) {
  return [
    '<!doctype html>',
    `<html lang="${escapeXml(lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeXml(CSP)}">`,
    `<title>${escapeXml(title)}</title>`,
    '<link rel="stylesheet" href="assets/viewer.css">',
    '<script src="assets/viewer.js" defer></script>',
    '</head>',
    '<body>',
    `<div id="map"><div id="stage">${svg}</div></div>`,
    `<script type="application/json" id="atlas-data">${dataJson}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** A region with no usable position: it is placed at the centre of its territory. */
function needsPlacement(item) {
  return isPlainObject(item) && typeof item.territory === 'string' && (!isFiniteNumber(item.x) || !isFiniteNumber(item.y));
}

/** Darkens a #rrggbb colour by a share of its channels (0.4 gives 60% of each channel). */
function darken(hex, share) {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.round(((n >> shift) & 255) * (1 - share)).toString(16).padStart(2, '0');
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** One label as an SVG text element. Sizes of the halo and the spacing are shares of the font size. */
function textElement({ text, x, y, size, family, fill, fillOpacity = 1, spacing = 0, italic = false, halo }) {
  const attrs = [
    `x="${fmt(x)}"`,
    `y="${fmt(y)}"`,
    `font-family="${escapeXml(`'${family}', serif`)}"`,
    `font-size="${fmt(size)}"`,
    `fill="${fill}"`,
    `fill-opacity="${fmt(fillOpacity)}"`,
    'text-anchor="middle"',
    'dominant-baseline="middle"',
  ];
  if (spacing > 0) attrs.push(`letter-spacing="${fmt(spacing * size)}"`);
  if (italic) attrs.push('font-style="italic"');
  attrs.push(
    `stroke="${halo.color}"`,
    `stroke-opacity="${fmt(halo.opacity)}"`,
    `stroke-width="${fmt(halo.width * size)}"`,
    'paint-order="stroke"',
    'stroke-linejoin="round"',
  );
  return `<text ${attrs.join(' ')}>${escapeXml(text)}</text>`;
}

/**
 * Everything the export needs for one audience: the checked atlas, the filtered items, the territory masks,
 * the overlay SVG and the place records. Returns `{ problems }` when the atlas cannot be exported.
 */
function prepare(root, { audience, pluginRoot }) {
  const players = audience === 'players';
  const atlas = readAtlas(root);
  const worldIndex = buildWorldIndex(root);

  // 1. The atlas must be valid. A region with no position is allowed (placed below), so its position problem is skipped.
  const problems = validateAtlas(root, atlas, { worldIndex }).filter((p) => {
    const match = /^regions\[(\d+)\]$/.exec(p.path ?? '');
    return !(p.code === 'bad-label' && match && needsPlacement(atlas.labels?.regions?.[Number(match[1])]));
  });
  if (problems.length > 0) return { problems };

  // 2. Campaign language, settings, and the sheets of the places.
  const read = readConfig(root);
  if (read.error) return { problems: [read.error] };
  const config = read.config;
  const lang = typeof config.language?.main === 'string' ? config.language.main : 'en';
  const strings = stringsFor(lang);
  const subjects = new Map(worldIndex.subjects.map((subject) => [subject.id, subject]));
  const encyclopediaOn = config.modules?.encyclopedia === true;
  const configuredBase = config.encyclopedia?.base_url;
  const baseUrl = `${(typeof configuredBase === 'string' && configuredBase.trim() !== '' ? configuredBase : DEFAULT_BASE_URL).replace(/\/+$/, '')}/`;

  // 3. The pictures: the base (copied to the site) and the land mask (for the territories).
  const { manifest, dir } = atlas;
  const folder = atlasFolder(root);
  const { width, height } = manifest.canvas;
  if (manifest.base === undefined) {
    return { problems: [problem('missing-file', path.posix.join(folder, 'base.png'), 'base', 'the atlas has no base picture')] };
  }
  const basePath = path.join(dir, manifest.base.file);
  const landPath = path.join(dir, manifest.land?.file ?? 'land.png');
  for (const file of [basePath, landPath]) {
    if (!fs.existsSync(file)) {
      return { problems: [problem('missing-file', path.posix.join(folder, path.basename(file)), '', `${path.basename(file)} is missing`)] };
    }
  }
  let landMask;
  try {
    const landImage = imageFromFile(landPath);
    if (landImage.width !== width || landImage.height !== height) {
      return { problems: [problem('bad-picture', path.posix.join(folder, path.basename(landPath)), '', 'the land mask must have the size of the canvas')] };
    }
    landMask = imageToMask(landImage);
  } catch (err) {
    return { problems: [problem('bad-picture', path.posix.join(folder, path.basename(landPath)), '', err.message)] };
  }
  // The sea texture is sea.png in the atlas folder, when there is one (flat colour otherwise). It must decode as a PNG.
  const seaFile = seaFileOf(dir);
  let seaPath = null;
  if (fs.existsSync(seaFile)) {
    try {
      imageFromFile(seaFile);
    } catch (err) {
      return { problems: [problem('bad-picture', path.posix.join(folder, 'sea.png'), '', err.message)] };
    }
    seaPath = seaFile;
  }

  // 4. The style.
  let style;
  try {
    const resolved = resolveStyleId({ atlasStyle: manifest.style, campaignConfig: config, pluginRoot });
    style = loadStyle(resolved.id).style;
  } catch (err) {
    return { problems: [problem(err.code ?? 'render', 'atlas.json', 'style', err.message)] };
  }

  // 5. The audience filter. For players: master items go; a territory goes when it is master or when every region
  // of it is master (a secret realm); a region of a dropped territory goes; a place whose sheet is not public goes.
  // A territory that a kept one subtracts and that is dropped is removed from that subtract list.
  const labels = structuredClone(atlas.labels);
  const regionsOf = (territoryId) => labels.regions.filter((r) => r.territory === territoryId);
  const hiddenItem = (item) => players && item.visibility === 'master';
  const droppedTerritories = new Set(labels.territories
    .filter((t) => players && (t.visibility === 'master'
      || (regionsOf(t.id).length > 0 && regionsOf(t.id).every(hiddenItem))))
    .map((t) => t.id));
  const hiddenPlace = (item) => hiddenItem(item) || (players && !isPublicDocument(subjects.get(item.place).file, config));
  const kept = {
    lands: labels.lands.filter((item) => !hiddenItem(item)),
    nature: labels.nature.filter((item) => !hiddenItem(item)),
    regions: labels.regions.filter((r) => !hiddenItem(r) && !droppedTerritories.has(r.territory)),
    places: labels.places.filter((item) => !hiddenPlace(item)),
    territories: labels.territories
      .filter((t) => !droppedTerritories.has(t.id))
      .map((t) => (Array.isArray(t.subtract) ? { ...t, subtract: t.subtract.filter((id) => !droppedTerritories.has(id)) } : t)),
  };
  const hiddenIds = new Set();
  for (const group of ['lands', 'regions', 'nature', 'places', 'territories']) {
    const keptIds = new Set(kept[group].map((item) => item.id));
    for (const item of labels[group]) if (!keptIds.has(item.id)) hiddenIds.add(item.id);
  }

  // 6. Territories (masks), then the regions without a position.
  let masks;
  try {
    masks = computeTerritories(landMask, kept.territories);
  } catch (err) {
    return { problems: [problem('territory', path.posix.join(folder, 'labels.json'), 'territories', err.message)] };
  }
  const regions = [];
  for (const region of kept.regions) {
    if (!needsPlacement(region)) {
      regions.push(region);
      continue;
    }
    const mask = masks.get(region.territory);
    const centre = mask ? territoryCentroid(mask) : null;
    if (centre === null) {
      return { problems: [problem('bad-label', path.posix.join(folder, 'labels.json'), `regions[${region.id}]`, `territory ${region.territory} has no land to place ${region.id} on`)] };
    }
    regions.push({ ...region, x: centre[0], y: centre[1] });
  }

  // 7. Places: the sheet gives the name, the summary and the parent; the players get no file paths.
  const placeSubjects = worldIndex.subjects.filter((s) => s.kind === 'place');
  const parentOf = (subject) => {
    let best = null;
    for (const other of placeSubjects) {
      if (other.id === subject.id) continue;
      const parentFolder = folderOfPlace(other);
      if (parentFolder === null || !subject.file.startsWith(parentFolder)) continue;
      if (best === null || parentFolder.length > best.folder.length) best = { id: other.id, folder: parentFolder };
    }
    if (best === null) return null;
    if (players && !isPublicDocument(subjects.get(best.id).file, config)) return null;
    return best.id;
  };
  const places = kept.places.map((item) => {
    const subject = subjects.get(item.place);
    const text = fs.readFileSync(path.join(root, subject.file), 'utf8');
    let url = subject.file;
    if (players) url = encyclopediaOn ? `${baseUrl}e/${subject.id}/` : null;
    return {
      id: item.id,
      name: subject.title,
      x: item.x,
      y: item.y,
      kind: item.kind,
      summary: summaryOf(publicBody(text)),
      sources: players ? [] : [{ file: subject.file }],
      url,
      parent: parentOf(subject),
    };
  });

  // 8. Overlay: borders (territory outlines), then labels. Markers are the viewer's.
  const borderStyle = style.borders;
  const colorOf = new Map(kept.territories.map((t) => [t.id, t.color]));
  const borders = [];
  let territoriesDrawn = 0;
  for (const territory of kept.territories) {
    const paths = maskToPaths(masks.get(territory.id));
    if (paths.length === 0) continue;
    territoriesDrawn += 1;
    const dash = borderStyle.dash.join(' ');
    borders.push(`<g data-territory="${escapeXml(territory.id)}">`);
    for (const d of paths) {
      borders.push(`<path d="${d}" fill="${territory.color}" fill-opacity="${fmt(borderStyle.fillOpacity)}" stroke="${territory.color}" stroke-width="${fmt(borderStyle.width)}" stroke-dasharray="${dash}" stroke-opacity="${fmt(borderStyle.opacity)}" fill-rule="evenodd"/>`);
    }
    borders.push('</g>');
  }

  const L = style.labels;
  const halo = { color: L.halo, opacity: L.haloOpacity, width: L.haloWidth };
  const labelSvg = [];
  for (const item of kept.lands) {
    labelSvg.push(textElement({ text: item.text.toUpperCase(), x: item.x, y: item.y, size: item.size, family: style.fonts.realm, fill: L.fill, spacing: L.landSpacing, halo }));
  }
  for (const item of regions) {
    labelSvg.push(textElement({
      text: item.text, x: item.x, y: item.y, size: item.size, family: style.fonts.feature,
      fill: darken(colorOf.get(item.territory), 0.4), fillOpacity: L.regionOpacity, italic: true, halo,
    }));
  }
  for (const item of kept.nature) {
    labelSvg.push(textElement({ text: item.text, x: item.x, y: item.y, size: item.size, family: style.fonts.feature, fill: L.featureFill, halo }));
  }

  // With a sea texture, the base picture fades out at its four edges so it blends into the sea behind it.
  const baseImage = `<image href="assets/base.png" x="0" y="0" width="${width}" height="${height}"/>`;
  const svg = [
    `<svg id="overlay" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`,
    ...(seaPath === null ? [] : ['<defs>', ...featherDefs(width, height), '</defs>']),
    seaPath === null
      ? baseImage
      : `<g mask="url(#feather-mx)"><g mask="url(#feather-my)">${baseImage}</g></g>`,
    '<g data-layer="borders">',
    ...borders,
    '</g>',
    '<g data-layer="labels">',
    ...labelSvg,
    '</g>',
    '</svg>',
  ].join('\n');

  return {
    problems: [],
    model: {
      svg,
      places,
      basePath,
      lang,
      strings,
      style,
      canvas: { width, height },
      seaPath,
      title: typeof config.campaign?.name === 'string' ? config.campaign.name : strings.title,
      labels: atlas.labels,
      hiddenIds,
      reservedLines: players ? reservedLinesFor(labels.places, subjects, root) : [],
      stats: { places: places.length, labels: labelSvg.length, territories: territoriesDrawn },
    },
  };
}

/** Width of the feathered edge of the base picture, as a fraction of its size on each axis. */
const FEATHER = 0.015;

/** The gradients and masks that feather the base picture's edges (horizontal and vertical), as SVG lines for a <defs> element. */
function featherDefs(width, height) {
  const edge = (axis) => {
    const x2 = axis === 'x' ? 1 : 0;
    const y2 = axis === 'y' ? 1 : 0;
    const stop = (offset, opacity) => `<stop offset="${offset}" stop-color="#fff" stop-opacity="${opacity}"/>`;
    return [
      `<linearGradient id="feather-${axis}" x1="0" y1="0" x2="${x2}" y2="${y2}">`,
      stop(0, 0),
      stop(FEATHER, 1),
      stop(1 - FEATHER, 1),
      stop(1, 0),
      '</linearGradient>',
    ];
  };
  const mask = (axis) => [
    `<mask id="feather-m${axis}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#feather-${axis})"/>`,
    '</mask>',
  ];
  return [...edge('x'), ...edge('y'), ...mask('x'), ...mask('y')];
}

/** The reserved lines of every place sheet of the labels, master-only items included (they must not leak either). */
function reservedLinesFor(placeItems, subjects, root) {
  const lines = [];
  for (const item of placeItems) {
    const subject = subjects.get(item.place);
    lines.push(...reservedLinesOf(parseFrontmatter(fs.readFileSync(path.join(root, subject.file), 'utf8')).body));
  }
  return lines;
}

/**
 * The overlay SVG of the atlas for one audience (the base is referenced as assets/base.png) and the place records.
 * Throws an Error with `problems` when the atlas cannot be exported.
 * @param {string} root the campaign folder
 * @param {object} [options]
 * @param {'master'|'players'} [options.audience='master']
 * @param {string} [options.pluginRoot] the framework folder (default: this framework)
 * @returns {{ svg: string, places: object[] }}
 */
export function buildOverlaySvg(root, { audience = 'master', pluginRoot = pluginRootFromHere() } = {}) {
  const result = prepare(root, { audience, pluginRoot });
  if (result.problems.length > 0) {
    const error = new Error(`the atlas cannot be drawn: ${result.problems.map((p) => p.message).join('; ')}`);
    error.problems = result.problems;
    throw error;
  }
  return { svg: result.model.svg, places: result.model.places };
}

/**
 * Exports the atlas for one audience.
 * @param {string} root the campaign folder
 * @param {object} [options]
 * @param {'master'|'players'} [options.audience='master']
 * @param {(input: object) => object[]} [options.runChecks] the players' checks (default: runAtlasChecks)
 * @param {string} [options.pluginRoot] the framework folder (default: this framework)
 * @returns {{ ok: boolean, dir: string|null, stats: object|null, checks: object[], problems: object[] }}
 *   `dir` is campaign-relative and only set when the folder was written.
 */
export function exportAtlas(root, { audience = 'master', runChecks = runAtlasChecks, pluginRoot = pluginRootFromHere() } = {}) {
  if (!AUDIENCES.includes(audience)) throw new Error(`audience must be one of ${AUDIENCES.join(', ')}`);
  const players = audience === 'players';

  const prepared = prepare(root, { audience, pluginRoot });
  if (prepared.problems.length > 0) return refused(prepared.problems);
  const m = prepared.model;

  // The sea tile covers a third of the map width; it is square.
  const seaSide = Math.round(m.canvas.width / 3);
  const sea = m.seaPath === null ? null : { file: 'assets/sea.png', width: seaSide, height: seaSide };
  const dataJson = inlineJson({
    canvas: m.canvas,
    lang: m.lang,
    strings: m.strings,
    layers: LAYERS,
    places: m.places,
    sea,
    audience,
  });
  const html = pageHtml({
    lang: m.lang,
    title: `${m.title} — ${m.strings.title}`,
    svg: m.svg,
    dataJson,
  });

  // Build in a sibling folder; the previous folder stays until the build is complete and checked.
  const outRoot = path.join(root, SITE_CACHE);
  const finalDir = path.join(outRoot, audience);
  const tmpDir = path.join(outRoot, `.${audience}-tmp`);
  const oldDir = path.join(outRoot, `.${audience}-old`);
  const discardTmp = () => fs.rmSync(tmpDir, { recursive: true, force: true });
  discardTmp();
  fs.mkdirSync(path.join(tmpDir, 'assets', 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'index.html'), html);

  const assets = [
    ['base.png', m.basePath],
    ...(m.seaPath === null ? [] : [['sea.png', m.seaPath]]),
    ...VIEWER_FILES.map((name) => [name, path.join(SITE_DIR, name)]),
    ...Object.values(FONT_FILES).map((rel) => [rel, path.join(ASSETS_DIR, rel)]),
  ];
  for (const [rel, source] of assets) {
    if (!fs.existsSync(source)) {
      discardTmp();
      return refused([problem('missing-asset', `assets/${rel}`, '', `asset ${rel} is missing`)]);
    }
    fs.copyFileSync(source, path.join(tmpDir, 'assets', rel));
  }

  // The players' checks, on the text of the build (index.html and its data).
  let checks = [];
  if (players) {
    try {
      checks = runChecks({
        outputs: [{ rel: 'index.html', text: html }, { rel: 'atlas-data.json', text: dataJson }],
        labels: m.labels,
        reservedLines: m.reservedLines,
        masterIds: m.hiddenIds,
      });
    } catch (err) {
      discardTmp();
      throw err;
    }
    const failed = checks.filter((c) => c.status === 'fail');
    if (failed.length > 0) {
      discardTmp();
      return {
        ok: false,
        dir: null,
        stats: null,
        checks,
        problems: failed.map((c) => problem(c.id, null, '', c.message)),
      };
    }
  }

  // Stats, report, and the swap of the folders.
  fs.writeFileSync(
    path.join(tmpDir, 'report.json'),
    `${JSON.stringify({ audience, built: new Date().toISOString(), stats: m.stats, checks }, null, 2)}\n`,
  );
  fs.mkdirSync(outRoot, { recursive: true });
  fs.rmSync(oldDir, { recursive: true, force: true });
  if (fs.existsSync(finalDir)) fs.renameSync(finalDir, oldDir);
  fs.renameSync(tmpDir, finalDir);
  fs.rmSync(oldDir, { recursive: true, force: true });

  return {
    ok: true,
    dir: path.posix.join(SITE_CACHE.split(path.sep).join('/'), audience),
    stats: m.stats,
    checks,
    problems: [],
  };
}

