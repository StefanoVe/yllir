// Resumable inventory and verification of the characters and enemies (npc, vendor, enemy sheets)
// for combat-statistics-v1. The model writes drafts; scripts only inventory the sheets, protect
// source hashes, metadata and master-only blocks, the text outside the Statistics section, the
// statistics tables, and the rolled amounts (dice only, through the adapter's fixRolls).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readStructure, listCanonicalSheets, compareStrings } from '../../../../../scripts/lib/subjects.mjs';
import { findMetadataBlock, parseFrontmatter, toCommentMetadata } from '../../../../../scripts/lib/frontmatter.mjs';
import { MASTER_MARKER } from '../../../../../scripts/lib/public-text.mjs';
import { loadRollFix } from '../../../../../scripts/lib/adapter-ops.mjs';
import { loadAdapter, pluginRootFromHere } from '../../../../../scripts/lib/adapter.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { actionRowCount, findStatisticsSections, validateStatisticsTables } from '../../../../../scripts/lib/statistics-tables.mjs';

const DRAFT = '.campaign/state/write/draft';
const STATE = '.campaign/state/update/combat-statistics.json';
const TEMPLATES = new Set(['npc', 'vendor', 'enemy']);
const PLACEHOLDER_RE = /^(?:da definire\.|to be defined\.)$/i;

const hash = (s) => createHash('sha256').update(s).digest('hex');
// Source fingerprint: the same for both metadata forms, so converting the block is not an edit.
const sourceHash = (text) => hash(toCommentMetadata(text) ?? text);
const stripCr = (raw) => (raw.endsWith('\r') ? raw.slice(0, -1) : raw);

/** The metadata block text, delimiters included (the whole text when the block is not closed). */
function metadataText(text) {
  const lines = text.split('\n');
  const block = findMetadataBlock(lines.map(stripCr));
  if (!block) return '';
  if (block.close < 0) return text;
  return lines.slice(0, block.close + 1).join('\n');
}

/** Everything from the master marker to the end of the file ('' when there is none). */
function masterPart(text) {
  const index = text.indexOf(MASTER_MARKER);
  return index < 0 ? '' : text.slice(index);
}

function readConfig(root) {
  try {
    return parseYamlLite(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8')).data ?? null;
  } catch {
    return null;
  }
}

function langOf(config) {
  return typeof config?.language?.main === 'string' ? config.language.main : 'en';
}

/** The adapter's fixRolls, or null when no game-rules adapter loads (as in the engine). */
async function rollFixOf(config) {
  const adapterId = config?.system?.adapter;
  if (typeof adapterId !== 'string' || adapterId === '' || adapterId === 'none') return null;
  const loaded = loadAdapter(pluginRootFromHere(), adapterId);
  if (!loaded.ok || !loaded.adapter) return null;
  return (await loadRollFix(loaded.adapter)) ?? null;
}

/** A sheet whose template is npc, vendor or enemy and which is not a sketch. */
function isCandidate(text) {
  const { data } = parseFrontmatter(text);
  if (data === null || !TEMPLATES.has(data.template)) return false;
  return !(data.sketch === true || data.sketch === 'true');
}

/** Candidate sheets of every subjects category, relative paths sorted. */
function candidateFiles(root, structure) {
  const found = new Set();
  for (const category of structure) {
    if (category.type !== 'subjects' || typeof category.folder !== 'string') continue;
    for (const rel of listCanonicalSheets(root, category.folder)) found.add(rel);
  }
  return [...found].sort(compareStrings);
}

/**
 * What a sheet still needs: rolls still written as a precomputed result (in its Statistics
 * sections), and whether the first Statistics section has no combat action.
 * @returns {{ rolls: number, needsActions: boolean }}
 */
function problems(text, lang, rollFix) {
  const ranges = findStatisticsSections(text, lang);
  const rolls = typeof rollFix === 'function'
    ? ranges.reduce((sum, range) => sum + rollFix(text.slice(range.start, range.end)).count, 0)
    : 0;
  const needsActions = ranges.length === 0 || actionRowCount(text.slice(ranges[0].start, ranges[0].end), lang) === 0;
  return { rolls, needsActions };
}

/** The text with every Statistics section rewritten by the adapter's fixRolls (dice only). */
function applyRollFix(text, lang, rollFix) {
  if (typeof rollFix !== 'function') return text;
  let out = text;
  // From the last range to the first, so the offsets of the earlier ranges stay right.
  for (const range of [...findStatisticsSections(text, lang)].reverse()) {
    out = out.slice(0, range.start) + rollFix(out.slice(range.start, range.end)).text + out.slice(range.end);
  }
  return out;
}

/**
 * The text outside the Statistics sections: each section and its heading line removed, runs of
 * blank lines collapsed to one, trimmed.
 */
function outside(text, lang) {
  let out = text;
  for (const range of [...findStatisticsSections(text, lang)].reverse()) {
    const before = text.slice(0, range.start).replace(/\r?\n$/, '');
    const headingStart = before.lastIndexOf('\n') + 1;
    out = out.slice(0, headingStart) + out.slice(range.end);
  }
  return out.replace(/\n([ \t]*\r?\n){2,}/g, '\n\n').trim();
}

/** The nonblank lines of every Statistics section (trimmed), placeholders left out. */
function statisticsLines(text, lang) {
  const lines = [];
  for (const range of findStatisticsSections(text, lang)) {
    for (const line of text.slice(range.start, range.end).split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || PLACEHOLDER_RE.test(trimmed)) continue;
      lines.push(trimmed);
    }
  }
  return lines;
}

