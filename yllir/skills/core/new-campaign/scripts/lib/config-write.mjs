// Writes campaign.yaml: renders a config object as YAML in the subset that
// yaml-lite reads back, and adds a document category to an existing campaign.
// Rewriting a file drops its comments, so only the framework writes this file.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { validateConfig } from '../../../../../scripts/lib/config.mjs';
import { generateInstructions } from '../../../../../scripts/lib/instructions.mjs';

const FILE = 'campaign.yaml';
const TOP_ORDER = ['schema', 'campaign', 'language', 'prose', 'system', 'structure', 'modules', 'audit', 'allow_model_imagination'];
const KEY_RE = /^[a-z][a-z0-9_]*$/;
const BARE_RE = /^[a-z0-9][a-z0-9_-]*$/;
const DIGITS_RE = /^\d+$/;
const DATE_LIKE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RESERVED = ['true', 'false', 'null', '~'];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Renders a config object as campaign.yaml text.
 * Top-level keys come in the canonical order, then the others alphabetically.
 * Nested keys keep their insertion order. Values that yaml-lite cannot read
 * back (line breaks, non-integer numbers, invalid keys) throw a TypeError.
 * @param {object} config
 * @returns {string}
 */
export function stringifyConfig(config) {
  if (!isMapping(config)) {
    throw new TypeError('stringifyConfig expects a mapping');
  }
  const present = Object.keys(config).filter((key) => config[key] !== undefined);
  const keys = [
    ...TOP_ORDER.filter((key) => present.includes(key)),
    ...present.filter((key) => !TOP_ORDER.includes(key)).sort(),
  ];
  return `${mappingLines(config, keys, 0).join('\n')}\n`;
}

/**
 * Adds a document category to `<root>/campaign.yaml`, creates its folder, and
 * regenerates the instructions. A category already present with the same id,
 * folder and type changes nothing. When the new config does not validate, the
 * previous bytes are restored and the folders this call created are removed.
 * @returns {{ added: boolean, errors: Array<{code: string, path: string, message: string}> }}
 */
export function addCategory(root, { id, folder, type, source } = {}) {
  const dir = path.resolve(root);
  const file = path.join(dir, FILE);

  let previous;
  try {
    previous = fs.readFileSync(file);
  } catch (err) {
    return refuse(err.code === 'ENOENT' ? 'missing-file' : 'unreadable', FILE, 'campaign.yaml cannot be read');
  }

  const parsed = parseYamlLite(previous.toString('utf8'));
  if (parsed.errors.length > 0) {
    return {
      added: false,
      errors: parsed.errors.map((error) => ({
        code: 'yaml',
        path: FILE,
        message: `line ${error.line}: ${error.message}`,
      })),
    };
  }
  const config = parsed.data;
  if (!isMapping(config)) {
    return refuse('invalid-config', FILE, 'campaign.yaml must be a mapping');
  }

  if (typeof id !== 'string' || !SLUG_RE.test(id)) {
    return refuse('bad-input', 'id', 'id must be lowercase letters, digits and single hyphens');
  }
  if (!isSafeFolder(folder)) {
    return refuse('bad-input', 'folder', 'folder must be a relative folder name inside the campaign, without dots or hidden names');
  }
  if (typeof type !== 'string') {
    return refuse('bad-input', 'type', 'type must be text');
  }
  const fromSource = source !== undefined;
  if (fromSource) {
    if (type !== 'external') {
      return refuse('bad-input', 'source', 'source is only valid on a category of type external');
    }
    if (typeof source !== 'string' || !path.isAbsolute(source) || !isDirectory(source)) {
      return refuse('bad-input', 'source', 'source must be an absolute path to an existing folder');
    }
  }

  const structure = Object.hasOwn(config, 'structure') ? config.structure : [];
  if (!Array.isArray(structure)) {
    return refuse('bad-type', 'structure', 'structure must be a list');
  }
  const exists = structure.some(
    (entry) => isMapping(entry) && entry.id === id && entry.folder === folder && entry.type === type,
  );
  if (exists) {
    return { added: false, errors: [] };
  }
  const clash = structure.some((entry) => isMapping(entry) && (entry.id === id || entry.folder === folder));
  if (clash) {
    return refuse(
      'category-conflict',
      'structure',
      `the id ${id} or the folder ${folder} is already used by another category`,
    );
  }

  let text;
  try {
    text = stringifyConfig({ ...config, structure: [...structure, { id, folder, type }] });
  } catch (err) {
    return refuse('unsupported-config', FILE, err.message);
  }

  const target = path.join(dir, folder);
  if (fromSource && existsNoFollow(target)) {
    return refuse('category-conflict', 'folder', `the folder ${folder} already exists`);
  }

  // With a source, the folder is a symbolic link to it: only the parents are created here.
  const createdDirs = missingAncestors(fromSource ? path.dirname(target) : target);
  try {
    if (fromSource) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(source, target, 'dir');
    } else {
      fs.mkdirSync(target, { recursive: true });
    }
  } catch (err) {
    removeEmptyDirs(createdDirs);
    return refuse('bad-folder', 'folder', `the folder ${folder} cannot be created (${err.code ?? 'error'})`);
  }

  const rollback = () => {
    if (fromSource) removeLink(target);
    fs.writeFileSync(file, previous);
    removeEmptyDirs(createdDirs);
  };

  try {
    fs.writeFileSync(file, text);
  } catch (err) {
    rollback();
    return refuse('unwritable', FILE, `campaign.yaml cannot be written (${err.code ?? 'error'})`);
  }

  const check = validateConfig(dir);
  if (!check.ok) {
    rollback();
    return { added: false, errors: check.errors };
  }

  const generated = generateInstructions(dir);
  return { added: true, errors: generated.errors };
}

