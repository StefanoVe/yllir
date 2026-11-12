// Shared helpers of the music search: campaign settings, safe campaign paths, and
// word splitting that matches names the same way the subject index does.
// Only built-in modules and framework libraries are used.

import fs from 'node:fs';
import path from 'node:path';
import { foldText } from '../../../../../scripts/lib/fold.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';

/** A failure object with a short code and a plain message. */
export function fail(error, message) {
  return { ok: false, error, message };
}

/**
 * Lowercase, accent-free words of a text (letters and digits only).
 * @param {string} text
 * @returns {string[]}
 */
export function words(text) {
  return foldText(String(text ?? '')).folded.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');
}

/** A campaign-relative path without `..`, absolute parts or a leading slash, or null. */
export function safeRelative(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

/** True when the path exists and is a regular file. */
export function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Reads campaign.yaml of the root.
 * @returns {{ ok: true, config: object } | { ok: false, error: string, message: string }}
 */
export function readCampaign(rootAbs) {
  const file = path.join(rootAbs, 'campaign.yaml');
  if (!isFile(file)) return fail('no-campaign', 'campaign.yaml not found in the campaign root');
  const { data, errors } = parseYamlLite(fs.readFileSync(file, 'utf8'));
  if (errors.length > 0 || data === null || typeof data !== 'object' || Array.isArray(data)) {
    const detail = errors[0] ? ` (line ${errors[0].line}: ${errors[0].message})` : '';
    return fail('bad-campaign', `campaign.yaml is not valid${detail}`);
  }
  return { ok: true, config: data };
}

/** True when the campaign turns the music module on (`modules.music: true`). */
export function musicEnabled(config) {
  return config?.modules?.music === true;
}
