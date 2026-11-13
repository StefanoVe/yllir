// encounters-v1: the event files (plot scenes) with a creature in their characters and no
// `enemies` key yet. The inventory is the migration's own state
// (.campaign/state/update/encounters.json): one record per event file, status pending,
// complete or no-fight. The guided part decides each pending event from its text and writes
// the `enemies` block; checkEnemies (plot/enemies-check.mjs) validates the written block.
import fs from 'node:fs';
import path from 'node:path';
import { readStructure, listSheets, buildSubjectIndex, compareStrings } from '../../../../../scripts/lib/subjects.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { checkEnemies, readEnemies } from '../../../../../scripts/lib/plot/enemies-check.mjs';

const STATE = '.campaign/state/update/encounters.json';
const FIGHT_TEMPLATES = new Set(['enemy', 'creature']);

/**
 * An event file, as the engine and enemies-check read it: an .md inside an Eventi or Events
 * folder of a plot category, other than the session main file. (Same rule as plot/enemies-check.mjs,
 * which does not export it.)
 */
function isEventFile(rel, plotFolders) {
  if (!rel.endsWith('.md')) return false;
  if (!plotFolders.some((folder) => rel === folder || rel.startsWith(`${folder}/`))) return false;
  const parent = path.posix.basename(path.posix.dirname(rel));
  if (parent !== 'Eventi' && parent !== 'Events') return false;
  return path.posix.basename(rel, '.md') !== parent;
}

/**
 * Scans the event files of the campaign.
 * @returns {{ status: 'ok'|'failed', files: string[], found: Map<string, string[]>, errors: object[] }}
 *   found: event files with no `enemies` key that have a creature in `characters`, with the ids of those creatures.
 */
export function scanEvents(root) {
  const { structure, errors: configErrors } = readStructure(root);
  if (structure === null) {
    return { status: 'failed', files: [], found: new Map(), errors: configErrors };
  }
  const plotFolders = structure
    .filter((entry) => entry.type === 'plot' && typeof entry.folder === 'string')
    .map((entry) => path.posix.normalize(entry.folder).replace(/\/+$/, ''));
  const files = [...new Set(plotFolders.flatMap((folder) => listSheets(root, folder)).filter((rel) => isEventFile(rel, plotFolders)))].sort(compareStrings);

  const sheets = new Map(buildSubjectIndex(root).subjects.map((subject) => [subject.id, subject.sheet]));
  const templates = new Map();
  const templateOf = (id) => {
    if (!templates.has(id)) {
      let template = null;
      try {
        template = parseFrontmatter(fs.readFileSync(path.join(root, sheets.get(id)), 'utf8')).data?.template ?? null;
      } catch {
        template = null;
      }
      templates.set(id, template);
    }
    return templates.get(id);
  };

  const found = new Map();
  const errors = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch (err) {
      errors.push({ code: 'event-unreadable', file, message: err.message });
      continue;
    }
    const { data } = parseFrontmatter(text);
    if (!data || Object.hasOwn(data, 'enemies')) continue;
    const characters = Array.isArray(data.characters) ? data.characters.filter((id) => typeof id === 'string') : [];
    const ids = characters.filter((id) => sheets.has(id) && FIGHT_TEMPLATES.has(templateOf(id)));
    if (ids.length > 0) found.set(file, [...new Set(ids)].sort(compareStrings));
  }
  return { status: errors.length > 0 ? 'failed' : 'ok', files, found, errors };
}

/**
 * Refreshes the inventory and lists the pending events. A record is kept while its file exists:
 * no-fight and complete stay as they are, a pending one stays pending until it is resolved
 * (--no-fight, or --complete with a valid block). A new candidate becomes pending.
 * @returns {Promise<{ status: 'complete'|'pending'|'failed', events: Array<{file: string, status: 'pending', candidates: string[]}>, errors: object[] }>}
 */
