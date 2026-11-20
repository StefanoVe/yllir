// Styles of the atlas. A style is a framework package under assets/styles/<id>/: a style.json with
// the palette, fonts and drawing parameters, and (once installed) a manifest.json that lists its
// stamps and textures. A style is installed when its manifest exists and every file it lists
// exists. The choice of style is made here, from the master's choice, the game-system adapter and
// the default. Pure file reads: no writes, no dates, no randomness.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdapter, pluginRootFromHere } from '../../../../../scripts/lib/adapter.mjs';

export const DEFAULT_STYLE = 'fantasy-color';
export const STYLES_DIR = fileURLToPath(new URL('../../assets/styles/', import.meta.url));
// Font families the renderer can draw, with their files under assets/fonts/ (shared by all styles).
export const FONT_FILES = { 'IM Fell English': 'fonts/IMFellEnglish-Regular.ttf', Cinzel: 'fonts/Cinzel.ttf' };

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Rules of one value. Each returns null when the value is valid, otherwise why it is not.
const LEAF = {
  schema: (v) => (v === 1 ? null : 'must be 1'),
  id: (v) => (typeof v === 'string' && ID_RE.test(v) ? null : 'must be a style id of lowercase letters, digits and hyphens'),
  text: (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'must be nonempty text'),
  colour: (v) => (typeof v === 'string' && HEX_RE.test(v) ? null : 'must be a colour #rrggbb'),
  nonneg: (v) => (isFiniteNumber(v) && v >= 0 ? null : 'must be a number of zero or more'),
  positive: (v) => (isFiniteNumber(v) && v > 0 ? null : 'must be a number above zero'),
  unit: (v) => (isFiniteNumber(v) && v >= 0 && v <= 1 ? null : 'must be a number from 0 to 1'),
  darken: (v) => (isFiniteNumber(v) && v >= -1 && v <= 1 ? null : 'must be a number from -1 to 1'),
  int: (v) => (Number.isInteger(v) && v >= 0 ? null : 'must be a whole number of zero or more'),
  bool: (v) => (typeof v === 'boolean' ? null : 'must be true or false'),
  font: (v) => (Object.hasOwn(FONT_FILES, v) ? null : `must be one of ${Object.keys(FONT_FILES).join(', ')}`),
  texture: (v) => (typeof v === 'string' && ID_RE.test(v) ? null : 'must be a texture id'),
  dash: (v) => (Array.isArray(v) && v.length === 2 && v.every((n) => isFiniteNumber(n) && n >= 0) ? null : 'must be two numbers of zero or more'),
};

// The shape of style.json. A string is a leaf rule, an object is a mapping with exactly these keys.
const SHAPE = {
  schema: 'schema',
  id: 'id',
  names: { it: 'text', en: 'text' },
  fonts: { place: 'font', realm: 'font', feature: 'font' },
  textures: { land: 'texture', sand: 'texture', snow: 'texture', sea: 'texture', deepSea: 'texture' },
  sea: {
    glow: { width: 'nonneg', blur: 'nonneg', opacity: 'unit' },
    ripples: { count: 'int', color: 'colour', opacity: 'unit', step: 'nonneg', base: 'nonneg', spacing: 'nonneg' },
  },
  coast: { color: 'colour', width: 'nonneg', shade: { color: 'colour', opacity: 'unit', width: 'nonneg' } },
  rivers: { under: 'colour', underWidth: 'nonneg', color: 'colour', width: 'nonneg' },
  lakes: { highlight: { color: 'colour', opacity: 'unit', width: 'nonneg' } },
  borders: { fillOpacity: 'unit', width: 'nonneg', dash: 'dash', opacity: 'unit', coastGap: 'nonneg' },
  routes: {
    road: { color: 'colour', width: 'nonneg', dash: 'dash' },
    trail: { color: 'colour', width: 'nonneg', dash: 'dash' },
    sea: { color: 'colour', width: 'nonneg', dash: 'dash', opacity: 'unit' },
  },
  labels: {
    fill: 'colour', halo: 'colour', haloOpacity: 'unit', haloWidth: 'nonneg',
    featureFill: 'colour', featureSize: 'nonneg', featureSpacing: 'nonneg',
    placeSize: { capital: 'nonneg', city: 'nonneg', other: 'nonneg' },
    realmDarken: 'darken', realmOpacity: 'unit',
    realmSize: { max: 'nonneg', min: 'nonneg', fitMin: 'nonneg', areaDivisor: 'positive' },
    realmSpacing: 'nonneg', realmSpacingMin: 'nonneg',
  },
  stamps: { mirrorTrees: 'bool', scale: 'positive' },
  masks: { blur: 'nonneg' },
  icons: { capital: 'nonneg', city: 'nonneg', other: 'nonneg' },
  vignette: { color: 'colour', opacity: 'unit' },
  forestTint: { color: 'colour', opacity: 'unit' },
  // Urban scale (settlement, district): the colours of the ground, the water, the green areas, the
  // streets, the walls and every building or lot kind, and the opacities of the district layer.
  urban: {
    ground: 'colour', water: 'colour', waterEdge: 'colour', outline: 'colour', square: 'colour', block: 'colour',
    green: { park: 'colour', garden: 'colour', field: 'colour', wood: 'colour', orchard: 'colour' },
    street: { casing: 'colour', main: 'colour', secondary: 'colour', lane: 'colour' },
    wall: { stone: 'colour', outline: 'colour' },
    roof: {
      house: 'colour', rowhouse: 'colour', shop: 'colour', barn: 'colour', tavern: 'colour', inn: 'colour',
      temple: 'colour', shrine: 'colour', palace: 'colour', castle: 'colour', keep: 'colour', tower: 'colour',
      mill: 'colour', warehouse: 'colour', market: 'colour', guildhall: 'colour', smithy: 'colour',
      gatehouse: 'colour', landmark: 'colour',
    },
    district: { fillOpacity: 'unit', labelOpacity: 'unit' },
  },
};