// ---------------------------------------------------------------- rendering

function mappingLines(obj, keys, indent) {
  return keys.flatMap((key) => entryLines(key, obj[key], indent));
}

function entryLines(key, value, indent) {
  if (!KEY_RE.test(key)) {
    throw new TypeError(`${key} cannot be written as a campaign.yaml key`);
  }
  const pad = ' '.repeat(indent);
  if (isMapping(value)) {
    const keys = Object.keys(value).filter((item) => value[item] !== undefined);
    if (keys.length === 0) {
      return [`${pad}${key}: {}`];
    }
    return [`${pad}${key}:`, ...mappingLines(value, keys, indent + 2)];
  }
  if (Array.isArray(value)) {
    if (value.every(isScalar)) {
      return [`${pad}${key}: ${flowText(value)}`];
    }
    return [`${pad}${key}:`, ...listLines(value, indent + 2)];
  }
  return [`${pad}${key}: ${scalarText(value)}`];
}

function listLines(items, indent) {
  const pad = ' '.repeat(indent);
  return items.flatMap((item) => {
    if (isMapping(item)) {
      const keys = Object.keys(item).filter((key) => item[key] !== undefined);
      if (keys.length === 0) {
        return [`${pad}- {}`];
      }
      const [first, ...rest] = mappingLines(item, keys, indent + 2);
      return [`${pad}- ${first.slice(indent + 2)}`, ...rest];
    }
    if (Array.isArray(item) && item.every(isScalar)) {
      return [`${pad}- ${flowText(item)}`];
    }
    if (isScalar(item)) {
      return [`${pad}- ${scalarText(item)}`];
    }
    throw new TypeError('lists may hold only scalars, mappings or flat lists');
  });
}

function flowText(items) {
  return `[${items.map(scalarText).join(', ')}]`;
}

function scalarText(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new TypeError(`${value} is not a whole number`);
    }
    return String(value);
  }
  if (typeof value === 'string') return stringText(value);
  throw new TypeError(`${typeof value} values cannot be written`);
}

function stringText(text) {
  if (/[\r\n]/.test(text)) {
    throw new TypeError('line breaks are not supported in campaign.yaml values');
  }
  const bare =
    BARE_RE.test(text) && !RESERVED.includes(text) && !DIGITS_RE.test(text) && !DATE_LIKE_RE.test(text);
  if (bare) {
    return text;
  }
  if (text.includes('"')) {
    return `'${text.replaceAll("'", "''")}'`;
  }
  return `"${text}"`;
}

// ---------------------------------------------------------------- helpers

function refuse(code, at, message) {
  return { added: false, errors: [{ code, path: at, message }] };
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value) {
  return value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

/** A category folder: relative, inside the campaign, no hidden or dot names. */
function isSafeFolder(folder) {
  if (typeof folder !== 'string' || folder.trim() === '') return false;
  if (folder.startsWith('/') || folder.includes('\\')) return false;
  return folder.split('/').every((part) => part !== '' && !part.startsWith('.'));
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** True when something (a folder, a file or a link, even a dangling one) is at `target`. */
function existsNoFollow(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/** Removes the symbolic link at `link` only. The folder it points to is never touched. */
function removeLink(link) {
  try {
    if (fs.lstatSync(link).isSymbolicLink()) {
      fs.rmSync(link);
    }
  } catch {
    // Already gone: nothing to undo.
  }
}

/** The folders that `mkdir -p` would create for `target`, outermost first. */
function missingAncestors(target) {
  const missing = [];
  let probe = target;
  while (!fs.existsSync(probe)) {
    missing.unshift(probe);
    const up = path.dirname(probe);
    if (up === probe) break;
    probe = up;
  }
  return missing;
}

/** Removes the given folders, innermost first; folders that are not empty stay. */
function removeEmptyDirs(dirs) {
  for (const dir of [...dirs].reverse()) {
    try {
      fs.rmdirSync(dir);
    } catch {
      // Not empty or already gone: nothing to undo.
    }
  }
}
