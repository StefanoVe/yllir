// Reads campaign.yaml for the print skill and applies the defaults itself. The config
// owner validates the same keys in config.mjs; this module never calls that validator.
// An invalid value is replaced by its default and reported as a warning.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';

export const FORMATS = Object.freeze(['5x7', 'a4']);
export const RENDERERS = Object.freeze(['auto', 'photoshop', 'node']);
export const DEFAULTS = Object.freeze({
  format: '5x7',
  cmyk: false,
  renderer: 'auto',
  baseUrl: 'http://localhost/',
});

/** True for a plain mapping (not a list, not null). */
export function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalises an encyclopedia base address: http or https, no query, no fragment,
 * exactly one trailing slash. Returns null when the address is not usable.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.search !== '' || url.hash !== '') return null;
  const href = url.href;
  return href.endsWith('/') ? href : `${href}/`;
}

/**
 * Stable address of a card: `<base_url>e/<id>/`. The id is the sheet's metadata id.
 * @param {string} baseUrl normalised base address (trailing slash)
 * @param {string} id
 * @returns {string}
 */
export function entryUrl(baseUrl, id) {
  return `${baseUrl}e/${encodeURIComponent(id)}/`;
}

/**
 * Reads campaign.yaml with the framework reader.
 * @param {string} root campaign folder
 * @returns {{ ok: true, config: object } | { ok: false, message: string }}
 */
export function readCampaignConfig(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8');
  } catch {
    return { ok: false, message: 'campaign.yaml not found' };
  }
  const { data, errors } = parseYamlLite(text);
  if (errors.length > 0) {
    return { ok: false, message: `campaign.yaml line ${errors[0].line}: ${errors[0].message}` };
  }
  return { ok: true, config: isMap(data) ? data : {} };
}

/**
 * Resolves the print settings of a campaign config.
 * @param {object} config parsed campaign.yaml
 * @returns {{ format: string, cmyk: boolean, renderer: string, baseUrl: string,
 *   encyclopediaTitle: string|null, language: string, structure: object[], warnings: object[] }}
 */
export function readPrintSettings(config) {
  const warnings = [];
  const print = isMap(config.print) ? config.print : {};
  const encyclopedia = isMap(config.encyclopedia) ? config.encyclopedia : {};

  let format = DEFAULTS.format;
  if (print.format !== undefined) {
    if (FORMATS.includes(print.format)) format = print.format;
    else warnings.push({ code: 'bad-print-format', message: `print.format must be 5x7 or a4; using ${DEFAULTS.format}` });
  }

  let cmykFlag = DEFAULTS.cmyk;
  if (print.cmyk !== undefined) {
    if (typeof print.cmyk === 'boolean') cmykFlag = print.cmyk;
    else warnings.push({ code: 'bad-print-cmyk', message: 'print.cmyk must be true or false; using false' });
  }

  let renderer = DEFAULTS.renderer;
  if (print.renderer !== undefined) {
    if (RENDERERS.includes(print.renderer)) renderer = print.renderer;
    else warnings.push({ code: 'bad-print-renderer', message: 'print.renderer must be auto, photoshop or node; using auto' });
  }

  let baseUrl = DEFAULTS.baseUrl;
  if (encyclopedia.base_url !== undefined) {
    const normalized = normalizeBaseUrl(encyclopedia.base_url);
    if (normalized) baseUrl = normalized;
    else warnings.push({ code: 'bad-base-url', message: `encyclopedia.base_url is not a usable address; using ${DEFAULTS.baseUrl}` });
  }

  const encyclopediaTitle = typeof encyclopedia.title === 'string' && encyclopedia.title.trim() !== ''
    ? encyclopedia.title.trim()
    : null;
  const language = isMap(config.language) && typeof config.language.main === 'string'
    ? config.language.main
    : 'en';
  const structure = Array.isArray(config.structure) ? config.structure.filter(isMap) : [];

  return {
    format,
    cmyk: cmykFlag,
    renderer,
    baseUrl,
    encyclopediaTitle,
    language,
    structure,
    warnings,
  };
}
