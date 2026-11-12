// Retired subject ids. An id that belonged to a deleted or merged subject is never used
// again, because printed cards and links elsewhere may still point at it. The retired ids
// live in .campaign/retired-ids.json ({ "ids": [...] }), which is campaign state saved in the
// same version as the batch that retires them. Pure except for reading and writing that file.

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../frontmatter.mjs';
import { compareStrings } from '../subjects.mjs';

export const RETIRED_IDS_FILE = '.campaign/retired-ids.json';

const INVALID_CODE = 'retired-ids-invalid';
const REUSED_CODE = 'id-reused';

/**
 * Reads the retired ids of a campaign. A missing file means an empty list.
 * @param {string} dir campaign folder
 * @returns {{ ok: true, ids: string[] } | { ok: false, message: string }}
 */
export function readRetiredIds(dir) {
  const full = path.join(dir, RETIRED_IDS_FILE);
  let text;
  try {
    text = fs.readFileSync(full, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, ids: [] };
    return { ok: false, message: `${RETIRED_IDS_FILE} cannot be read: ${error.message}` };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: `${RETIRED_IDS_FILE} is not valid JSON` };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.ids)) {
    return { ok: false, message: `${RETIRED_IDS_FILE} must be an object with an "ids" list` };
  }
  if (data.ids.some((id) => typeof id !== 'string' || id === '')) {
    return { ok: false, message: `${RETIRED_IDS_FILE} "ids" must contain only non-empty strings` };
  }
  return { ok: true, ids: uniqueSorted(data.ids) };
}

/**
 * Writes the retired ids (sorted, unique, 2-space indent, trailing newline). Nothing is
 * written when the list is empty and no file exists yet.
 * @param {string} root campaign folder (the real one, or the temporary copy)
 * @param {string[]} ids
 */
export function writeRetiredIds(root, ids) {
  const full = path.join(root, RETIRED_IDS_FILE);
  const list = uniqueSorted(ids);
  if (list.length === 0 && !fs.existsSync(full)) return;
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify({ ids: list }, null, 2)}\n`);
}

/**
 * Pure rule of the retirements of one batch.
 * @param {object} input
 * @param {Iterable<string>} input.prior ids retired before the batch
 * @param {Array<{ file: string, id: string|null }>} input.deletes sheets deleted by the batch, with the id
 *   they had before the batch
 * @param {Array<{ file: string, id: string|null, merged: string[], isNew: boolean, previousId: string|null }>} input.writes
 *   sheets written by the batch: id in the draft, merged_ids in the draft, whether the path did not exist
 *   before, and the id the sheet had before the batch
 * @returns {{ errors: object[], ids: string[] }} errors (code id-reused) and the full retired list after the batch
 */
export function planRetirements({ prior = [], deletes = [], writes = [] }) {
  const priorSet = new Set(prior);
  const writtenIds = new Set(writes.map((w) => w.id).filter((id) => typeof id === 'string'));

  // A deleted id is retired unless the batch writes a sheet with the same id (rename or move).
  const retiredByDelete = deletes
    .map((d) => d.id)
    .filter((id) => typeof id === 'string' && !writtenIds.has(id));
  const retiredByMerge = writes.flatMap((w) => w.merged ?? []);
  const batchRetired = new Set([...retiredByDelete, ...retiredByMerge]);

  const errors = [];
  for (const write of writes) {
    if (typeof write.id !== 'string') continue;
    const changed = write.isNew || write.id !== write.previousId;
    if (!changed) continue;
    if (priorSet.has(write.id) || batchRetired.has(write.id)) {
      errors.push({
        file: write.file,
        code: REUSED_CODE,
        message: `the id ${write.id} was retired (a deleted or merged subject had it) and must not be used again: choose a new id`,
      });
    }
  }

  return { errors, ids: uniqueSorted([...priorSet, ...retiredByDelete, ...retiredByMerge]) };
}

/**
 * Reads the retired ids and the batch from the campaign, and plans the retirements.
 * Must run after the batch paths have passed the preflight checks (existing regular files,
 * drafts present).
 * @param {string} dir campaign folder, before the batch
 * @param {{ files: string[], deletes: string[], draftRoot: string }} batch
 * @returns {{ errors: object[], ids: string[] }} when errors is empty, ids is what the campaign must save
 */
export function planRetiredIds(dir, { files, deletes, draftRoot }) {
  const stored = readRetiredIds(dir);
  if (!stored.ok) {
    return { errors: [{ file: RETIRED_IDS_FILE, code: INVALID_CODE, message: stored.message }], ids: [] };
  }

  const deleteInfo = deletes.map((rel) => ({ file: rel, id: sheetId(readText(path.join(dir, rel))) }));
  const writes = files.map((rel) => {
    const draft = readText(path.join(draftRoot, rel));
    const before = readText(path.join(dir, rel));
    return {
      file: rel,
      id: sheetId(draft),
      merged: mergedIds(draft),
      isNew: before === null,
      previousId: before === null ? null : sheetId(before),
    };
  });

  return planRetirements({ prior: stored.ids, deletes: deleteInfo, writes });
}

/** The id of a sheet text (frontmatter or comment metadata), or null. */
function sheetId(text) {
  if (text === null) return null;
  const id = parseFrontmatter(text).data?.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** The merged_ids list of a sheet text: strings only. */
function mergedIds(text) {
  if (text === null) return [];
  const merged = parseFrontmatter(text).data?.merged_ids;
  return Array.isArray(merged) ? merged.filter((id) => typeof id === 'string' && id !== '') : [];
}

function readText(full) {
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

function uniqueSorted(ids) {
  return [...new Set(ids)].sort(compareStrings);
}
