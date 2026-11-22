#!/usr/bin/env node
// Runs one world case end to end. The setup copies a fixture campaign into a temporary git
// repository, generates the instructions and saves version 1. The agent (`claude -p`) gets the
// master's request, and the runner grades the world graph of the copy afterwards with
// buildWorldIndex (no model in the grading). The key is read from the repository and never reaches the agent.
//
// Cases (cases/world/<name>/case.yaml, with key.yaml beside it):
//   world-region    fixture morvalle-seeded: the seed holds constraints; new villages and their
//                   chiefs around the lake, and a fishermen's faction (checks W1 to W10)
//   world-creature  fixture morvalle with system.adapter dnd-2024: one sheet, an enemy or a character
//                   (npc or vendor), complete and playable (C1 to C6)
//   world-item      fixture morvalle: a key whose real purpose the players do not know; its public part
//                   stays clean and its master block holds the secret (I1 to I6)
// All cases: L-time and L-calls from case.yaml limits. With --judge, a distinct model grades
// the creative quality (Q-grid, quality_min).
//
// Usage: node testbench/runners/run-world-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude]
//          [--keep] [--delegation auto|always|never] [--judge] [--judge-model opus]
//        node testbench/runners/run-world-case.mjs <caseDir> --setup-only
//        node testbench/runners/run-world-case.mjs <caseDir> --grade-only <dir> --run-json <file> [--judge]
// --keep keeps the folder and saves the agent's report, cost and the setup values beside it as
// <dir>.run.json; --grade-only grades such a folder again without running the agent. One JSON line per
// run is appended to testbench/results/<case>.jsonl (not in --grade-only).
// Exit codes: 0 every run passes; 1 some run fails; 2 the case cannot be used.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REPO_ROOT,
  applyLimits,
  appendResult,
  instructionsHash,
  listFiles,
  loadYamlMapping,
  parseCommonArgs,
  parseLimits,
  printSummary,
  recordHeader,
  runAgent,
} from './lib/case-common.mjs';
import { DEFAULT_DELEGATION, buildPluginVariant, parseDelegation } from './lib/plugin-variant.mjs';
import {
  DEFAULT_JUDGE_MODEL,
  DEFAULT_QUALITY_MIN,
  assertDistinctJudge,
  qualityCheck,
  runQualityJudge,
} from './lib/quality-judge.mjs';
import { generateInstructions } from '../../yllir/scripts/lib/instructions.mjs';
import { ensureRepo, listVersions, saveVersion } from '../../yllir/scripts/lib/versions.mjs';
import { buildWorldIndex } from '../../yllir/scripts/lib/world-graph.mjs';
import { loadAdapter } from '../../yllir/scripts/lib/adapter.mjs';
import { validateSheet } from '../../yllir/scripts/lib/adapter-ops.mjs';
import { actionRowCount } from '../../yllir/scripts/lib/statistics-tables.mjs';
import { parseFrontmatter } from '../../yllir/scripts/lib/frontmatter.mjs';
import { foldForm } from '../../yllir/scripts/lib/fold.mjs';
import { MASTER_MARKER, publicBody } from '../../yllir/scripts/lib/public-text.mjs';

const USAGE =
  'usage: node testbench/runners/run-world-case.mjs <caseDir> [--runs N] [--model sonnet] [--agent claude] [--keep] [--delegation auto|always|never] [--judge] [--judge-model opus] [--setup-only] [--grade-only <dir> --run-json <file>]';
const AGENT_TIMEOUT_MS = 1800000;
const PLUGIN_DIR = path.join(REPO_ROOT, 'yllir');
const FIXTURES = path.join(REPO_ROOT, 'testbench', 'fixtures');
const VERSION_MESSAGE = 'Creata la campagna di prova';
const CASE_KINDS = new Map([
  ['world-region', 'region'],
  ['world-creature', 'creature'],
  ['world-item', 'item'],
]);
const REQUIRED_KEYS = {
  region: [
    'lake_id',
    'min_new_subjects',
    'min_full_documents',
    'min_sketches',
    'min_new_places',
    'min_faction_members',
    'surname_suffix',
    'min_checkable_characters',
  ],
  creature: ['accepted', 'location', 'abilities'],
  item: ['kind', 'template', 'item_type', 'forbidden_public', 'secret_words'],
};
// The labels of the characteristics table, by language (the heading of the table under Statistics).
const CHARACTERISTICS = { it: 'Caratteristiche', en: 'Characteristics' };
// The label of the actions table under Statistics (C6), by language.
const ACTIONS = { it: 'Attacchi e capacità', en: 'Attacks and abilities' };
// The kind and template pairs a creature sheet may take (C1). A creature (kind) is never a fighter: enemy only.
const ACCEPTED_PAIRS = [
  { kind: 'creature', template: 'enemy' },
  { kind: 'character', template: 'npc' },
  { kind: 'character', template: 'vendor' },
];
const LANGUAGES = ['it', 'en'];

// ---------------------------------------------------------------- case files