/**
 * Problems of a parsed style.json, checked against every key of the format.
 * @returns {{ path: string, message: string }[]} empty when the style is valid
 */
export function validateStyleJson(obj) {
  const out = [];
  const walk = (value, rule, at) => {
    if (typeof rule === 'string') {
      const why = LEAF[rule](value);
      if (why !== null) out.push({ path: at, message: `${at} ${why}` });
      return;
    }
    if (!isPlainObject(value)) {
      out.push({ path: at, message: `${at} must be a mapping` });
      return;
    }
    for (const key of Object.keys(rule)) {
      const where = at === '' ? key : `${at}.${key}`;
      if (!Object.hasOwn(value, key)) out.push({ path: where, message: `${where} is required` });
      else walk(value[key], rule[key], where);
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(rule, key)) out.push({ path: at === '' ? key : `${at}.${key}`, message: `"${key}" is not a setting of the style` });
    }
  };
  walk(obj, SHAPE, '');
  return out;
}

function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Parsed style.json of a style folder, or a coded error when it is missing or invalid.
function readStyleFile(dir, id) {
  const file = path.join(dir, 'style.json');
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw coded('unknown-style', `style ${id} does not exist`);
    throw coded('invalid-style', `style ${id}: style.json is not valid JSON (${error.message})`);
  }
  const problems = validateStyleJson(obj);
  if (problems.length > 0) throw coded('invalid-style', `style ${id}: ${problems.map((p) => p.message).join('; ')}`);
  if (obj.id !== id) throw coded('invalid-style', `style ${id}: the id in style.json is ${obj.id}`);
  return obj;
}

// Null when the style folder is installed, otherwise the reason it is not.
function installProblem(dir) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return 'manifest.json is missing';
  }
  const listed = [...(manifest.stamps ?? []), ...(manifest.textures ?? [])].map((entry) => entry.file);
  const missing = listed.filter((file) => typeof file !== 'string' || !fs.existsSync(path.join(dir, file)));
  return missing.length === 0 ? null : `files are missing: ${missing.slice(0, 3).join(', ')}`;
}

/**
 * Every style folder with a valid style.json, sorted by id.
 * @param {{ root?: string }} [options] the styles folder (default: the framework's assets/styles)
 * @returns {{ id: string, names: object, installed: boolean }[]}
 */
export function listStyles({ root = STYLES_DIR } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
    let style;
    try {
      style = readStyleFile(path.join(root, entry.name), entry.name);
    } catch {
      continue;
    }
    out.push({ id: entry.name, names: style.names, installed: installProblem(path.join(root, entry.name)) === null });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Loads one style. Throws an Error with code `unknown-style` (no style.json), `invalid-style`
 * (style.json does not validate) or `style-not-installed` (no manifest, or a listed file is missing).
 * @returns {{ style: object, manifest: object, dir: string }}
 */
export function loadStyle(id, { root = STYLES_DIR } = {}) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw coded('unknown-style', `style ${id} does not exist`);
  const dir = path.join(root, id);
  const style = readStyleFile(dir, id);
  const problem = installProblem(dir);
  if (problem !== null) throw coded('style-not-installed', `style ${id} is declared but not installed: ${problem}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return { style, manifest, dir };
}

function isInstalled(id, root) {
  try {
    loadStyle(id, { root });
    return true;
  } catch {
    return false;
  }
}

/**
 * Chooses the style of an atlas: the master's style when it is set and installed, else the style
 * the game-system adapter declares when it is installed, else the default.
 * @param {object} input
 * @param {string} [input.atlasStyle] the `style` of atlas.json (`auto` or empty means no choice)
 * @param {object} [input.campaignConfig] the parsed campaign.yaml (its `system.adapter` names the adapter)
 * @param {string} [input.pluginRoot] the framework folder (default: this framework)
 * @param {string} [input.root] the styles folder (default: the framework's assets/styles)
 * @returns {{ id: string, source: 'master' | 'adapter' | 'default', requested: string | null }}
 *   `requested` holds the first style that was asked for and could not be used, so the caller can say it fell back.
 */
export function resolveStyleId({ atlasStyle, campaignConfig, pluginRoot = pluginRootFromHere(), root = STYLES_DIR } = {}) {
  let requested = null;
  if (typeof atlasStyle === 'string' && atlasStyle !== '' && atlasStyle !== 'auto') {
    if (isInstalled(atlasStyle, root)) return { id: atlasStyle, source: 'master', requested: null };
    requested = atlasStyle;
  }
  const adapterId = campaignConfig?.system?.adapter;
  if (typeof adapterId === 'string' && adapterId !== '') {
    const declared = loadAdapter(pluginRoot, adapterId).adapter?.atlas_style;
    if (typeof declared === 'string') {
      if (isInstalled(declared, root)) return { id: declared, source: 'adapter', requested };
      requested ??= declared;
    }
  }
  return { id: DEFAULT_STYLE, source: 'default', requested };
}
