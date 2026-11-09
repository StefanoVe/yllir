// Link sidestep of document-ingest: a file that is already a complete campaign
// document is not copied or transcribed. Instead a symlink to its original is
// created in the canon category folder, and its inventory entry becomes `linked`.
// Never modifies, moves or deletes the original; never overwrites anything.
// Deterministic: no clock, no network.

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';

/**
 * Reads and checks the inventory written by ingest-inventory.
 * @param {string} file absolute path
 * @returns {{ inventory: object|null, errors: string[] }} inventory is null when errors is not empty
 */
export function readInventory(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { inventory: null, errors: [`cannot read inventory ${file}: ${err.message}`] };
  }
  let inventory;
  try {
    inventory = JSON.parse(text);
  } catch (err) {
    return { inventory: null, errors: [`inventory is not valid JSON: ${err.message}`] };
  }
  if (inventory === null || typeof inventory !== 'object' || !Array.isArray(inventory.files)) {
    return { inventory: null, errors: ['inventory must hold a files list'] };
  }
  const bad = inventory.files.findIndex(
    (entry) =>
      entry === null ||
      typeof entry !== 'object' ||
      typeof entry.input !== 'string' ||
      typeof entry.name !== 'string' ||
      typeof entry.ext !== 'string' ||
      typeof entry.status !== 'string',
  );
  if (bad !== -1) {
    return { inventory: null, errors: [`inventory entry ${bad} is malformed`] };
  }
  return { inventory, errors: [] };
}

/**
 * Explains why an inventory entry is not a link candidate.
 * A candidate has status `new`, a `.md` extension, a regular file that starts
 * with front matter holding a string `id`. Symlinked originals are followed.
 * @param {object} entry inventory entry
 * @param {string} baseDir absolute path used to resolve entry.input
 * @returns {string|null} null when the entry is a candidate, otherwise the reason
 */
export function candidateReason(entry, baseDir) {
  if (entry.status !== 'new') return `status is ${entry.status}`;
  if (entry.ext.toLowerCase() !== '.md') return 'not a .md file';
  const abs = path.resolve(baseDir, entry.input);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (err) {
    return `cannot read the original: ${err.message}`;
  }
  if (!stat.isFile()) return 'not a regular file';
  const { data } = parseFrontmatter(fs.readFileSync(abs, 'utf8'));
  if (data === null) return 'no front matter';
  if (typeof data.id !== 'string' || data.id.trim() === '') return 'front matter has no id';
  return null;
}

/**
 * Lists the candidates of an inventory, in inventory order.
 * @param {object} inventory checked by readInventory
 * @param {string} baseDir absolute path used to resolve entry inputs
 * @returns {object[]} the candidate entries
 */
export function findCandidates(inventory, baseDir) {
  return inventory.files.filter((entry) => candidateReason(entry, baseDir) === null);
}

/** True when `child` is strictly inside `parent` (both absolute, real paths). */
export function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * Checks the category folder: a campaign-relative folder that exists, is a
 * directory and whose real path lies inside the campaign.
 * @param {string} campaignRoot absolute path
 * @param {string} folder campaign-relative folder, with `/`
 * @returns {{ folder: string|null, error: string|null }} folder is normalized, with `/`
 */
export function resolveCategoryFolder(campaignRoot, folder) {
  if (path.isAbsolute(folder)) {
    return { folder: null, error: 'category folder must be relative to the campaign' };
  }
  const normalized = path.posix.normalize(folder).replace(/\/+$/, '');
  if (
    normalized === '' ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    return { folder: null, error: 'category folder must be inside the campaign' };
  }
  const abs = path.join(campaignRoot, normalized);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { folder: null, error: `category folder does not exist: ${normalized}` };
  }
  if (!stat.isDirectory()) {
    return { folder: null, error: `category folder is not a folder: ${normalized}` };
  }
  const realRoot = fs.realpathSync(campaignRoot);
  const realFolder = fs.realpathSync(abs);
  if (!isInside(realRoot, realFolder)) {
    return { folder: null, error: 'category folder is outside the campaign' };
  }
  return { folder: normalized, error: null };
}

/** True when anything (file, folder or broken symlink) is at `p`. */
function pathExists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Creates the symlinks for the inputs that are candidates. Refused inputs stay
 * `new` and nothing is created for them. Updates the inventory entries in place
 * (status `linked`, `linked_as`, `external`).
 * @param {{ campaignRoot: string, categoryFolder: string, inputs: string[], inventory: object, baseDir: string }} args
 *   campaignRoot: absolute; categoryFolder: campaign-relative, already checked; baseDir: resolves inputs
 * @returns {{ links: Array<{input: string, path: string, external: boolean}>, refused: Array<{input: string, reason: string}> }}
 */
export function linkInputs({ campaignRoot, categoryFolder, inputs, inventory, baseDir }) {
  const realRoot = fs.realpathSync(campaignRoot);
  const unique = [...new Set(inputs)];
  const nameCount = new Map();
  for (const input of unique) {
    const name = path.basename(input);
    nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  }

  const links = [];
  const refused = [];
  for (const input of unique) {
    const entry = inventory.files.find((file) => file.input === input);
    if (entry === undefined) {
      refused.push({ input, reason: 'not in the inventory' });
      continue;
    }
    const reason = candidateReason(entry, baseDir);
    if (reason !== null) {
      refused.push({ input, reason: `not a candidate: ${reason}` });
      continue;
    }
    const name = entry.name;
    if (nameCount.get(path.basename(input)) > 1) {
      refused.push({ input, reason: 'another input in this call has the same name' });
      continue;
    }
    const linkedAs = path.posix.join(categoryFolder, name);
    const target = path.join(campaignRoot, categoryFolder, name);
    if (pathExists(target)) {
      refused.push({ input, reason: `already exists: ${linkedAs}` });
      continue;
    }

    const original = fs.realpathSync(path.resolve(baseDir, input));
    try {
      fs.symlinkSync(original, target);
    } catch (err) {
      if (err.code === 'EEXIST') {
        refused.push({ input, reason: `already exists: ${linkedAs}` });
        continue;
      }
      throw err;
    }

    const external = !isInside(realRoot, original);
    entry.status = 'linked';
    entry.linked_as = linkedAs;
    entry.external = external;
    links.push({ input, path: linkedAs, external });
  }
  return { links, refused };
}