/** Reads case.yaml and key.yaml of a world case. Throws on any missing or badly typed field. */
export function loadWorldCase(caseDir) {
  const data = loadYamlMapping(path.join(caseDir, 'case.yaml'));
  const kind = CASE_KINDS.get(data.case);
  if (kind === undefined) throw new Error(`case.yaml: unknown case ${data.case}`);
  for (const field of ['prompt', 'fixture']) {
    if (typeof data[field] !== 'string' || data[field].trim() === '') throw new Error(`case.yaml: ${field} missing`);
  }
  if (data.reply !== undefined && (typeof data.reply !== 'string' || data.reply.trim() === '')) {
    throw new Error('case.yaml: reply must be a non-empty string');
  }
  if (kind === 'creature' && (typeof data.system_adapter !== 'string' || data.system_adapter === '')) {
    throw new Error('case.yaml: world-creature needs system_adapter');
  }
  const qualityMin = data.quality_min === undefined ? DEFAULT_QUALITY_MIN : Number(data.quality_min);
  if (!(qualityMin > 0 && qualityMin <= 5)) throw new Error('case.yaml: quality_min must be a number from 0 to 5');
  const key = loadYamlMapping(path.join(caseDir, 'key.yaml'));
  for (const name of REQUIRED_KEYS[kind]) {
    if (key[name] === undefined) throw new Error(`key.yaml: ${name} missing`);
  }
  for (const name of REQUIRED_KEYS[kind].filter((n) => n.startsWith('min_'))) {
    if (!Number.isInteger(key[name]) || key[name] < 0) throw new Error(`key.yaml: ${name} must be a whole number`);
  }
  if (kind === 'creature') {
    const accepted = key.accepted;
    if (!Array.isArray(accepted) || accepted.length === 0) throw new Error('key.yaml: accepted must be a list of kind and template pairs');
    for (const pair of accepted) {
      const ok = pair !== null && typeof pair === 'object' && ACCEPTED_PAIRS.some((item) => item.kind === pair.kind && item.template === pair.template);
      if (!ok) throw new Error(`key.yaml: accepted pair ${JSON.stringify(pair)} is not a creature (enemy) or a character (npc, vendor)`);
    }
  }
  if (kind === 'item') {
    for (const name of ['forbidden_public', 'secret_words']) {
      const list = key[name];
      const valid = Array.isArray(list) && list.length > 0 && list.every((word) => typeof word === 'string' && word.trim() !== '');
      if (!valid) throw new Error(`key.yaml: ${name} must be a list of non-empty words`);
    }
  }
  return { ...data, kind, key, qualityMin, limits: parseLimits(data) };
}

/** Reads a campaign's campaign.yaml (the metadata this runner needs: seed file name and language). */
function campaignMeta(dir) {
  return loadYamlMapping(path.join(dir, 'campaign.yaml'));
}

function seedFileOf(dir) {
  const seed = campaignMeta(dir).campaign?.seed;
  if (typeof seed !== 'string' || seed === '') throw new Error('campaign.yaml: campaign.seed missing');
  return path.join(dir, seed);
}

/** The text of the seed file, or '' when it is missing. */
function readSeed(dir) {
  try {
    return fs.readFileSync(seedFileOf(dir), 'utf8');
  } catch {
    return '';
  }
}

function campaignLanguage(dir) {
  const lang = campaignMeta(dir).language?.main ?? 'it';
  if (!LANGUAGES.includes(lang)) throw new Error(`campaign language ${lang} is not supported`);
  return lang;
}

/** Sets the system adapter of a campaign copy: the one line `  adapter: none` becomes the given id. */
export function setSystemAdapter(campaignDir, id) {
  const file = path.join(campaignDir, 'campaign.yaml');
  const text = fs.readFileSync(file, 'utf8');
  const hits = text.split('\n').filter((line) => line === '  adapter: none').length;
  if (hits !== 1) throw new Error(`campaign.yaml: "  adapter: none" found ${hits} times (want 1)`);
  fs.writeFileSync(file, text.replace(/^  adapter: none$/m, `  adapter: ${id}`));
}

// ---------------------------------------------------------------- setup

