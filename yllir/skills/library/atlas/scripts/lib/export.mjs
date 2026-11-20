// Export of the atlas as a static site, for the master (the master screen) or for the players (after
// the encyclopedia checks). The site is one index.html with the map inline, the page data inline (no
// fetch, so it opens from disk) and a viewer under assets/. The players' build is checked before it
// replaces the previous folder; a failed check keeps the previous folder and writes nothing else.
// Deterministic: two exports give the same index.html. Only report.json holds the time.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAtlas, validateAtlas, isPlainObject } from './model.mjs';
import { renderAtlasSvg, escapeXml } from './render.mjs';
import { renderUrbanSvg } from './render-urban.mjs';
import { loadStyle, resolveStyleId } from './styles.mjs';
import { runAtlasChecks, reservedLinesOf, masterIdsOf } from './checks.mjs';
import { stringsFor } from './strings.mjs';
import { buildWorldIndex } from '../../../../../scripts/lib/world-graph.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { publicBody, isPublicDocument } from '../../../../../scripts/lib/public-text.mjs';
import { pluginRootFromHere } from '../../../../../scripts/lib/adapter.mjs';

const AUDIENCES = ['master', 'players'];
const SITE_DIR = fileURLToPath(new URL('../../site/', import.meta.url));
const ASSETS_DIR = fileURLToPath(new URL('../../assets/', import.meta.url));
const ASSET_BASE = 'assets/';
const DEFAULT_BASE_URL = 'http://localhost/';
const SUMMARY_MAX = 400;
// The geographic and the urban layers: an atlas that has a feature in any of them is geographic or urban (or both).
const GEO_LAYERS = ['terrain', 'relief', 'water', 'biomes', 'political', 'routes', 'places'];
const URBAN_LAYERS = ['ground', 'green', 'walls', 'streets', 'blocks', 'buildings', 'districts'];
// The order of the layer switches in the viewer, the union of both kinds in drawing order. Labels are always
// listed, even when no label layer exists. Only the layers the atlas has are listed.
const LAYER_ORDER = ['terrain', 'relief', 'biomes', 'water', 'political', 'routes', 'places', ...URBAN_LAYERS, 'labels'];
const VIEWER_FILES = ['viewer.js', 'viewer.css'];
// The viewer's own display font (viewer.css), copied even when the map does not reference it.
const VIEWER_FONT = 'fonts/IMFellEnglish-Regular.ttf';
const CSP = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'";
const SITE_CACHE = path.join('.campaign', 'cache', 'atlas');

const refused = (problems) => ({ ok: false, dir: null, stats: null, checks: [], problems });

