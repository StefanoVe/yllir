// Encounter census: `query encounters [sessionId]`. For every plot event that
// declares a fight (the `enemies` field, see plot/enemies-check.mjs), it reads
// the challenge rating of each enemy from its sheet (the adapter's statSummary)
// and, when the adapter has difficulty rules, rates the fight against the
// levels of the player characters. Asynchronous only because the adapter's
// modules are loaded with import(). Read-only; never writes.

import fs from 'node:fs';
import path from 'node:path';
import { loadAdapter, pluginRootFromHere } from '../adapter.mjs';
import { loadRateEncounter, loadStatSummary } from '../adapter-ops.mjs';
import { parseFrontmatter } from '../frontmatter.mjs';
import { parseYamlLite } from '../yaml-lite.mjs';
import { readStructure, listCanonicalSheets, listSheets, compareStrings } from '../subjects.mjs';
import { readEnemies } from '../plot/enemies-check.mjs';
import { buildWorldIndex } from '../world-graph.mjs';

const PLAYER_FOLDERS = new Set(['Giocatori', 'Players']);
const LEVEL_RE = /^[0-9]+$/;

/**
 * @param {string} root campaign folder
 * @param {string[]} [args] zero or one argument: the session id
 * @returns {Promise<{ query: string, args: string[], party?: number[], rated?: boolean, results?: object[], error?: string }>}
 */
export async function runEncounters(root, args = []) {
  const argList = [...args];
  if (argList.length > 1) {
    return { query: 'encounters', args: argList, error: 'encounters takes 0 to 1 arguments. usage: encounters [sessionId]' };
  }
  const session = argList.length === 1 ? argList[0] : null;

  const { structure } = readStructure(root);
  const adapter = adapterOf(root);
  const rateEncounter = await loadRateEncounter(adapter);
  const statSummary = await loadStatSummary(adapter);
  const party = partyLevels(root, structure ?? []);
  const subjects = new Map(buildWorldIndex(root).subjects.map((subject) => [subject.id, subject]));

  const results = [];
  for (const event of eventsWithFights(root, structure ?? [])) {
    if (session !== null && event.session !== session) continue;
    const enemies = event.enemies.map((enemy) => {
      const subject = subjects.get(enemy.id) ?? null;
      const text = subject === null ? null : readOptional(path.join(root, subject.file));
      const cr = text !== null && statSummary !== null ? crOf(statSummary(adapter, text)) : null;
      return { id: enemy.id, title: subject?.title ?? null, count: enemy.count, cr, known: subject !== null };
    });
    results.push(rate(event, enemies, party, rateEncounter, adapter));
  }

  results.sort((a, b) => compareStrings(a.session ?? '', b.session ?? '') || compareStrings(a.event, b.event));
  return {
    query: 'encounters',
    args: argList,
    party,
    rated: results.some((entry) => entry.xp !== null),
    results,
  };
}

/**
 * Rates one event. The first problem that applies is the one reported: no rules,
 * no party, an unknown enemy, an enemy without CR, or the rating's own error code.
 * `enemies` entries carry `known` (the id is a subject), which is not part of the output.
 */
function rate(event, enemies, party, rateEncounter, adapter) {
  const base = {
    event: event.event,
    file: event.file,
    session: event.session,
    enemies: enemies.map(({ id, title, count, cr }) => ({ id, title, count, cr })),
  };
  const none = { xp: null, band: null, budgets: null };
  const fail = (problem) => ({ ...base, ...none, problem });

  if (rateEncounter === null) return fail('no-difficulty-rules');
  if (party.length === 0) return fail('no-party');
  if (enemies.some((enemy) => !enemy.known)) return fail('unknown-enemy');
  if (enemies.some((enemy) => enemy.cr === null)) return fail('no-cr');

  const outcome = rateEncounter(adapter, {
    party,
    enemies: enemies.map((enemy) => ({ cr: enemy.cr, count: enemy.count })),
  });
  if (!outcome.ok) return { ...base, ...none, problem: outcome.error.code };
  return { ...base, xp: outcome.xp, band: outcome.band, budgets: outcome.budgets, problem: null };
}

/** The adapter loaded from the campaign's system.adapter, or null (none, unknown, or not loadable). */
function adapterOf(root) {
  const text = readOptional(path.join(root, 'campaign.yaml'));
  if (text === null) return null;
  const id = parseYamlLite(text).data?.system?.adapter;
  if (typeof id !== 'string' || id === '' || id === 'none') return null;
  const loaded = loadAdapter(pluginRootFromHere(), id);
  return loaded.ok && loaded.adapter ? loaded.adapter : null;
}

/** The cr line of a statSummary result, or null. */
function crOf(summary) {
  const line = summary.lines.find((entry) => entry.id === 'cr');
  return line === undefined ? null : line.value;
}

/** Levels of the player character sheets with a valid `level`, highest first. */
function partyLevels(root, structure) {
  const levels = [];
  for (const folder of playerFolders(structure)) {
    for (const rel of listCanonicalSheets(root, folder)) {
      const text = readOptional(path.join(root, rel));
      if (text === null) continue;
      const level = levelOf(parseFrontmatter(text).data?.level);
      if (level !== null) levels.push(level);
    }
  }
  return levels.sort((a, b) => b - a);
}

function levelOf(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && LEVEL_RE.test(value) && Number(value) > 0) return Number(value);
  return null;
}

function playerFolders(structure) {
  return structure
    .filter((entry) => entry.type === 'master-only' && typeof entry.folder === 'string')
    .map((entry) => path.posix.normalize(entry.folder).replace(/\/+$/, ''))
    .filter((folder) => PLAYER_FOLDERS.has(path.posix.basename(folder)));
}

/** Every event file with at least one valid enemy, read from its metadata. */
function eventsWithFights(root, structure) {
  const plotFolders = structure
    .filter((entry) => entry.type === 'plot' && typeof entry.folder === 'string')
    .map((entry) => path.posix.normalize(entry.folder).replace(/\/+$/, ''));
  const files = plotFolders.flatMap((folder) => listSheets(root, folder)).filter((rel) => isEventFile(rel, plotFolders));

  const out = [];
  for (const file of [...new Set(files)].sort(compareStrings)) {
    const text = readOptional(path.join(root, file));
    if (text === null) continue;
    const { data } = parseFrontmatter(text);
    if (!data || !Object.hasOwn(data, 'enemies')) continue;
    const enemies = readEnemies(data);
    if (enemies.length === 0) continue;
    out.push({
      event: typeof data.id === 'string' && data.id !== '' ? data.id : path.posix.basename(file, '.md'),
      file,
      session: typeof data.session === 'string' ? data.session : null,
      enemies,
    });
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

function readOptional(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
