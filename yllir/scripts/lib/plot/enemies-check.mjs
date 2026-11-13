// Checks the `enemies` field of plot event files: the fights declared in the
// metadata block (block YAML: a list of maps with exactly `id` and `count`).
// Each id must be a subject whose sheet is a creature-like sheet (template enemy,
// creature, npc or vendor), each count a positive integer, and each id listed once.
// Deterministic: it reports what does not match the form; it does not judge balance.
// An event file is the same as in the engine's scene check: an .md inside an
// Eventi/Events folder of a `plot` category, other than the session main file.

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../frontmatter.mjs';
import { readStructure, listSheets, buildSubjectIndex, compareStrings } from '../subjects.mjs';

const CREATURE_TEMPLATES = new Set(['enemy', 'creature', 'npc', 'vendor']);
const COUNT_RE = /^[0-9]+$/;

/**
 * Converts one count value to a positive integer.
 * @param {unknown} value a count as read from the metadata (digit string or number)
 * @returns {number|null} the count, or null when it is not a positive integer
 */
function positiveCount(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && COUNT_RE.test(value)) {
    const number = Number(value);
    return number > 0 ? number : null;
  }
  return null;
}

/** True for a plain mapping with exactly the keys `id` and `count`. */
function hasEnemyShape(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const keys = Object.keys(entry).sort(compareStrings);
  return keys.length === 2 && keys[0] === 'count' && keys[1] === 'id';
}

/**
 * Reads the fights of event metadata. Invalid entries are skipped: a non-list
 * value, an entry that is not a map with exactly `id` and `count`, an empty id,
 * or a count that is not a positive integer.
 * @param {object|null|undefined} data the parsed metadata block of an event
 * @returns {Array<{ id: string, count: number }>} in file order
 */
export function readEnemies(data) {
  const list = data?.enemies;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const entry of list) {
    if (!hasEnemyShape(entry)) continue;
    if (typeof entry.id !== 'string' || entry.id === '') continue;
    const count = positiveCount(entry.count);
    if (count === null) continue;
    out.push({ id: entry.id, count });
  }
  return out;
}

/** An event file: inside a plot folder, in an Eventi or Events folder, and not a session main file. */
function isEventFile(rel, plotFolders) {
  if (!rel.endsWith('.md')) return false;
  if (!plotFolders.some((folder) => rel === folder || rel.startsWith(`${folder}/`))) return false;
  const parent = path.posix.basename(path.posix.dirname(rel));
  if (parent !== 'Eventi' && parent !== 'Events') return false;
  return path.posix.basename(rel, '.md') !== parent;
}

function normalizeRel(item) {
  return path.posix.normalize(String(item).split(path.sep).join('/')).replace(/^\.\//, '');
}

/**
 * Checks the `enemies` field of the event files of a campaign.
 * @param {string} root absolute path to the campaign folder
 * @param {{ files?: string[]|null }} [options] campaign-relative paths to check; all event files when omitted
 * @returns {{ errors: Array<{ file: string, code: string, message: string }> }}
 */
export function checkEnemies(root, { files = null } = {}) {
  const { structure, errors: configErrors } = readStructure(root);
  if (structure === null) {
    return { errors: configErrors.map((e) => ({ file: e.file, code: 'config', message: e.message })) };
  }

  const plotFolders = structure
    .filter((entry) => entry.type === 'plot' && typeof entry.folder === 'string')
    .map((entry) => path.posix.normalize(entry.folder).replace(/\/+$/, ''));

  let candidates;
  if (Array.isArray(files)) {
    candidates = files.map(normalizeRel).filter((rel) => isEventFile(rel, plotFolders));
  } else {
    candidates = plotFolders.flatMap((folder) => listSheets(root, folder)).filter((rel) => isEventFile(rel, plotFolders));
  }
  candidates = [...new Set(candidates)].sort(compareStrings);
  if (candidates.length === 0) return { errors: [] };

  const subjects = new Map(buildSubjectIndex(root).subjects.map((subject) => [subject.id, subject]));
  const templateOf = new Map();
  const templateFor = (id) => {
    if (!templateOf.has(id)) {
      const subject = subjects.get(id);
      let template = null;
      try {
        const text = fs.readFileSync(path.join(root, subject.sheet), 'utf8');
        template = parseFrontmatter(text).data?.template ?? null;
      } catch {
        template = null;
      }
      templateOf.set(id, template);
    }
    return templateOf.get(id);
  };

  const errors = [];
  for (const file of candidates) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    const { data } = parseFrontmatter(text);
    if (!data || !Object.hasOwn(data, 'enemies')) continue;

    const add = (code, message) => errors.push({ file, code, message });
    const list = data.enemies;
    if (!Array.isArray(list)) {
      add('enemies-shape', 'enemies must be a list of maps with the keys id and count');
      continue;
    }

    const seen = new Set();
    for (const [index, entry] of list.entries()) {
      const where = `enemies item ${index + 1}`;
      if (!hasEnemyShape(entry)) {
        add('enemies-shape', `${where} must be a map with exactly the keys id and count`);
        continue;
      }
      const id = entry.id;
      if (typeof id !== 'string' || id === '') {
        add('enemies-shape', `${where} has no id`);
        continue;
      }

      if (positiveCount(entry.count) === null) {
        add('enemies-count', `${where} (${id}) count must be a positive integer, not ${JSON.stringify(entry.count)}`);
      }

      if (!subjects.has(id)) {
        add('enemies-unknown', `${where} names ${id}, which is not a subject of the campaign`);
      } else if (!CREATURE_TEMPLATES.has(templateFor(id))) {
        add('enemies-not-creature', `${where} names ${id}, whose sheet is not an enemy, creature, npc or vendor sheet`);
      }

      if (seen.has(id)) {
        add('enemies-duplicate', `${id} is listed more than once in enemies`);
      }
      seen.add(id);
    }
  }
  return { errors };
}
