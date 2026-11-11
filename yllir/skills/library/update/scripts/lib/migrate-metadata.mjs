// Migration metadata-comment-v1: converts the metadata block of campaign Markdown files
// from the old YAML frontmatter form (`---` lines) to the comment form (`<!-- yllir`
// ... `-->`). Deterministic: the conversion is frontmatter.mjs's toCommentMetadata,
// which changes only the two delimiter lines and keeps every other byte.
//
// Files converted (listMetadataFiles):
//   - the seed named by campaign.seed;
//   - every .md, recursively, of each structure folder that is not `external`; inside a
//     `sources` folder, files whose name starts with `original` are never listed;
//   - every .md, recursively, under .campaign/state/.
// Never listed: anything under a .git folder, .campaign/customizations.md, CLAUDE.md,
// symbolic links (files and folders), missing folders. When campaign.yaml cannot be read
// there is no campaign to migrate, and nothing is listed.
//
// planMetadataMigration writes nothing. applyMetadataMigration writes the converted files;
// it does not run git and does not save a version (the update runner does that).

import fs from 'node:fs';
import path from 'node:path';
import { toCommentMetadata } from '../../../../../scripts/lib/frontmatter.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';

const CAMPAIGN_YAML = 'campaign.yaml';
const STATE_DIR = '.campaign/state';
const EXCLUDED = new Set(['CLAUDE.md', '.campaign/customizations.md']);

/**
 * The campaign-relative paths (forward slashes, sorted) of the .md files this migration may convert.
 * @param {string} root campaign folder
 * @returns {string[]}
 */
export function listMetadataFiles(root) {
  const config = readConfig(root);
  if (config === null) return [];
  const found = new Set();

  const seed = safeRelative(config.campaign?.seed);
  if (seed !== null && seed.endsWith('.md') && isRegularFile(path.join(root, seed))) found.add(seed);

  const structure = Array.isArray(config.structure) ? config.structure : [];
  for (const entry of structure) {
    if (entry === null || typeof entry !== 'object' || typeof entry.folder !== 'string') continue;
    if (entry.type === 'external') continue;
    const folder = safeRelative(entry.folder);
    if (folder === null || !isDirectory(path.join(root, folder))) continue;
    const keep = entry.type === 'sources'
      ? (name) => !name.startsWith('original')
      : () => true;
    walkMarkdown(root, folder, keep, found);
  }

  if (isDirectory(path.join(root, STATE_DIR))) walkMarkdown(root, STATE_DIR, () => true, found);

  return [...found].filter((file) => !isExcluded(file)).sort();
}

/**
 * Plans the migration: which listed files have the old form, and which cannot be read.
 * @param {string} root campaign folder
 * @returns {{ status: 'complete' | 'pending', changed: string[], skipped: [], errors: Array<{code: string, file: string, message: string}> }}
 */
export function planMetadataMigration(root) {
  const changed = [];
  const errors = [];
  for (const file of listMetadataFiles(root)) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch (err) {
      errors.push({ code: 'migrate-read', file, message: err.message });
      continue;
    }
    if (toCommentMetadata(text) !== null) changed.push(file);
  }
  return { status: changed.length === 0 ? 'complete' : 'pending', changed, skipped: [], errors };
}

/**
 * Converts every file the plan lists. Status is complete after a successful run, and
 * failed when a file cannot be written (the files already written stay converted, and a
 * new run finishes the rest).
 * @param {string} root campaign folder
 * @returns {{ status: 'complete' | 'failed', changed: string[], skipped: [], errors: Array<{code: string, file: string, message: string}> }}
 */
export function applyMetadataMigration(root) {
  const plan = planMetadataMigration(root);
  const changed = [];
  const errors = [...plan.errors];
  for (const file of plan.changed) {
    const abs = path.join(root, file);
    try {
      const converted = toCommentMetadata(fs.readFileSync(abs, 'utf8'));
      if (converted === null) continue;
      fs.writeFileSync(abs, converted);
      changed.push(file);
    } catch (err) {
      errors.push({ code: 'migrate-write', file, message: err.message });
    }
  }
  const failed = errors.some((error) => error.code === 'migrate-write');
  return { status: failed ? 'failed' : 'complete', changed, skipped: [], errors };
}

// ---------------------------------------------------------------- helpers

function readConfig(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, CAMPAIGN_YAML), 'utf8');
  } catch {
    return null;
  }
  const parsed = parseYamlLite(text);
  if (parsed.errors.length > 0 || parsed.data === null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) return null;
  return parsed.data;
}

/** A campaign-relative POSIX path, or null when it is not a relative path inside the campaign. */
function safeRelative(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normal = path.posix.normalize(value.replace(/\\/g, '/'));
  if (normal === '.' || normal === '..' || normal.startsWith('../') || path.posix.isAbsolute(normal)) return null;
  return normal;
}

function isExcluded(file) {
  return EXCLUDED.has(file) || file.split('/').includes('.git');
}

function lstatOrNull(abs) {
  try {
    return fs.lstatSync(abs);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw err;
  }
}

function isRegularFile(abs) {
  const stat = lstatOrNull(abs);
  return stat !== null && stat.isFile();
}

function isDirectory(abs) {
  const stat = lstatOrNull(abs);
  return stat !== null && stat.isDirectory();
}

/** Adds the .md files under relDir (recursively) to found. Symlinks are never followed nor changed. */
function walkMarkdown(root, relDir, keep, found) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, relDir));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return;
    throw err;
  }
  for (const name of entries.sort()) {
    if (name === '.git') continue;
    const rel = `${relDir}/${name}`;
    const abs = path.join(root, rel);
    const stat = lstatOrNull(abs);
    if (stat === null || stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      walkMarkdown(root, rel, keep, found);
    } else if (stat.isFile() && name.endsWith('.md') && keep(name)) {
      found.add(rel);
    }
  }
}