/** The campaign's campaign.yaml, parsed; or the problem that stops the export. */
function readConfig(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8');
  } catch {
    return { error: { code: 'missing-file', file: 'campaign.yaml', path: '', message: 'campaign.yaml cannot be read' } };
  }
  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0 || !isPlainObject(parsed.data)) {
    const detail = parsed.errors[0]?.message ?? 'campaign.yaml must be a mapping';
    return { error: { code: 'yaml', file: 'campaign.yaml', path: '', message: detail } };
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

/**
 * The point a search centres on for an urban place feature: its `at` (a building), else its first seed
 * (a district), else the mean of the vertices of its first ring (1 decimal), else [0, 0].
 */
function anchorOf(feature) {
  if (Array.isArray(feature.at)) return feature.at;
  if (Array.isArray(feature.seeds) && Array.isArray(feature.seeds[0])) return feature.seeds[0];
  const ring = Array.isArray(feature.polygon) ? feature.polygon : (Array.isArray(feature.polygons?.[0]) ? feature.polygons[0] : []);
  const points = ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (points.length === 0) return [0, 0];
  const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
  return [Math.round((sum[0] / points.length) * 10) / 10, Math.round((sum[1] / points.length) * 10) / 10];
}

/** Relative paths under assets/ that the SVG references (`assets/<path>`). */
function referencedAssets(svg) {
  const refs = new Set([VIEWER_FONT]);
  for (const match of svg.matchAll(/assets\/([A-Za-z0-9_./-]+)/g)) refs.add(match[1]);
  return [...refs].sort();
}

/** Every text file of the build, campaign-relative to the build folder; report.json is not scanned. */
function textOutputs(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(html|json|css|js|svg)$/.test(entry.name) && entry.name !== 'report.json') {
        out.push({ rel: path.relative(dir, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
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
    '<div id="sea" aria-hidden="true"></div>',
    `<div id="map"><div id="stage">${svg}</div></div>`,
    `<script type="application/json" id="atlas-data">${dataJson}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** JSON for an inline script that is not executed: every character that could end or open markup is escaped. */
function inlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
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

  // 1. The atlas must be valid; nothing is written otherwise.
  const atlas = readAtlas(root);
  const worldIndex = buildWorldIndex(root);
  const problems = validateAtlas(root, atlas, { worldIndex });
  if (problems.length > 0) return refused(problems);

  // 2. Campaign language and settings.
  const read = readConfig(root);
  if (read.error) return refused([read.error]);
  const config = read.config;
  const lang = typeof config.language?.main === 'string' ? config.language.main : 'en';
  const strings = stringsFor(lang);
  const byId = new Map(worldIndex.subjects.map((subject) => [subject.id, subject]));
  const encyclopediaOn = config.modules?.encyclopedia === true;
  const configuredBase = config.encyclopedia?.base_url;
  const baseUrl = `${(typeof configuredBase === 'string' && configuredBase.trim() !== '' ? configuredBase : DEFAULT_BASE_URL).replace(/\/+$/, '')}/`;

  // The features of one layer that survive the audience filter (the renderer applies the same filter).
  const survivors = (name) => (Array.isArray(atlas.layers[name]?.features) ? atlas.layers[name].features : [])
    .filter((f) => isPlainObject(f) && (!players || f.visibility !== 'master'));
  const allFeatures = (name) => (Array.isArray(atlas.layers[name]?.features) ? atlas.layers[name].features : []).filter(isPlainObject);

  // 3. The scale of the atlas, from its features and not from its scope: a geographic layer with a feature makes
  // the map geographic, an urban one makes it urban. Both kinds at once make it 'mixed'. The features are the
  // atlas's own (the same for both audiences), so a master-only layer still decides the scale of the players' build.
  const hasGeo = GEO_LAYERS.some((name) => allFeatures(name).length > 0);
  const hasUrban = URBAN_LAYERS.some((name) => allFeatures(name).length > 0);
  const scale = hasUrban && !hasGeo ? 'urban' : (hasUrban && hasGeo ? 'mixed' : 'geo');

  // One place record per surviving place feature whose sheet may be shown to this audience. The place features
  // are the places layer, and the buildings and districts with a place (in every atlas). A building or district
  // card id is its place id, which is also the `data-place` of the element the renderer draws, so a click opens
  // the card. Such a record also carries `kind`: the building kind, or 'district' for a district; a place
  // record has no kind. The summary is always the PUBLIC body (the text before the master marker), for both
  // audiences: the card never shows the master-only part, and the master build's data holds no more than the
  // players' data does.
  const placeFeatures = [
    ...survivors('places').map((feature) => ({ feature, kind: null, id: feature.id, place: feature.place, at: feature.at })),
    ...survivors('buildings').filter((f) => typeof f.place === 'string')
      .map((feature) => ({ feature, kind: feature.kind, id: feature.place, place: feature.place, at: anchorOf(feature) })),
    ...survivors('districts').filter((f) => typeof f.place === 'string')
      .map((feature) => ({ feature, kind: 'district', id: feature.place, place: feature.place, at: anchorOf(feature) })),
  ];
  const records = [];
  const seen = new Set();
  const keptFeatures = new Set();
  for (const { feature, kind, id, place, at } of placeFeatures) {
    if (seen.has(id)) {
      keptFeatures.add(feature);
      continue;
    }
    const subject = byId.get(place);
    if (subject === undefined) continue;
    if (players && !isPublicDocument(subject.file, config)) continue;
    seen.add(id);
    keptFeatures.add(feature);
    const body = publicBody(fs.readFileSync(path.join(root, subject.file), 'utf8'));
    let link = null;
    if (players) {
      link = encyclopediaOn ? { kind: 'url', href: `${baseUrl}e/${id}/` } : null;
    } else {
      link = { kind: 'document', path: subject.file };
    }
    const record = { id, title: subject.title, icon: feature.icon ?? null, at, summary: summaryOf(body), link };
    if (kind !== null) record.kind = kind;
    records.push(record);
  }
  const renderLayers = { ...atlas.layers };
  if (atlas.layers.places !== undefined) {
    renderLayers.places = { ...atlas.layers.places, features: allFeatures('places').filter((f) => keptFeatures.has(f) && (!players || f.visibility !== 'master')) };
  }
  if (atlas.layers.buildings !== undefined) {
    renderLayers.buildings = { ...atlas.layers.buildings, features: allFeatures('buildings').filter((f) => keptFeatures.has(f) && (!players || f.visibility !== 'master')) };
  }

  // 4. Names: the surviving places, and the realms' and districts' places (for players, only when the sheet is public).
  const names = {};
  for (const record of records) names[record.id] = record.title;
  for (const named of [...survivors('political'), ...survivors('districts')]) {
    if (typeof named.place !== 'string') continue;
    const subject = byId.get(named.place);
    if (subject === undefined) continue;
    if (players && !isPublicDocument(subject.file, config)) continue;
    names[named.place] ??= subject.title;
  }

  // 5. Style and drawing.
  let bundle;
  let svgResult;
  try {
    const resolved = resolveStyleId({ atlasStyle: atlas.manifest.style, campaignConfig: config, pluginRoot });
    bundle = loadStyle(resolved.id);
    // A purely urban atlas uses the urban renderer; a geographic or a mixed one uses the geographic renderer,
    // which appends the urban groups when there are any.
    const draw = scale === 'urban' ? renderUrbanSvg : renderAtlasSvg;
    svgResult = draw({ manifest: atlas.manifest, layers: renderLayers, style: bundle, names, audience, assetBase: ASSET_BASE, vignette: false });
  } catch (err) {
    return refused([{ code: err.code ?? 'render', file: 'atlas.json', path: 'style', message: err.message }]);
  }
  const { svg: rawSvg, stats: drawn } = svgResult;
  const svg = rawSvg.replace(/^<\?xml[^>]*\?>\s*/, '');
  const { width, height } = atlas.manifest.canvas;
  const deepSea = bundle.manifest.textures.find((t) => t.id === bundle.style.textures.deepSea);
  // The sea tile is the size of the renderer's texture tile (see render.mjs). The vignette is drawn by the viewer, not in the SVG.
  const data = {
    lang,
    audience,
    canvas: { width, height },
    seaTile: Math.max(width, height) / 9,
    seaTexture: `styles/${bundle.style.id}/${deepSea.file}`,
    vignette: { color: bundle.style.vignette.color, opacity: bundle.style.vignette.opacity },
    scale,
    places: records,
    layers: LAYER_ORDER.filter((name) => name === 'labels' || atlas.layers[name] !== undefined),
    strings,
  };
  const html = pageHtml({
    lang,
    title: `${typeof config.campaign?.name === 'string' ? config.campaign.name : strings.atlas} — ${strings.atlas}`,
    svg,
    dataJson: inlineJson(data),
  });

  // 6. Build in a sibling folder, copying only what the page references.
  const outRoot = path.join(root, SITE_CACHE);
  const finalDir = path.join(outRoot, audience);
  const tmpDir = path.join(outRoot, `.${audience}-tmp`);
  const oldDir = path.join(outRoot, `.${audience}-old`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'index.html'), html);
  const written = [path.join(tmpDir, 'index.html')];
  const copy = (source, dest) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
    written.push(dest);
  };
  for (const rel of referencedAssets(svg)) {
    const source = path.join(ASSETS_DIR, rel);
    if (!fs.existsSync(source)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return refused([{ code: 'missing-asset', file: `assets/${rel}`, path: '', message: `asset ${rel} is missing` }]);
    }
    copy(source, path.join(tmpDir, 'assets', rel));
  }
  for (const name of VIEWER_FILES) copy(path.join(SITE_DIR, name), path.join(tmpDir, 'assets', name));

  // 7. The players' checks, on the text of the build.
  let checks = [];
  if (players) {
    const reservedLines = [];
    const referenced = new Set([
      ...allFeatures('places').map((f) => f.place),
      ...allFeatures('political').map((f) => f.place),
      ...allFeatures('buildings').map((f) => f.place),
      ...allFeatures('districts').map((f) => f.place),
    ].filter((id) => typeof id === 'string'));
    for (const id of referenced) {
      const subject = byId.get(id);
      if (subject === undefined) continue;
      reservedLines.push(...reservedLinesOf(parseFrontmatter(fs.readFileSync(path.join(root, subject.file), 'utf8')).body));
    }
    checks = runChecks({ outputs: textOutputs(tmpDir), layers: atlas.layers, reservedLines, masterIds: masterIdsOf(atlas.layers) });
  }
  const failed = checks.filter((c) => c.status === 'fail');
  if (failed.length > 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return {
      ok: false,
      dir: null,
      stats: null,
      checks,
      problems: failed.map((c) => ({ code: c.id, file: null, path: '', message: c.message })),
    };
  }

  // 8. Stats, the report, and the swap of the folders.
  const stats = {
    places: records.length,
    realms: survivors('political').length,
    stamps: drawn.stamps,
    labels: drawn.labels,
    bytes: written.reduce((sum, file) => sum + fs.statSync(file).size, 0),
  };
  fs.writeFileSync(
    path.join(tmpDir, 'report.json'),
    `${JSON.stringify({ audience, built: new Date().toISOString(), stats, checks }, null, 2)}\n`,
  );
  fs.mkdirSync(outRoot, { recursive: true });
  fs.rmSync(oldDir, { recursive: true, force: true });
  if (fs.existsSync(finalDir)) fs.renameSync(finalDir, oldDir);
  fs.renameSync(tmpDir, finalDir);
  fs.rmSync(oldDir, { recursive: true, force: true });

  return {
    ok: true,
    dir: path.posix.join(SITE_CACHE.split(path.sep).join('/'), audience),
    stats,
    checks,
    problems: [],
  };
}
