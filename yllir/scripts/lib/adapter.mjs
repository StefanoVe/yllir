import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlLite } from './yaml-lite.mjs';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function pluginRootFromHere() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

export function listAdapters(pluginRoot) {
  return manifests(pluginRoot).flatMap(({ folderId, filename }) => {
    try {
      const parsed = parseYamlLite(fs.readFileSync(filename, 'utf8'));
      return parsed.errors.length === 0 && isMapping(parsed.data) && typeof parsed.data.id === 'string' ? [parsed.data.id] : [];
    } catch { return []; }
  }).sort();
}

export function loadAdapter(pluginRoot, id) {
  const candidates = manifests(pluginRoot);
  let match = null;
  let folderFallback = null;
  for (const candidate of candidates) {
    let text;
    try { text = fs.readFileSync(candidate.filename, 'utf8'); }
    catch { continue; }
    const parsed = parseYamlLite(text);
    if (candidate.folderId === id && (parsed.errors.length || !isMapping(parsed.data) || typeof parsed.data.id !== 'string' || !SLUG_RE.test(parsed.data.id))) {
      folderFallback = { candidate, text };
    }
    if (parsed.errors.length === 0 && isMapping(parsed.data) && parsed.data.id === id) { match = { candidate, text }; break; }
  }
  if (match === null && folderFallback !== null) match = folderFallback;
  if (match === null) {
    return result(null, [{ code: 'unknown-adapter', path: 'id', message: `adapter ${id} is not installed` }]);
  }
  const { filename, folderId } = match.candidate;
  const base = path.relative(pluginRoot, filename);
  const text = match.text;
  const parsed = parseYamlLite(text);
  if (parsed.errors.length) {
    return result(null, parsed.errors.map((e) => ({ code: 'bad-yaml', path: base, message: `line ${e.line}: ${e.message}` })));
  }
  const folder = path.dirname(filename);
  const errors = validate(parsed.data, folderId, folder);
  if (isMapping(parsed.data) && checksFileProblem(parsed.data.checks, folder) === null && parsed.data.checks !== undefined) {
    parsed.data.checksPath = path.join(folder, parsed.data.checks);
  }
  return result(parsed.data, errors);
}

function manifests(pluginRoot) {
  const systems = path.join(pluginRoot, 'modules', 'systems');
  let entries;
  try { entries = fs.readdirSync(systems, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => ({
    folderId: entry.name,
    filename: path.join(systems, entry.name, 'adapter.yaml'),
  })).filter(({ filename }) => fs.existsSync(filename));
}

function result(adapter, errors) { return { ok: errors.length === 0, adapter, errors }; }
function isMapping(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
// Returns null when the optional checks key is absent or valid, otherwise the problem.
function checksFileProblem(name, folder) {
  if (name === undefined) return null;
  if (typeof name !== 'string' || !name.endsWith('.mjs') || name.length <= '.mjs'.length || /[/\\]/.test(name) || name.includes('..')) {
    return { code: 'bad-value', message: 'checks must be a file name ending in .mjs, without folders' };
  }
  try {
    if (fs.statSync(path.join(folder, name)).isFile()) return null;
  } catch { /* reported below */ }
  return { code: 'missing-file', message: `checks file ${name} is not in the adapter folder` };
}

function validate(adapter, folderId, folder) {
  const errors = [];
  const error = (code, field, message) => errors.push({ code, path: field, message });
  if (!isMapping(adapter)) return [{ code: 'bad-type', path: '', message: 'adapter manifest must be a mapping' }];
  const allowed = ['id', 'name', 'version', 'headings', 'encounters', 'progression', 'difficulty', 'resources', 'conditions', 'condition_durations', 'creature_sheet', 'checks', 'item_sheet', 'tracking', 'do_not'];
  for (const key of Object.keys(adapter)) if (!allowed.includes(key)) error('unknown-key', key, `"${key}" is not a setting of an adapter manifest`);
  if (typeof adapter.id !== 'string' || !SLUG_RE.test(adapter.id)) error('bad-value', 'id', 'id must be a lowercase slug');
  if (adapter.id !== folderId) error('id-mismatch', 'id', `id must match the adapter folder ${folderId}`);
  if (typeof adapter.name !== 'string' || !adapter.name.trim()) error('bad-value', 'name', 'name must be nonempty text');
  if (!Number.isInteger(adapter.version)) error('bad-value', 'version', 'version must be a whole number');
  const headingKeys = ['statistics', 'description', 'effects', 'brief'];
  if (!isMapping(adapter.headings)) {
    error('bad-type', 'headings', 'headings must be a mapping');
  } else {
    for (const key of Object.keys(adapter.headings)) {
      if (!headingKeys.includes(key)) error('unknown-key', `headings.${key}`, `"${key}" is not a supported heading`);
    }
    for (const key of headingKeys) {
      if (key === 'brief' && adapter.headings[key] === undefined) continue;
      const field = adapter.headings[key];
      if (!isMapping(field)) {
        error('bad-type', `headings.${key}`, `headings.${key} must be a mapping`);
        continue;
      }
      for (const language of ['it', 'en']) {
        if (typeof field[language] !== 'string' || !field[language].trim()) error('bad-value', `headings.${key}.${language}`, `headings.${key}.${language} must be nonempty text`);
      }
      for (const language of Object.keys(field)) {
        if (!['it', 'en'].includes(language)) error('unknown-key', `headings.${key}.${language}`, `"${language}" is not a supported heading language`);
      }
    }
  }
  if (!['turn-based', 'none'].includes(adapter.encounters)) error('bad-value', 'encounters', 'encounters must be turn-based or none');
  if (!isMapping(adapter.progression) || typeof adapter.progression.method !== 'string' || !adapter.progression.method.trim()) error('bad-value', 'progression.method', 'progression.method must be nonempty text');
  if (!isMapping(adapter.creature_sheet) || !Array.isArray(adapter.creature_sheet.required)) {
    error('bad-type', 'creature_sheet.required', 'creature_sheet.required must be a list');
  } else {
    const ids = new Set();
    adapter.creature_sheet.required.forEach((field, index) => {
      const at = `creature_sheet.required[${index}]`;
      if (!isMapping(field)) { error('bad-type', at, `${at} must be a mapping`); return; }
      for (const key of ['id', 'label_it', 'label_en']) if (typeof field[key] !== 'string' || !field[key].trim()) error('bad-value', `${at}.${key}`, `${at}.${key} must be nonempty text`);
      if (typeof field.id === 'string') {
        if (ids.has(field.id)) error('duplicate-field-id', `${at}.id`, `field id ${field.id} is duplicated`);
        ids.add(field.id);
      }
    });
  }
  const checksProblem = checksFileProblem(adapter.checks, folder);
  if (checksProblem) error(checksProblem.code, 'checks', checksProblem.message);
  if (!isMapping(adapter.item_sheet) || !Array.isArray(adapter.item_sheet.printable_fields) || adapter.item_sheet.printable_fields.length === 0) error('bad-value', 'item_sheet.printable_fields', 'item_sheet.printable_fields must be a nonempty list');
  if (!Array.isArray(adapter.do_not) || adapter.do_not.length === 0) error('bad-value', 'do_not', 'do_not must be a nonempty list');
  return errors;
}
