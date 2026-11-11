// Inventory of the files given to import: sha256 of each file, its id,
// and its status (new, duplicate of an earlier input, or already acquired).
// Reads only; it writes nothing. Deterministic: no clock, no network.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readStructure, compareStrings } from '../../../../../scripts/lib/subjects.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';

export const ID_PATTERN = /^src-[0-9a-f]{8}$/;
export const SHA_PATTERN = /^[0-9a-f]{64}$/;

/** @param {Buffer} buffer @returns {string} lowercase hex sha256 */
export function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** @param {string} file absolute path @returns {string} lowercase hex sha256 */
export function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

/** Acquisition id of a file: `src-` plus the first 8 hex characters of its sha256. */
export function acquisitionIdFor(sha256) {
  return `src-${sha256.slice(0, 8)}`;
}

/**
 * Finds the sources folder: the folder of the one structure entry of type `sources`.
 * @param {string} campaignRoot absolute path
 * @returns {{ folder: string|null, errors: string[] }} folder is campaign-relative, with `/`
 */
export function findSourcesFolder(campaignRoot) {
  const { structure, errors } = readStructure(campaignRoot);
  if (structure === null) {
    return { folder: null, errors: errors.map((err) => err.message) };
  }
  const entries = structure.filter((entry) => entry.type === 'sources' && typeof entry.folder === 'string');
  if (entries.length === 0) {
    return { folder: null, errors: ['no category of type sources'] };
  }
  if (entries.length > 1) {
    return { folder: null, errors: ['more than one category of type sources'] };
  }
  const folder = path.posix.normalize(entries[0].folder).replace(/\/+$/, '');
  if (folder === '' || folder === '.' || folder === '..' || folder.startsWith('../') || path.posix.isAbsolute(folder)) {
    return { folder: null, errors: ['sources folder must be inside the campaign'] };
  }
  return { folder, errors: [] };
}

/**
 * Reads the sha256 recorded in the card of an acquisition folder.
 * @param {string} dir absolute path of the acquisition folder
 * @returns {{ exists: boolean, sha: string|null }} exists: card.md is there; sha: its sha256 field, or null
 */
export function readRecordedSha(dir) {
  const file = path.join(dir, 'card.md');
  if (!fs.existsSync(file)) return { exists: false, sha: null };
  const { data } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const sha = data !== null && typeof data.sha256 === 'string' ? data.sha256 : null;
  return { exists: true, sha };
}

/** Relative paths of the regular files under `dir`, dotfiles skipped, unsorted. */
function walk(base, rel, found, errors) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(base, rel), { withFileTypes: true });
  } catch (err) {
    errors.push(`cannot read folder ${path.join(base, rel)}: ${err.message}`);
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relPath = rel === '' ? entry.name : path.join(rel, entry.name);
    const full = path.join(base, relPath);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (err) {
      errors.push(`cannot read ${full}: ${err.message}`);
      continue;
    }
    if (stat.isDirectory()) {
      walk(base, relPath, found, errors);
    } else if (stat.isFile()) {
      found.push(relPath);
    }
  }
}

/**
 * Builds the inventory of the inputs. A folder input expands to its files
 * (recursive, sorted, dotfiles skipped), each listed under the input string
 * joined with its relative path.
 * @param {{ campaignRoot: string, inputs: string[], baseDir: string }} args
 *   inputs: absolute paths, or paths relative to baseDir
 * @returns {{ sources_folder: string|null, files: object[], errors: string[] }}
 */
export function buildInventory({ campaignRoot, inputs, baseDir }) {
  const { folder, errors: sourceErrors } = findSourcesFolder(campaignRoot);
  if (folder === null) {
    return { sources_folder: null, files: [], errors: sourceErrors };
  }

  const errors = [];
  const entries = [];
  for (const input of inputs) {
    const abs = path.resolve(baseDir, input);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch (err) {
      errors.push(`cannot read ${input}: ${err.message}`);
      continue;
    }
    if (stat.isDirectory()) {
      const found = [];
      walk(abs, '', found, errors);
      for (const rel of found.sort(compareStrings)) {
        entries.push({ input: path.join(input, rel), abs: path.join(abs, rel) });
      }
    } else if (stat.isFile()) {
      entries.push({ input, abs });
    } else {
      errors.push(`not a file or a folder: ${input}`);
    }
  }

  const files = [];
  const firstInputOfSha = new Map(); // sha256 -> input of its first occurrence in this call
  const idOwner = new Map(); // id -> { sha256, input } of the first file with that id
  for (const entry of entries) {
    let buffer;
    try {
      buffer = fs.readFileSync(entry.abs);
    } catch (err) {
      errors.push(`cannot read ${entry.input}: ${err.message}`);
      continue;
    }
    const sha256 = sha256Buffer(buffer);
    const id = acquisitionIdFor(sha256);
    const name = path.basename(entry.abs);

    const owner = idOwner.get(id);
    if (owner !== undefined && owner.sha256 !== sha256) {
      errors.push(`id collision: ${id} for ${entry.input} and ${owner.input}`);
      continue;
    }

    const dir = path.join(campaignRoot, folder, id);
    let status = 'new';
    let duplicateOf = null;
    if (fs.existsSync(dir)) {
      const recorded = readRecordedSha(dir);
      if (!recorded.exists) {
        errors.push(`${folder}/${id} exists without card.md`);
        continue;
      }
      if (recorded.sha !== sha256) {
        errors.push(`id collision: ${folder}/${id} is already acquired with another sha256`);
        continue;
      }
      status = 'duplicate-acquired';
      duplicateOf = id;
    } else if (firstInputOfSha.has(sha256)) {
      status = 'duplicate-input';
      duplicateOf = firstInputOfSha.get(sha256);
    }

    if (!firstInputOfSha.has(sha256)) firstInputOfSha.set(sha256, entry.input);
    if (owner === undefined) idOwner.set(id, { sha256, input: entry.input });

    files.push({
      input: entry.input,
      name,
      ext: path.extname(name),
      size: buffer.length,
      sha256,
      id,
      status,
      duplicate_of: duplicateOf,
    });
  }

  return { sources_folder: folder, files, errors };
}