function formatProblems(found) {
  return { rolls: found.rolls, needs_actions: found.needsActions };
}

function safeDraftPath(root, file) {
  const base = path.resolve(root, DRAFT);
  const dest = path.resolve(base, file);
  return dest.startsWith(`${base}${path.sep}`) ? dest : null;
}

/**
 * Inventories the sheets that must be rewritten: every candidate sheet with rolls or without a
 * combat action, and every sheet already in the saved state (kept, so its progress is not lost).
 * A sheet with rolls gets an automatic draft with its rolls fixed (when persist is true).
 * @returns {Promise<{ status: 'complete'|'pending'|'failed', sheets: object[], errors: object[] }>}
 */
export async function prepareCombatStatistics(root, { persist = true } = {}) {
  root = path.resolve(root);
  const { structure, errors: structureErrors } = readStructure(root);
  if (!structure) return { status: 'failed', sheets: [], errors: structureErrors };
  const errors = [...structureErrors];
  const config = readConfig(root);
  const lang = langOf(config);
  const rollFix = await rollFixOf(config);

  const current = new Map();
  for (const file of candidateFiles(root, structure)) {
    try {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      if (!isCandidate(text)) continue;
      current.set(file, { text, source: sourceHash(text), ...problems(text, lang, rollFix) });
    } catch (e) {
      errors.push({ file, message: e.message });
    }
  }

  const previous = new Map(readState(root).sheets.map((record) => [record.file, record]));
  const sheets = [];
  for (const [file, now] of current) {
    const old = previous.get(file);
    const needed = now.rolls > 0 || now.needsActions;
    if (!old) {
      if (!needed) continue;
      const record = { file, source: now.source, status: 'pending', rolls: now.rolls, needs_actions: now.needsActions };
      if (now.rolls > 0 && persist) {
        const fixed = applyRollFix(now.text, lang, rollFix);
        const dest = safeDraftPath(root, file);
        if (dest) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, fixed, 'utf8');
          record.draft = hash(fixed);
          record.auto_draft = true;
        }
      }
      sheets.push(record);
      continue;
    }
    if (old.status === 'complete' && old.source === now.source) sheets.push({ ...old });
    else if (old.source !== now.source) sheets.push({ file, source: old.source, status: 'changed', current_source: now.source });
    else sheets.push({ ...old, status: 'pending', ...formatProblems(now) });
  }

  if (persist) writeState(root, { sheets });
  const status = errors.length > 0 ? 'failed' : sheets.some((x) => x.status !== 'complete') ? 'pending' : 'complete';
  return { status, sheets, errors };
}

/**
 * Stores the draft of one pending sheet under .campaign/state/write/draft/<file>.
 * Refused when the sheet is not pending, its source changed, or its metadata block differs.
 */
export async function stageCombatDraft(root, file, content) {
  root = path.resolve(root);
  const state = readState(root);
  const record = state.sheets.find((x) => x.file === file);
  let original;
  try {
    original = fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return { status: 'failed', errors: [{ code: 'source-changed', file }] };
  }
  if (!record || record.status !== 'pending' || sourceHash(original) !== record.source) {
    return { status: 'failed', errors: [{ code: 'source-changed', file }] };
  }
  if (metadataText(original) !== metadataText(content)) return { status: 'failed', errors: [{ code: 'head-changed', file }] };
  const dest = safeDraftPath(root, file);
  if (!dest) return { status: 'failed', errors: [{ code: 'unsafe-path', file }] };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf8');
  record.draft = hash(content);
  delete record.draft_verified;
  delete record.auto_draft;
  writeState(root, state);
  return { status: 'staged', file, source: record.source, draft: record.draft };
}

/**
 * Checks each staged draft against its source: source hash, metadata block, master-only block,
 * no rolled amount left, a combat action present, the statistics tables, the text outside the
 * Statistics sections unchanged, and no line of the Statistics sections lost.
 * @returns {Promise<{ status: 'verified'|'failed', errors: Array<{ code: string, file: string, detail?: unknown }> }>}
 */