/** Runs a function with git's global and system configuration switched off, then restores the environment. */
function withIsolatedGit(fn) {
  const names = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
  const saved = names.map((name) => [name, process.env[name]]);
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  try {
    return fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** The error key that identifies a world-graph error across the run (file, code, message). */
const errorKey = (error) => `${error.file} | ${error.code} | ${error.message}`;

/** The state of the world before the agent runs: the subject ids and the error keys. */
export function baselineOf(index) {
  return { ids: index.subjects.map((subject) => subject.id), errors: index.errors.map(errorKey) };
}

/**
 * Builds the copy of the fixture for one run, with version 1 saved. Returns
 * { tmp, dir, versions, baseline, seedBefore }. The temporary folder is removed when the setup throws.
 */
export function setupWorldCase(caseData) {
  const fixture = path.join(FIXTURES, caseData.fixture, 'campaign');
  if (!fs.existsSync(fixture)) throw new Error(`fixture ${caseData.fixture} not found`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-world-'));
  try {
    const dir = path.join(tmp, 'campaign');
    fs.cpSync(fixture, dir, { recursive: true });
    if (caseData.system_adapter !== undefined && caseData.system_adapter !== 'none') {
      setSystemAdapter(dir, caseData.system_adapter);
    }
    return withIsolatedGit(() => {
      const generated = generateInstructions(dir);
      if (generated.errors.length > 0) throw new Error(`generateInstructions: ${JSON.stringify(generated.errors)}`);
      ensureRepo(dir);
      const saved = saveVersion(dir, { message: VERSION_MESSAGE, kind: 'framework' });
      if (!saved.saved) throw new Error('setup: version 1 was not saved');
      return {
        tmp,
        dir,
        versions: listVersions(dir).length,
        baseline: baselineOf(buildWorldIndex(dir)),
        seedBefore: readSeed(dir),
      };
    });
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

// ---------------------------------------------------------------- graph helpers

/** The subjects of the index that were not in the baseline: the ones the agent created. */
export function newSubjectsOf(index, baseline) {
  const known = new Set(baseline.ids);
  return index.subjects.filter((subject) => !known.has(subject.id));
}

/** The world-graph errors of the index that were not in the baseline. */
export function newErrorsOf(index, baseline) {
  const known = new Set(baseline.errors);
  return index.errors.filter((error) => !known.has(errorKey(error)));
}

/**
 * The last word of a subject's title (its first heading, or the file name), folded to lower case
 * without accents. Empty when there is no word.
 */
export function lastWordOf(subject) {
  const words = (subject.title ?? path.basename(subject.file, '.md')).match(/\p{L}+/gu) ?? [];
  return words.length === 0 ? '' : foldForm(words[words.length - 1]);
}

/**
 * The subtree of rootId: rootId plus every place that is located in the subtree, computed to a
 * fixed point over the given places. Returns a Set of ids.
 */
export function lakeClosure(places, rootId) {
  const set = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const place of places) {
      if (!set.has(place.id) && place.location.some((id) => set.has(id))) {
        set.add(place.id);
        grew = true;
      }
    }
  }
  return set;
}

/** The text of the `## title` section of a markdown body (up to the next level-2 heading), or null. */
export function sectionOf(body, title) {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => {
    const match = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    return match !== null && match[1] === title;
  });
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##[ \t]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

/** The rows (label, value: first two cells, header and separator skipped) of the `### title` table, or null. */
export function tableRows(section, title) {
  const lines = section.split('\n');
  const start = lines.findIndex((line) => {
    const match = /^###[ \t]+(.+?)[ \t]*$/.exec(line);
    return match !== null && match[1] === title;
  });
  if (start < 0) return null;
  const rows = [];
  let header = true;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}[ \t]/.test(line)) break;
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    if (header) {
      header = false;
      continue;
    }
    if (cells.length >= 2) rows.push({ label: cells[0], value: cells[1] });
  }
  return rows;
}

/**
 * C3 helper: for each ability id, the Characteristics row has a score with its modifier, and the
 * modifier is floor((score - 10) / 2). Returns the list of problems (empty when all hold).
 */
export function abilityProblems(markdown, adapter, lang, abilityIds) {
  const { body } = parseFrontmatter(markdown);
  const statisticsTitle = adapter.headings?.statistics?.[lang];
  if (typeof statisticsTitle !== 'string') return [`adapter has no statistics heading for ${lang}`];
  const statistics = sectionOf(body, statisticsTitle);
  if (statistics === null) return [`no ${statisticsTitle} section`];
  const rows = tableRows(statistics, CHARACTERISTICS[lang]);
  if (rows === null) return [`no ### ${CHARACTERISTICS[lang]} table`];
  const problems = [];
  for (const id of abilityIds) {
    const field = (adapter.creature_sheet?.required ?? []).find((item) => item.id === id);
    const label = field?.[`label_${lang}`];
    if (typeof label !== 'string') {
      problems.push(`the adapter has no label for ${id}`);
      continue;
    }
    const row = rows.find((item) => item.label.trim().toLowerCase() === label.toLowerCase());
    if (row === undefined) {
      problems.push(`no row for ${label}`);
      continue;
    }
    const match = /^(\d+)\s*\(\s*([+-])\s*(\d+)\s*\)$/.exec(row.value.replace(/−/g, '-').trim());
    if (match === null) {
      problems.push(`${label} is "${row.value}" (want a score with its modifier, such as 14 (+2))`);
      continue;
    }
    const score = Number(match[1]);
    const written = (match[2] === '-' ? -1 : 1) * Number(match[3]);
    const expected = Math.floor((score - 10) / 2);
    if (written !== expected) problems.push(`${label}: modifier ${written} for score ${score} (want ${expected})`);
  }
  return problems;
}

/**
 * C6 helper: the Attacks and abilities table under Statistics has at least one row. Returns the list of
 * problems (empty when it holds). The count is the adapter-independent one of statistics-tables.mjs.
 */
export function actionProblems(markdown, adapter, lang) {
  const { body } = parseFrontmatter(markdown);
  const statisticsTitle = adapter.headings?.statistics?.[lang];
  if (typeof statisticsTitle !== 'string') return [`adapter has no statistics heading for ${lang}`];
  const statistics = sectionOf(body, statisticsTitle);
  if (statistics === null) return [`no ${statisticsTitle} section`];
  if (actionRowCount(statistics, lang) === 0) return [`no row in the ### ${ACTIONS[lang]} table`];
  return [];
}

