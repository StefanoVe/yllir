// Acquires the new files of an inventory: one acquisition folder per original,
// with a byte-identical copy of the original, a skeleton card.md and a skeleton
// transcription.md. Never overwrites and never touches an input file.

import fs from 'node:fs';
import path from 'node:path';
import { findSourcesFolder, ID_PATTERN, SHA_PATTERN, acquisitionIdFor, readRecordedSha, sha256File } from './ingest-inventory.mjs';
import { KINDS } from './ingest-check.mjs';
import { METADATA_CLOSE, METADATA_OPEN } from '../../../../../scripts/lib/frontmatter.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value) {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Renders a value of the card as a frontmatter scalar. Plain text is written
 * as is; anything else is double-quoted. Double quotes and line breaks cannot
 * be recorded, so they are refused.
 */
function yamlText(value) {
  if (/^[\p{L}\p{N} ._()-]+$/u.test(value) && value === value.trim()) return value;
  if (/["\r\n]/.test(value) || value.includes(METADATA_CLOSE)) {
    throw new Error(`cannot record file name in card.md: ${value}`);
  }
  return `"${value}"`;
}

/**
 * Text of a new card.md (the skeleton of the acquisition).
 * @param {{ id: string, original: string, originalName: string, sha256: string,
 *   date: string, provenance: string, kind: string }} card
 */
export function renderCard({ id, original, originalName, sha256, date, provenance, kind }) {
  return [
    METADATA_OPEN,
    `id: ${id}`,
    `original: ${original}`,
    `original_name: ${yamlText(originalName)}`,
    `sha256: ${sha256}`,
    `acquired: ${date}`,
    `provenance: "${provenance}"`,
    `kind: ${kind}`,
    'pages: 0',
    'status: acquired',
    METADATA_CLOSE,
    '',
    `# Acquisition ${id}`,
    '',
    '## Claims',
    '',
    '## Open questions',
    '',
    '## Review',
    '',
  ].join('\n');
}

/**
 * Creates the acquisition folder of one new file. Returns 'acquired', or
 * 'skipped' when the folder already holds the same original.
 * Throws on any problem; a folder created by this call is removed again.
 */
function acquireOne({ campaignRoot, folder, file, baseDir, provenance, date, kind }) {
  if (!ID_PATTERN.test(file.id) || !SHA_PATTERN.test(file.sha256) || file.id !== acquisitionIdFor(file.sha256)) {
    throw new Error(`bad inventory entry for ${file.input}`);
  }
  const dir = path.join(campaignRoot, folder, file.id);
  if (fs.existsSync(dir)) {
    const recorded = readRecordedSha(dir);
    if (recorded.exists && recorded.sha === file.sha256) return 'skipped';
    if (!recorded.exists) throw new Error(`${folder}/${file.id} exists without card.md`);
    throw new Error(`id collision: ${folder}/${file.id} is already acquired with another sha256`);
  }

  const ext = path.extname(file.name).toLowerCase();
  const original = `original${ext}`;
  const cardText = renderCard({
    id: file.id,
    original,
    originalName: file.name,
    sha256: file.sha256,
    date,
    provenance,
    kind,
  });

  const source = path.resolve(baseDir, file.input);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.copyFileSync(source, path.join(dir, original), fs.constants.COPYFILE_EXCL);
    if (sha256File(path.join(dir, original)) !== file.sha256) {
      throw new Error(`original changed since inventory: ${file.input}`);
    }
    fs.writeFileSync(path.join(dir, 'card.md'), cardText, { flag: 'wx' });
    fs.writeFileSync(path.join(dir, 'transcription.md'), `# Transcription ${file.id}\n\n`, { flag: 'wx' });
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return 'acquired';
}

/**
 * Acquires the `new` files of an inventory. An inventory with errors acquires
 * nothing.
 * @param {{ campaignRoot: string, inventory: object, provenance: string, date: string,
 *   kind?: string, baseDir: string }} args
 *   baseDir: the folder against which the inventory inputs are resolved
 * @returns {{ acquired: string[], skipped: string[], errors: string[] }}
 * @throws {Error} on usage errors (provenance, date or kind)
 */
export function acquireSources({ campaignRoot, inventory, provenance, date, kind = 'other', baseDir }) {
  if (typeof provenance !== 'string' || provenance.trim() === '') {
    throw new Error('provenance must not be empty');
  }
  if (/["\r\n]/.test(provenance) || provenance.includes(METADATA_CLOSE)) {
    throw new Error('provenance must not contain double quotes, line breaks or -->');
  }
  if (!isRealDate(date)) {
    throw new Error(`date must be a real date YYYY-MM-DD: ${date}`);
  }
  if (!KINDS.includes(kind)) {
    throw new Error(`bad kind: ${kind}`);
  }
  if (inventory === null || typeof inventory !== 'object' || !Array.isArray(inventory.files)) {
    throw new Error('inventory must have a files list');
  }

  const { folder, errors: sourceErrors } = findSourcesFolder(campaignRoot);
  if (folder === null) return { acquired: [], skipped: [], errors: sourceErrors };
  if (inventory.sources_folder !== folder) {
    return {
      acquired: [],
      skipped: [],
      errors: [`inventory was made for sources folder ${inventory.sources_folder}, campaign has ${folder}`],
    };
  }
  if (Array.isArray(inventory.errors) && inventory.errors.length > 0) {
    return { acquired: [], skipped: [], errors: [...inventory.errors] };
  }

  const acquired = [];
  const skipped = [];
  const errors = [];
  for (const file of inventory.files) {
    if (file.status !== 'new') continue;
    try {
      const outcome = acquireOne({ campaignRoot, folder, file, baseDir, provenance, date, kind });
      if (outcome === 'acquired') acquired.push(file.id);
      else skipped.push(file.id);
    } catch (err) {
      errors.push(err.message);
    }
  }
  return { acquired, skipped, errors };
}