export async function verifyCombatDrafts(root, files) {
  root = path.resolve(root);
  const state = readState(root);
  const config = readConfig(root);
  const lang = langOf(config);
  const rollFix = await rollFixOf(config);
  const errors = [];
  for (const file of files) {
    const record = state.sheets.find((x) => x.file === file);
    let before, after;
    try {
      before = fs.readFileSync(path.join(root, file), 'utf8');
      after = fs.readFileSync(path.resolve(root, DRAFT, file), 'utf8');
    } catch (e) {
      errors.push({ code: 'draft-unavailable', file, detail: e.message });
      continue;
    }
    if (!record || sourceHash(before) !== record.source) {
      errors.push({ code: 'source-changed', file });
      continue;
    }
    const found = problems(after, lang, rollFix);
    if (found.rolls > 0) errors.push({ code: 'rolls-remain', file, detail: found.rolls });
    if (found.needsActions) errors.push({ code: 'actions-missing', file });
    const ranges = findStatisticsSections(after, lang);
    if (ranges.length > 0) {
      const tables = validateStatisticsTables(after.slice(ranges[0].start, ranges[0].end), lang);
      if (!tables.ok) errors.push({ code: 'statistics-table', file, detail: tables.reason });
    }
    const fixedBefore = applyRollFix(before, lang, rollFix);
    if (outside(fixedBefore, lang) !== outside(after, lang)) errors.push({ code: 'outside-changed', file });
    const kept = new Set(statisticsLines(after, lang));
    for (const line of statisticsLines(fixedBefore, lang)) {
      if (!kept.has(line)) errors.push({ code: 'statistics-lost', file, detail: line });
    }
    if (metadataText(before) !== metadataText(after)) errors.push({ code: 'head-changed', file });
    if (masterPart(before) !== masterPart(after)) errors.push({ code: 'master-block-changed', file });
  }
  if (errors.length === 0) {
    for (const file of files) {
      const record = state.sheets.find((x) => x.file === file);
      const after = fs.readFileSync(path.resolve(root, DRAFT, file), 'utf8');
      record.draft = hash(after);
      record.draft_verified = true;
    }
    writeState(root, state);
  }
  return { status: errors.length > 0 ? 'failed' : 'verified', errors };
}

/**
 * Completes the sheets whose published bytes equal their verified draft and that have no problem left.
 * @returns {Promise<{ status: 'complete'|'pending', sheets: object[], errors: object[] }>}
 */
export async function completeCombatSheets(root, files = []) {
  root = path.resolve(root);
  const state = readState(root);
  const config = readConfig(root);
  const lang = langOf(config);
  const rollFix = await rollFixOf(config);
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) return { status: 'pending', sheets: state.sheets, errors: [{ code: 'unverified-publication', file }] };
    const text = fs.readFileSync(full, 'utf8');
    const record = state.sheets.find((x) => x.file === file);
    const found = problems(text, lang, rollFix);
    const clean = found.rolls === 0 && !found.needsActions;
    if (!record?.draft_verified || !record.draft || hash(text) !== record.draft || !clean) {
      return { status: 'pending', sheets: state.sheets, errors: [{ code: 'unverified-publication', file }] };
    }
    record.source = sourceHash(text);
    record.status = 'complete';
    delete record.rolls;
    delete record.needs_actions;
  }
  writeState(root, state);
  const remaining = state.sheets.filter((x) => x.status !== 'complete');
  return { status: remaining.length > 0 ? 'pending' : 'complete', sheets: state.sheets, errors: [] };
}

/**
 * Reopens a sheet that the master changed during the update (status changed) as pending, after the
 * agent has reread it. Its draft is dropped; its rolls and combat actions are recomputed.
 * @returns {Promise<{ status: 'pending'|'failed', file?: string, source?: string, rolls?: number, needs_actions?: boolean, errors: object[] }>}
 */
export async function refreshChangedSheet(root, file) {
  root = path.resolve(root);
  const state = readState(root);
  const record = state.sheets.find((x) => x.file === file);
  if (!record || record.status !== 'changed') return { status: 'failed', errors: [{ code: 'sheet-not-changed', file }] };
  const full = path.resolve(root, file);
  if (!full.startsWith(`${root}${path.sep}`) || !fs.existsSync(full)) return { status: 'failed', errors: [{ code: 'source-unavailable', file }] };
  const current = fs.readFileSync(full, 'utf8');
  if (sourceHash(current) !== record.current_source) return { status: 'failed', errors: [{ code: 'source-changed-again', file }] };
  const config = readConfig(root);
  const rollFix = await rollFixOf(config);
  const draft = safeDraftPath(root, file);
  if (draft) fs.rmSync(draft, { force: true });
  const found = problems(current, langOf(config), rollFix);
  record.source = record.current_source;
  record.status = 'pending';
  Object.assign(record, formatProblems(found));
  delete record.current_source;
  delete record.draft;
  delete record.draft_verified;
  delete record.auto_draft;
  writeState(root, state);
  return { status: 'pending', file, source: record.source, rolls: found.rolls, needs_actions: found.needsActions, errors: [] };
}

function readState(root) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, STATE), 'utf8'));
    return { sheets: Array.isArray(value.sheets) ? value.sheets : [] };
  } catch {
    return { sheets: [] };
  }
}

function writeState(root, value) {
  const f = path.join(root, STATE);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(value, null, 2)}\n`);
}