// ---------------------------------------------------------------- link-only saves

const LINK_SYNTAX = /\[([^\]]*)\]\([^)]*\)/g;
const withoutLinks = (line) => line.replace(LINK_SYNTAX, '$1');
const DIFF_NOT_IN_PLACE = /^(new file mode|deleted file mode|rename from|rename to|copy from|copy to|similarity index|dissimilarity index|Binary files)/;

/** Runs git in dir and returns its stdout. The outer GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE are dropped, as in versions.mjs. */
function gitOutput(dir, args) {
  const env = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  // core.quotePath=false keeps non-ASCII paths unquoted, so the .md check reads the real name.
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 512 * 1024 * 1024,
  });
}

/**
 * True when the commit ref only adds link syntax to existing Markdown files: every changed path is a .md file
 * modified in place (no add, delete or rename), and inside each hunk (-U0) the removed lines and the added
 * lines pair up in order, equal in number, and each pair is equal once [text](target) is reduced to text on
 * both sides. False for an empty commit.
 */
export function isLinkOnlyCommit(dir, ref) {
  const changed = gitOutput(dir, ['show', '--numstat', '--format=', '-M', ref]).split('\n').filter((line) => line !== '');
  if (changed.length === 0) return false;
  for (const line of changed) {
    const [added, removed, ...rest] = line.split('\t');
    const file = rest.join('\t');
    if (added === '-' || removed === '-') return false; // binary
    if (!file.endsWith('.md') || file.includes(' => ')) return false; // a rename shows as "old => new"
  }

  let removedLines = [];
  let addedLines = [];
  let inHunk = false;
  const hunkPairsOk = () => {
    const ok = removedLines.length === addedLines.length && removedLines.every((text, i) => withoutLinks(text) === withoutLinks(addedLines[i]));
    removedLines = [];
    addedLines = [];
    return ok;
  };
  for (const line of gitOutput(dir, ['show', '--format=', '-U0', '-M', ref]).split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (!hunkPairsOk()) return false;
      inHunk = false;
    } else if (line.startsWith('@@')) {
      if (!hunkPairsOk()) return false;
      inHunk = true;
    } else if (!inHunk) {
      if (DIFF_NOT_IN_PLACE.test(line) || line === '--- /dev/null' || line === '+++ /dev/null') return false;
    } else if (line.startsWith('-')) {
      removedLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      addedLines.push(line.slice(1));
    } // "\ No newline at end of file" and other lines carry no content
  }
  return hunkPairsOk();
}

/**
 * The reasons why the saved-version count is wrong for W9, C5 and I6 (an empty list when it is right).
 * The count is right when it is setupVersions + 1, or setupVersions + 2 with a link-only last version
 * (the link review saves its approved links as one more version).
 */
export function versionReasons({ dir, versions, setupVersions }) {
  if (versions === setupVersions + 1) return [];
  if (versions === setupVersions + 2 && dir !== undefined && isLinkOnlyCommit(dir, 'HEAD')) return [];
  const extra = versions === setupVersions + 2 ? ' (the extra version is not a link-only save)' : '';
  return [`${versions} saved versions (want ${setupVersions + 1})${extra}`];
}

// ---------------------------------------------------------------- grading

/** Returns { checks, failures, pass } with the record helper used by both grading functions. */
function checkBook() {
  const checks = {};
  const failures = [];
  const record = (id, reasons) => {
    checks[id] = reasons.length === 0;
    if (reasons.length > 0) failures.push(`${id} ${reasons.join('; ')}`);
  };
  const finish = (extra) => ({ checks, failures, pass: Object.values(checks).every(Boolean), ...extra });
  return { record, finish };
}

/**
 * The region checks W1 to W10 on the world graph after the run. after is buildWorldIndex(copy),
 * baseline the state before the run, seedBefore and seedAfter the seed texts, versions the number of
 * saved versions after the run and setupVersions the number before it (1). report is the final message
 * or null. Returns { checks, failures, pass, newSubjects, newFiles }.
 */
