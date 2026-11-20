// Styles of the atlas. A style is a framework package under assets/styles/<id>/style.json. It says only
// two things: how labels, borders and markers are drawn over the painted base (colours, fonts and sizes),
// and the English description sent to the image provider when a crop or the base is repainted.
// The choice of style is made here, from the master's choice, the game-system adapter and the default.
// Pure file reads: no writes, no dates, no randomness.

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
  schema: (v) => (v === 2 ? null : 'must be 2'),
  id: (v) => (typeof v === 'string' && ID_RE.test(v) ? null : 'must be a style id of lowercase letters, digits and hyphens'),
  text: (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'must be nonempty text'),
  english: (v) => (typeof v === 'string' && v.trim() !== '' && /^[\x20-\x7e]+$/.test(v) ? null : 'must be nonempty English text'),
  colour: (v) => (typeof v === 'string' && HEX_RE.test(v) ? null : 'must be a colour #rrggbb'),
  nonneg: (v) => (isFiniteNumber(v) && v >= 0 ? null : 'must be a number of zero or more'),
  positive: (v) => (isFiniteNumber(v) && v > 0 ? null : 'must be a number above zero'),
  unit: (v) => (isFiniteNumber(v) && v >= 0 && v <= 1 ? null : 'must be a number from 0 to 1'),
  font: (v) => (Object.hasOwn(FONT_FILES, v) ? null : `must be one of ${Object.keys(FONT_FILES).join(', ')}`),
  dash: (v) => (Array.isArray(v) && v.length === 2 && v.every((n) => isFiniteNumber(n) && n >= 0) ? null : 'must be two numbers of zero or more'),
};

// The shape of style.json. A string is a leaf rule, an object is a mapping with exactly these keys.
const SHAPE = {
  schema: 'schema',
  id: 'id',
  names: { it: 'text', en: 'text' },
  repaint: 'english',
  fonts: { place: 'font', realm: 'font', feature: 'font' },
  labels: {
    fill: 'colour', halo: 'colour', haloOpacity: 'unit', haloWidth: 'nonneg',
    featureFill: 'colour', landSpacing: 'nonneg', regionOpacity: 'unit',
  },
  borders: { fillOpacity: 'unit', width: 'nonneg', dash: 'dash', opacity: 'unit' },
  markers: { fill: 'colour', stroke: 'colour', size: 'positive' },
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

/**
 * Every style folder with a valid style.json, sorted by id.
 * @param {{ root?: string }} [options] the styles folder (default: the framework's assets/styles)
 * @returns {{ id: string, names: object, repaint: string }[]}
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
    out.push({ id: entry.name, names: style.names, repaint: style.repaint });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Loads one style. Throws an Error with code `unknown-style` (no style.json, or an id that is not a style id)
 * or `invalid-style` (style.json does not validate, or its id differs from the folder name).
 * @returns {{ style: object, dir: string }}
 */
export function loadStyle(id, { root = STYLES_DIR } = {}) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw coded('unknown-style', `style ${id} does not exist`);
  const dir = path.join(root, id);
  const style = readStyleFile(dir, id);
  return { style, dir };
}

function isAvailable(id, root) {
  try {
    loadStyle(id, { root });
    return true;
  } catch {
    return false;
  }
}

/**
 * Chooses the style of an atlas: the master's style when it is set and valid, else the style
 * the game-system adapter declares when it is valid, else the default.
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
    if (isAvailable(atlasStyle, root)) return { id: atlasStyle, source: 'master', requested: null };
    requested = atlasStyle;
  }
  const adapterId = campaignConfig?.system?.adapter;
  if (typeof adapterId === 'string' && adapterId !== '') {
    const declared = loadAdapter(pluginRoot, adapterId).adapter?.atlas_style;
    if (typeof declared === 'string') {
      if (isAvailable(declared, root)) return { id: declared, source: 'adapter', requested };
      requested ??= declared;
    }
  }
  return { id: DEFAULT_STYLE, source: 'default', requested };
}
