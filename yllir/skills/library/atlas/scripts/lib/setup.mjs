// Sets up a campaign for the atlas: the atlas category in campaign.yaml (with its folder) and the
// atlas module. Idempotent: a campaign that already has both is not touched. When a write does not
// validate, campaign.yaml is restored to the bytes it had before this call, and an empty folder
// created by this call is removed.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { addCategory, stringifyConfig } from '../../../../../scripts/lib/config-write.mjs';
import { validateConfig } from '../../../../../scripts/lib/config.mjs';
import { atlasFolder, isUrbanScope } from './model.mjs';

const FILE = 'campaign.yaml';
export const DEFAULT_CANVAS = { width: 4000, height: 3000 };
export const DEFAULT_URBAN_CANVAS = { width: 2400, height: 1800 };
export const DEFAULT_STYLE = 'fantasy-color';

/** A new copy of the default canvas for a scope kind: the urban one for a settlement or district. */
export function defaultCanvasFor(kind) {
  return { ...(isUrbanScope(kind) ? DEFAULT_URBAN_CANVAS : DEFAULT_CANVAS) };
}

const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Reads campaign.yaml: its bytes (for a restore) and its parsed mapping, or the problem. */
function readConfig(root) {
  let bytes;
  try {
    bytes = fs.readFileSync(path.join(root, FILE));
  } catch (err) {
    const code = err.code === 'ENOENT' ? 'missing-file' : 'unreadable';
    return { error: { code, file: FILE, path: '', message: 'campaign.yaml cannot be read' } };
  }
  const parsed = parseYamlLite(bytes.toString('utf8'));
  if (parsed.errors.length > 0) {
    const [first] = parsed.errors;
    return { error: { code: 'yaml', file: FILE, path: '', message: `line ${first.line}: ${first.message}` } };
  }
  if (!isMapping(parsed.data)) {
    return { error: { code: 'invalid-config', file: FILE, path: '', message: 'campaign.yaml must be a mapping' } };
  }
  return { bytes, config: parsed.data };
}

/**
 * The folder for a new atlas category: `Atlante` in an Italian campaign, `Atlas` otherwise. When another
 * category already uses that folder, `Atlante della campagna` or `Campaign atlas`.
 */
export function atlasFolderFor(config) {
  const italian = isMapping(config.language) && config.language.main === 'it';
  const preferred = italian ? 'Atlante' : 'Atlas';
  const structure = Array.isArray(config.structure) ? config.structure : [];
  const used = structure.some((entry) => isMapping(entry) && entry.folder === preferred);
  if (!used) return preferred;
  return italian ? 'Atlante della campagna' : 'Campaign atlas';
}

/** The seed of a campaign that gives none: the first 28 bits of sha256 of its slug (the folder name when it has none). */
export function defaultSeed(config, root) {
  const slug = isMapping(config.campaign) && typeof config.campaign.slug === 'string' && config.campaign.slug !== ''
    ? config.campaign.slug
    : path.basename(path.resolve(root));
  return parseInt(crypto.createHash('sha256').update(slug).digest('hex').slice(0, 7), 16);
}

/**
 * What init needs before it writes anything: the atlas folder (the existing one, or the one a new
 * category would get) and the default seed. Reads campaign.yaml only.
 * @returns {{ folder: string|null, seed: number|null, errors: object[] }}
 */
export function planAtlasSetup(root) {
  const read = readConfig(root);
  if (read.error) return { folder: null, seed: null, errors: [read.error] };
  return {
    folder: atlasFolder(root) ?? atlasFolderFor(read.config),
    seed: defaultSeed(read.config, root),
    errors: [],
  };
}

/**
 * Adds the atlas category and turns the atlas module on, when either is missing.
 * @returns {{ ok: boolean, categoryAdded: boolean, moduleEnabled: boolean, errors: object[] }}
 */
export function ensureAtlasSetup(root) {
  const fail = (errors, categoryAdded = false) => ({ ok: false, categoryAdded, moduleEnabled: false, errors });
  const start = readConfig(root);
  if (start.error) return fail([start.error]);

  const file = path.join(root, FILE);
  const structure = Array.isArray(start.config.structure) ? start.config.structure : [];
  const hasCategory = structure.some((entry) => isMapping(entry) && entry.type === 'atlas');

  // The folder that this call creates, if any, so that a rollback can remove it again.
  let createdFolder = null;
  let categoryAdded = false;
  if (!hasCategory) {
    const folder = atlasFolderFor(start.config);
    const target = path.join(root, folder);
    if (!fs.existsSync(target)) createdFolder = target;
    const result = addCategory(root, { id: 'atlas', folder, type: 'atlas' });
    if (result.errors.length > 0) return fail(result.errors, result.added);
    categoryAdded = result.added;
  }

  const rollback = () => {
    fs.writeFileSync(file, start.bytes);
    if (createdFolder !== null) {
      try {
        fs.rmdirSync(createdFolder);
      } catch {
        // Not empty or already gone: nothing to undo.
      }
    }
  };

  const current = readConfig(root);
  if (current.error) {
    rollback();
    return fail([current.error]);
  }
  const modules = isMapping(current.config.modules) ? current.config.modules : {};
  if (modules.atlas === true) return { ok: true, categoryAdded, moduleEnabled: false, errors: [] };

  // A campaign that already fails validation is not refused for those problems: the write is refused
  // only when it adds a problem of its own.
  const before = validateConfig(root).errors;
  let text;
  try {
    text = stringifyConfig({ ...current.config, modules: { ...modules, atlas: true } });
  } catch (err) {
    rollback();
    return fail([{ code: 'unsupported-config', file: FILE, path: 'modules', message: err.message }]);
  }
  fs.writeFileSync(file, text);
  const added = validateConfig(root).errors.filter(
    (error) => !before.some((old) => old.code === error.code && old.path === error.path),
  );
  if (added.length > 0) {
    rollback();
    return fail(added);
  }
  return { ok: true, categoryAdded, moduleEnabled: true, errors: [] };
}