export function gradeRegion({ key, baseline, after, seedBefore, seedAfter, dir, versions, setupVersions, report }) {
  const { record, finish } = checkBook();
  const fresh = newSubjectsOf(after, baseline);

  const generated = fresh.filter((subject) => subject.provenance === 'generated');
  record('W1', generated.length >= key.min_new_subjects ? [] : [`${generated.length} new subjects with provenance generated (want ${key.min_new_subjects})`]);

  record('W2', fresh.filter((subject) => subject.kind === null).map((subject) => `${subject.id} has no kind`));

  const sketches = fresh.filter((subject) => subject.sketch);
  const full = fresh.filter((subject) => !subject.sketch);
  const w3 = [];
  if (sketches.length < key.min_sketches) w3.push(`${sketches.length} sketches (want ${key.min_sketches})`);
  if (full.length < key.min_full_documents) w3.push(`${full.length} full documents (want ${key.min_full_documents})`);
  record('W3', w3);

  record('W4', newErrorsOf(after, baseline).map((error) => `${error.file}: ${error.code} ${error.message}`));

  // W5: every new place is inside the subtree of the lake (its location is the lake or a new place of the subtree).
  const newPlaces = fresh.filter((subject) => subject.kind === 'place');
  const subtree = lakeClosure(newPlaces, key.lake_id);
  const w5 = [];
  if (newPlaces.length < key.min_new_places) w5.push(`${newPlaces.length} new places (want ${key.min_new_places})`);
  for (const place of newPlaces) {
    if (!subtree.has(place.id)) w5.push(`${place.id} is not in the ${key.lake_id} subtree (location ${JSON.stringify(place.location)})`);
  }
  record('W5', w5);

  // W6: a new faction with at least the given number of member-of relations.
  const factions = fresh.filter((subject) => subject.kind === 'faction');
  const membersOf = (faction) =>
    new Set(after.relations.filter((relation) => relation.type === 'member-of' && relation.to === faction.id).map((relation) => relation.from)).size;
  record(
    'W6',
    factions.some((faction) => membersOf(faction) >= key.min_faction_members)
      ? []
      : [`no new faction with ${key.min_faction_members} member-of relations (${factions.map((f) => `${f.id}: ${membersOf(f)}`).join(', ') || 'no faction'})`],
  );

  // W7: a new character located at a new lake village has a last word ending in the suffix (family names).
  const villageIds = new Set([...subtree].filter((id) => id !== key.lake_id));
  const suffix = foldForm(key.surname_suffix);
  const checkable = fresh.filter((subject) => subject.kind === 'character' && subject.location.some((id) => villageIds.has(id)));
  const w7 = [];
  if (checkable.length < key.min_checkable_characters) {
    w7.push(`${checkable.length} new characters at new lake villages (want ${key.min_checkable_characters})`);
  }
  for (const character of checkable) {
    const last = lastWordOf(character);
    if (!last.endsWith(suffix)) w7.push(`${character.id}: last word «${last}» does not end in -${suffix}`);
  }
  record('W7', w7);

  // W8: the seed changed and still holds its master block.
  const w8 = [];
  if (seedAfter === seedBefore) w8.push('the seed did not change');
  if (!/<!-- master -->/.test(seedAfter) || !/<!-- \/master -->/.test(seedAfter)) w8.push('the seed has no master block');
  record('W8', w8);

  record('W9', versionReasons({ dir, versions, setupVersions }));

  // W10: the final message names a created subject and says it is invented.
  const w10 = [];
  if (report === null || report === undefined) {
    w10.push('no final message');
  } else {
    const text = report.replace(/[’‘]/g, "'").toLowerCase();
    const named = fresh.some((subject) => text.includes((subject.title ?? subject.id).replace(/[’‘]/g, "'").toLowerCase()));
    if (!named) w10.push('the final message names no created subject');
    if (!text.includes('inventat')) w10.push('the final message does not say that the content is invented («inventat»)');
  }
  record('W10', w10);

  return finish({ newSubjects: fresh.map((subject) => subject.id), newFiles: fresh.map((subject) => subject.file) });
}

/**
 * The creature checks C1 to C6. The sheet is an enemy (creature) or a character (npc, vendor): the statistics
 * tables are the same for all of them, so C2, C3 and C6 run on the sheet whatever the accepted pair is.
 * The adapter is loaded from the framework (adapterId) and the sheet is checked with its validateSheet
 * (the same checks as the engine's). Returns the same shape as gradeRegion.
 */
export async function gradeCreature({ key, adapterId, lang, baseline, after, dir, versions, setupVersions, report }) {
  const { record, finish } = checkBook();
  const fresh = newSubjectsOf(after, baseline);
  const subject = fresh.length === 1 ? fresh[0] : null;
  let text = null;
  if (subject !== null) {
    try {
      text = fs.readFileSync(path.join(dir, subject.file), 'utf8');
    } catch {
      text = null;
    }
  }

  // C1: one new document, whose kind and template form an accepted pair.
  const c1 = [];
  if (fresh.length !== 1) c1.push(`${fresh.length} new documents (want 1)`);
  if (subject !== null) {
    const template = text === null ? null : parseFrontmatter(text).data?.template;
    const pair = key.accepted.some((item) => item.kind === subject.kind && item.template === template);
    if (!pair) {
      const wanted = key.accepted.map((item) => `${item.kind} with ${item.template}`).join(' or ');
      c1.push(`kind ${subject.kind} with template ${JSON.stringify(template ?? null)} (want ${wanted})`);
    }
  }
  record('C1', c1);

  // C2: the sheet passes the adapter's validation (shape and arithmetic), and the adapter loads.
  // validateSheet takes the statistics branch for every sheet except template creature (no statistics).
  const c2 = [];
  let adapter = null;
  const loaded = loadAdapter(PLUGIN_DIR, adapterId);
  if (!loaded.ok || loaded.adapter === null) {
    c2.push(...loaded.errors.map((error) => `adapter: ${error.message}`));
  } else {
    adapter = loaded.adapter;
    if (subject === null || text === null) {
      c2.push('no new document to check');
    } else {
      const sheet = await validateSheet(adapter, 'creature', text, lang);
      c2.push(...sheet.errors.map((error) => `${error.code}: ${error.message}`));
    }
  }
  record('C2', c2);

  // C3: the characteristics table has every ability score with its modifier.
  const c3 = adapter !== null && text !== null ? abilityProblems(text, adapter, lang, key.abilities) : ['no sheet to check'];
  record('C3', c3);

  // C4: the sheet lives where the request said.
  record('C4', subject !== null && subject.location.includes(key.location) ? [] : [`location is ${JSON.stringify(subject?.location ?? null)} (want ${key.location})`]);

  // C5: one saved version more than the setup.
  record('C5', versionReasons({ dir, versions, setupVersions }));

  // C6: the actions table under Statistics has at least one row.
  const c6 = adapter !== null && text !== null ? actionProblems(text, adapter, lang) : ['no sheet to check'];
  record('C6', c6);

  return finish({ newSubjects: fresh.map((item) => item.id), newFiles: subject === null ? [] : [subject.file] });
}