export async function prepareEncounters(root, { persist = true } = {}) {
  root = path.resolve(root);
  const scan = scanEvents(root);
  if (scan.status === 'failed') return { status: 'failed', events: [], errors: scan.errors };
  const exists = new Set(scan.files);
  const previous = readState(root);
  const next = new Map();
  for (const [file, record] of previous) {
    if (!exists.has(file)) continue;
    if (record.status === 'no-fight' || record.status === 'complete') next.set(file, { file, status: record.status });
    else next.set(file, { file, status: 'pending' });
  }
  for (const file of scan.found.keys()) {
    if (!next.has(file) || next.get(file).status === 'pending') next.set(file, { file, status: 'pending' });
  }
  const records = [...next.values()].sort((a, b) => compareStrings(a.file, b.file));
  if (persist) writeState(root, { events: records });
  const events = records.filter((r) => r.status === 'pending').map((r) => ({ file: r.file, status: 'pending', candidates: scan.found.get(r.file) ?? [] }));
  return { status: events.length > 0 ? 'pending' : 'complete', events, errors: [] };
}

/**
 * Marks an event as having no fight, so it is never proposed again.
 * @returns {Promise<{ status: 'no-fight'|'failed', file: string, errors: object[] }>}
 */
export async function markNoFight(root, file) {
  root = path.resolve(root);
  const scan = scanEvents(root);
  if (scan.status === 'failed') return { status: 'failed', file, errors: scan.errors };
  if (!scan.files.includes(file)) return { status: 'failed', file, errors: [{ code: 'not-an-event', file }] };
  const records = readState(root);
  records.set(file, { file, status: 'no-fight' });
  writeState(root, { events: [...records.values()].sort((a, b) => compareStrings(a.file, b.file)) });
  return { status: 'no-fight', file, errors: [] };
}

/**
 * Marks the given events complete, but only those whose current text has a valid `enemies`
 * block (at least one entry, every entry valid). The others stay pending, with their errors.
 * @returns {Promise<{ status: 'complete'|'pending'|'failed', completed: string[], events: object[], errors: object[] }>}
 */
export async function completeEncounters(root, files) {
  root = path.resolve(root);
  const scan = scanEvents(root);
  if (scan.status === 'failed') return { status: 'failed', completed: [], events: [], errors: scan.errors };
  const records = readState(root);
  const completed = [];
  const errors = [];
  for (const file of files) {
    if (!scan.files.includes(file)) {
      errors.push({ code: 'not-an-event', file });
      continue;
    }
    const problem = enemiesProblem(root, file);
    if (problem !== null) {
      // A refused event is pending, even when it was never listed: it keeps the migration open.
      if (records.get(file)?.status !== 'no-fight') records.set(file, { file, status: 'pending' });
      errors.push({ code: 'enemies-missing', file, message: problem });
      continue;
    }
    records.set(file, { file, status: 'complete' });
    completed.push(file);
  }
  writeState(root, { events: [...records.values()].sort((a, b) => compareStrings(a.file, b.file)) });
  const pending = await prepareEncounters(root, { persist: false });
  return { status: pending.events.length > 0 ? 'pending' : 'complete', completed, events: pending.events, errors };
}

/** Why the `enemies` block of a file is not valid, or null when it is valid. */
function enemiesProblem(root, file) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, file), 'utf8');
  } catch (err) {
    return err.message;
  }
  const { data } = parseFrontmatter(text);
  if (!data || !Array.isArray(data.enemies) || data.enemies.length === 0) return 'the enemies block is missing or empty';
  if (readEnemies(data).length !== data.enemies.length) return 'an enemies entry is not valid';
  const { errors } = checkEnemies(root, { files: [file] });
  if (errors.length > 0) return errors[0].message;
  return null;
}

function readState(root) {
  const records = new Map();
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, STATE), 'utf8'));
    for (const record of Array.isArray(value.events) ? value.events : []) {
      if (typeof record?.file === 'string' && ['pending', 'complete', 'no-fight'].includes(record.status)) {
        records.set(record.file, { file: record.file, status: record.status });
      }
    }
  } catch {
    // no state yet, or an unreadable one: the inventory starts again
  }
  return records;
}

function writeState(root, value) {
  const file = path.join(root, STATE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