/** True when the folded text holds the folded word as a whole word (no letter or digit on either side). */
export function containsWord(foldedText, foldedWord) {
  if (foldedWord === '') return false;
  const escaped = foldedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(foldedText);
}

/** The master block of a campaign document: from the first master marker to the end, or '' when there is none. */
function masterBlockOf(markdown) {
  const index = markdown.indexOf(MASTER_MARKER);
  return index < 0 ? '' : markdown.slice(index);
}

/**
 * The item checks I1 to I6 (an item whose real purpose is hidden: the public part stays clean, the master
 * block keeps the secret). The sheet is read from the copy; words are compared folded, as whole words.
 * Returns the same shape as gradeRegion.
 */
export function gradeItem({ key, baseline, after, dir, versions, setupVersions }) {
  const { record, finish } = checkBook();
  const fresh = newSubjectsOf(after, baseline);
  const subject = fresh.length === 1 ? fresh[0] : null;
  let text = null;
  if (subject !== null) {
    try {
      text = fs.readFileSync(path.join(dir, subject.file), 'utf8');
    } catch {
      text = null;
    }
  }
  const missing = text === null ? ['no new document to check'] : null;

  // I1: one new document, an item with the item template.
  const i1 = [];
  if (fresh.length !== 1) i1.push(`${fresh.length} new documents (want 1)`);
  if (subject !== null) {
    if (subject.kind !== key.kind) i1.push(`kind is ${subject.kind} (want ${key.kind})`);
    const template = text === null ? null : parseFrontmatter(text).data?.template;
    if (template !== key.template) i1.push(`template is ${JSON.stringify(template ?? null)} (want ${key.template})`);
  }
  record('I1', i1);

  // I2: the public part holds none of the forbidden words.
  const publicPart = text === null ? '' : publicBody(text);
  const foldedPublic = foldForm(publicPart);
  record(
    'I2',
    missing ?? key.forbidden_public.filter((word) => containsWord(foldedPublic, foldForm(word))).map((word) => `the public part contains «${word}»`),
  );

  // I3: the master block holds at least one of the secret words.
  const master = text === null ? '' : masterBlockOf(text);
  const foldedMaster = foldForm(master);
  let i3 = missing;
  if (i3 === null && master === '') i3 = ['no master block'];
  if (i3 === null && !key.secret_words.some((word) => containsWord(foldedMaster, foldForm(word)))) {
    i3 = [`the master block names none of ${key.secret_words.join(', ')}`];
  }
  record('I3', i3 ?? []);

  // I4: the item type is the one the request asked for.
  const itemType = text === null ? null : parseFrontmatter(text).data?.item_type;
  record('I4', missing ?? (itemType === key.item_type ? [] : [`item_type is ${JSON.stringify(itemType ?? null)} (want ${key.item_type})`]));

  // I5: the public part has no finding section (the place where it was found is part of the secret).
  record(
    'I5',
    missing ?? (/^##[ \t]+(Ritrovamento|Finding)[ \t]*$/m.test(publicPart) ? ['the public part has a Ritrovamento / Finding section'] : []),
  );

  // I6: one saved version more than the setup.
  record('I6', versionReasons({ dir, versions, setupVersions }));

  return finish({ newSubjects: fresh.map((item) => item.id), newFiles: subject === null ? [] : [subject.file] });
}

/** Grades the copy after the run, for any case. Returns the graded result with the new files. */
async function gradeWorld({ caseData, dir, setup, report }) {
  const after = buildWorldIndex(dir);
  const versions = listVersions(dir).length;
  if (caseData.kind === 'item') {
    return gradeItem({ key: caseData.key, baseline: setup.baseline, after, dir, versions, setupVersions: setup.versions });
  }
  if (caseData.kind === 'region') {
    return gradeRegion({
      key: caseData.key,
      baseline: setup.baseline,
      after,
      seedBefore: setup.seedBefore,
      seedAfter: readSeed(dir),
      dir,
      versions,
      setupVersions: setup.versions,
      report,
    });
  }
  return gradeCreature({
    key: caseData.key,
    adapterId: caseData.system_adapter,
    lang: campaignLanguage(dir),
    baseline: setup.baseline,
    after,
    dir,
    versions,
    setupVersions: setup.versions,
    report,
  });
}

/** Adds one check to a graded result, with its failure reasons, and recomputes pass. */
export function addCheck(graded, id, ok, reasons) {
  const checks = { ...graded.checks, [id]: ok === true };
  const failures = ok ? graded.failures : [...graded.failures, `${id} ${reasons.join('; ')}`];
  return { ...graded, checks, failures, pass: Object.values(checks).every(Boolean) };
}

/**
 * Grades one run: the world checks, then the Q-grid when judge is on, then the limits. agent is the
 * run result (report, duration_ms, tool_calls). Returns { graded, quality }.
 */
async function evaluate({ caseData, dir, setup, agent, judge, judgeModel }) {
  let graded = await gradeWorld({ caseData, dir, setup, report: agent.report ?? null });
  let quality = null;
  if (judge) {
    if (graded.newFiles.length > 0) {
      const documents = graded.newFiles.map((rel) => ({ path: rel, text: fs.readFileSync(path.join(dir, rel), 'utf8') }));
      quality = runQualityJudge({ cwd: dir, seed: readSeed(dir), documents, model: judgeModel });
    }
    const grid = qualityCheck(quality, caseData.qualityMin);
    graded = addCheck(graded, 'Q-grid', grid.ok, grid.reasons);
  }
  graded = applyLimits(graded, caseData.limits, agent);
  return { graded, quality };
}

// ---------------------------------------------------------------- records

/** Builds the JSONL record of one run. */
function makeRecord({ caseName, run, date, header, hash, delegation, agent, agentFailure, graded, quality, judgeModel, copy, gradeOnly, limits }) {
  const record = {
    case: caseName,
    run,
    date,
    ...header,
    instructions_hash: hash,
    permission_mode: agent?.permission_mode ?? null,
    delegation,
    pass: graded.pass && !agentFailure,
    checks: graded.checks,
    failures: [...(agentFailure ? [`agent error: ${agentFailure}`] : []), ...graded.failures],
    new_subjects: graded.newSubjects,
    report: agent?.report ?? null,
    turn1_report: agent?.turn1_report ?? null,
    cost_usd: agent?.cost_usd ?? null,
    duration_ms: agent?.duration_ms ?? null,
    num_turns: agent?.num_turns ?? null,
    denied: agent?.denied ?? [],
    tool_calls: agent?.tool_calls ?? null,
    limits: limits ?? null,
    quality: quality
      ? {
          model: judgeModel,
          ok: quality.ok,
          mean: quality.mean,
          scores: quality.scores,
          notes: quality.notes,
          error: quality.error,
          cost_usd: quality.cost_usd,
        }
      : null,
  };
  if (copy !== undefined) record.copy = copy;
  if (gradeOnly) record.grade_only = true;
  return record;
}

/** The record without the long report text, for the console. */
function consoleView(record) {
  const { report, ...rest } = record;
  return rest;
}

/** The files that define the process under test (the same set as the other runners). */
function instructionFiles() {
  const yllir = PLUGIN_DIR;
  const files = ['skills', 'agents', 'templates', 'hooks'].flatMap((dir) => listFiles(path.join(yllir, dir)));
  files.push(...listFiles(path.join(yllir, 'scripts'), { scriptsOnly: true }));
  return [...new Set(files)].filter((file) => !path.basename(file).startsWith('.'));
}

// ---------------------------------------------------------------- turns

/**
 * True when the case has a reply and the copy has no new saved version after the first turn. The
 * versions are counted the same way the C5 and I6 checks count them (saved versions, not the setup).
 */
export function needsReplyTurn(caseData, versionsBefore, versionsAfter) {
  return caseData.reply !== undefined && versionsAfter <= versionsBefore;
}

/**
 * Combines the result of two turns of one run, as runAgentTurns in the entry runner does: cost, duration,
 * turns and tool calls are summed (null when either side is null), denied is concatenated, report is the
 * second report and turn1_report the first one.
 */
export function combineTurns(first, second) {
  const sum = (a, b) => (a === null || b === null ? null : a + b);
  return {
    ok: second.ok,
    report: second.report,
    cost_usd: sum(first.cost_usd, second.cost_usd),
    duration_ms: sum(first.duration_ms, second.duration_ms),
    num_turns: sum(first.num_turns, second.num_turns),
    denied: [...first.denied, ...second.denied],
    tool_calls: sum(first.tool_calls, second.tool_calls),
    error: second.ok ? null : second.error,
    permission_mode: first.permission_mode,
    turn1_report: first.report,
  };
}

/**
 * Runs the first agent turn in dir. When needsReplyTurn says so, runs the reply in the same folder
 * (--continue) and returns the combined result; otherwise the first result with turn1_report null.
 */
function runAgentTurns({ caseData, dir, model, agentName, pluginDir, versionsBefore }) {
  const common = { agent: agentName, cwd: dir, model, timeoutMs: AGENT_TIMEOUT_MS, pluginDir };
  const first = runAgent({ ...common, prompt: caseData.prompt });
  if (!first.ok || !needsReplyTurn(caseData, versionsBefore, listVersions(dir).length)) {
    return { ...first, turn1_report: null };
  }
  const second = runAgent({ ...common, prompt: caseData.reply, continueConversation: true });
  return combineTurns(first, second);
}

// ---------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const setupOnly = argv.includes('--setup-only');
  const judge = argv.includes('--judge');
  const opts = parseCommonArgs(
    argv.filter((arg) => arg !== '--setup-only' && arg !== '--judge'),
    USAGE,
    { valueOptions: ['--grade-only', '--run-json', '--delegation', '--judge-model'] },
  );
  const caseData = loadWorldCase(opts.caseDir);
  const delegation = parseDelegation(opts.values['--delegation'] ?? DEFAULT_DELEGATION);
  const judgeModel = opts.values['--judge-model'] ?? DEFAULT_JUDGE_MODEL;
  if (judge) {
    assertDistinctJudge(opts.model, judgeModel);
  } else if (opts.values['--judge-model'] !== undefined) {
    throw new Error(`--judge-model needs --judge\n${USAGE}`);
  }
  const hash = instructionsHash(instructionFiles());
  const header = recordHeader({ agent: opts.agent, modelLabel: opts.modelLabel });

  if (setupOnly) {
    const setup = setupWorldCase(caseData);
    console.log(`dir: ${setup.dir}`);
    console.log(`versions: ${setup.versions}`);
    console.log(`baseline subjects: ${setup.baseline.ids.length}, world errors: ${setup.baseline.errors.length}`);
    console.log(`seed: ${seedFileOf(setup.dir)}`);
    return;
  }

  const gradeOnly = opts.values['--grade-only'];
  if (gradeOnly !== undefined) {
    const runJson = opts.values['--run-json'];
    if (runJson === undefined) throw new Error(`--grade-only needs --run-json <file>\n${USAGE}`);
    const dir = path.resolve(gradeOnly);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`--grade-only: ${dir} is not a folder`);
    const saved = JSON.parse(fs.readFileSync(path.resolve(runJson), 'utf8'));
    if (saved.setup === undefined) throw new Error('--run-json has no setup: keep the run with --keep');
    const setup = { baseline: saved.setup.baseline, seedBefore: saved.setup.seed_before, versions: saved.setup.versions };
    const agent = { ...saved, report: saved.report ?? null };
    const { graded, quality } = await evaluate({ caseData, dir, setup, agent, judge, judgeModel });
    const record = makeRecord({
      caseName: caseData.case,
      run: 1,
      date: new Date().toISOString(),
      header,
      hash,
      delegation: saved.delegation ?? null,
      agent: saved.report === null ? null : agent,
      agentFailure: saved.error ?? null,
      graded,
      quality,
      judgeModel,
      copy: dir,
      gradeOnly: true,
      limits: caseData.limits,
    });
    console.log(JSON.stringify(consoleView(record)));
    process.exitCode = printSummary([record], opts.modelLabel, hash, opts.agent) === 1 ? 0 : 1;
    return;
  }

  const summaries = [];
  for (let i = 1; i <= opts.runs; i++) {
    const date = new Date().toISOString();
    const setup = setupWorldCase(caseData);
    const variant = buildPluginVariant({ mode: delegation, sourceDir: PLUGIN_DIR });
    let record;
    try {
      const agent = runAgentTurns({
        caseData,
        dir: setup.dir,
        model: opts.model,
        agentName: opts.agent,
        pluginDir: variant.pluginDir,
        versionsBefore: setup.versions,
      });
      const { graded, quality } = await evaluate({ caseData, dir: setup.dir, setup, agent, judge, judgeModel });
      record = makeRecord({
        caseName: caseData.case,
        run: i,
        date,
        header,
        hash,
        delegation,
        agent,
        agentFailure: agent.ok ? null : agent.error,
        graded,
        quality,
        judgeModel,
        copy: opts.keep ? setup.dir : undefined,
        limits: caseData.limits,
      });
      if (opts.keep) {
        fs.writeFileSync(
          `${setup.dir}.run.json`,
          JSON.stringify({
            report: agent.report,
            cost_usd: agent.cost_usd,
            duration_ms: agent.duration_ms,
            num_turns: agent.num_turns,
            denied: agent.denied,
            tool_calls: agent.tool_calls,
            error: agent.ok ? null : agent.error,
            permission_mode: agent.permission_mode,
            delegation,
            setup: { baseline: setup.baseline, seed_before: setup.seedBefore, versions: setup.versions },
          }),
        );
      }
    } finally {
      variant.cleanup();
      if (opts.keep) console.log(`kept run ${i}: ${setup.dir}`);
      else fs.rmSync(setup.tmp, { recursive: true, force: true });
    }
    appendResult(caseData.case, record);
    console.log(JSON.stringify(consoleView(record)));
    summaries.push(record);
  }

  const passed = printSummary(summaries, opts.modelLabel, hash, opts.agent);
  process.exitCode = passed === summaries.length ? 0 : 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`run-world-case: ${err.message}`);
    process.exitCode = 2;
  });
}
