// Resumable inventory and verification of the plot event files (scenes) for scene-checks-v1.
// The model writes drafts; scripts only inventory scenes, protect source hashes, metadata and
// master-only blocks, outcome text, and the checks of the new form (checkScene).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readStructure } from '../../../../../scripts/lib/subjects.mjs';
import { findMetadataBlock, toCommentMetadata } from '../../../../../scripts/lib/frontmatter.mjs';
import { MASTER_MARKER, publicBody } from '../../../../../scripts/lib/public-text.mjs';
import { checkScene } from '../../../../../scripts/lib/plot/scene-checks.mjs';
import { loadSceneValueCheck } from '../../../../../scripts/lib/adapter-ops.mjs';
import { loadAdapter, pluginRootFromHere } from '../../../../../scripts/lib/adapter.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';

const DRAFT = '.campaign/state/write/draft';
const STATE = '.campaign/state/update/scene-checks.json';
const OUTCOME_RE = /^\s*[-*]\s+\*{0,2}(Successo|Fallimento|Success|Failure)\*{0,2}\s*:\s*\*{0,2}\s*(.*)$/iu;

const hash = (s) => createHash('sha256').update(s).digest('hex');
// Source fingerprint: the same for both metadata forms, so converting the block is not an edit.
const sourceHash = (text) => hash(toCommentMetadata(text) ?? text);
const stripCr = (raw) => (raw.endsWith('\r') ? raw.slice(0, -1) : raw);
const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ');
const outcomeKey = (s) => normalize(s).replace(/[\s.,;:!?…]+$/u, '').trim();

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

/** Outcome texts of the old list form in the public body that the draft no longer contains. */
function lostOutcomes(source, draft) {
  const haystack = normalize(draft);
  const missing = [];
  for (const line of publicBody(source).split('\n')) {
    const match = OUTCOME_RE.exec(stripCr(line));
    if (!match) continue;
    const key = outcomeKey(match[2]);
    if (key !== '' && !haystack.includes(key)) missing.push(key);
  }
  return missing;
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

/** The adapter's check of check values, or undefined when no game-rules adapter loads (as in the engine). */
async function sceneValueCheck(config) {
  const adapterId = config?.system?.adapter;
  if (typeof adapterId !== 'string' || adapterId === '' || adapterId === 'none') return undefined;
  const loaded = loadAdapter(pluginRootFromHere(), adapterId);
  if (!loaded.ok || !loaded.adapter) return undefined;
  return (await loadSceneValueCheck(loaded.adapter)) ?? undefined;
}

function entries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
    throw err;
  }
}

/** Event files: <plot folder>/<Session>/Eventi/*.md and <plot folder>/<Session>/Events/*.md, no symlinks. */
function eventFiles(root, structure) {
  const found = new Set();
  for (const category of structure.filter((c) => c.type === 'plot' && typeof c.folder === 'string')) {
    const plotDir = path.join(root, category.folder);
    for (const session of entries(plotDir)) {
      if (!session.isDirectory()) continue;
      for (const sub of ['Eventi', 'Events']) {
        const subDir = path.join(plotDir, session.name, sub);
        for (const entry of entries(subDir)) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          found.add(path.relative(root, path.join(subDir, entry.name)).split(path.sep).join('/'));
        }
      }
    }
  }
  return [...found].sort();
}

function formatErrors(errors) {
  return errors.map((error) => `line ${error.line} ${error.code}: ${error.message}`);
}

function safeDraftPath(root, file) {
  const base = path.resolve(root, DRAFT);
  const dest = path.resolve(base, file);
  return dest.startsWith(`${base}${path.sep}`) ? dest : null;
}

/**
 * Inventories the scenes that must be rewritten: every event file with checks errors, and every
 * scene already in the saved state (kept, so its progress is not lost).
 * @returns {Promise<{ status: 'complete'|'pending'|'failed', scenes: object[], errors: object[] }>}
 */
export async function prepareSceneChecks(root, { persist = true } = {}) {
  root = path.resolve(root);
  const { structure, errors: structureErrors } = readStructure(root);
  if (!structure) return { status: 'failed', scenes: [], errors: structureErrors };
  const errors = [...structureErrors];
  const config = readConfig(root);
  const lang = langOf(config);
  const checkValue = await sceneValueCheck(config);

  const current = new Map();
  for (const file of eventFiles(root, structure)) {
    try {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      current.set(file, { source: sourceHash(text), errors: checkScene(text, lang, { checkValue }) });
    } catch (e) {
      errors.push({ file, message: e.message });
    }
  }

  const previous = new Map(readState(root).scenes.map((record) => [record.file, record]));
  const scenes = [];
  for (const [file, now] of current) {
    const old = previous.get(file);
    if (!old) {
      if (now.errors.length > 0) scenes.push({ file, source: now.source, status: 'pending', errors: formatErrors(now.errors) });
      continue;
    }
    if (old.status === 'complete' && old.source === now.source) scenes.push({ ...old });
    else if (old.source !== now.source) scenes.push({ file, source: old.source, status: 'changed', current_source: now.source });
    else scenes.push({ ...old, status: 'pending', errors: formatErrors(now.errors) });
  }

  if (persist) writeState(root, { scenes });
  const status = errors.length > 0 ? 'failed' : scenes.some((x) => x.status !== 'complete') ? 'pending' : 'complete';
  return { status, scenes, errors };
}

/**
 * Stores the draft of one pending scene under .campaign/state/write/draft/<file>.
 * Refused when the scene is not pending, its source changed, or its metadata block differs.
 */
export async function stageSceneDraft(root, file, content) {
  root = path.resolve(root);
  const state = readState(root);
  const record = state.scenes.find((x) => x.file === file);
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
  writeState(root, state);
  return { status: 'staged', file, source: record.source, draft: record.draft };
}

/**
 * Checks each staged draft against its source: source hash, metadata block, master-only block,
 * the checks of the new form, and that no outcome text of the old list was lost.
 * @returns {Promise<{ status: 'verified'|'failed', errors: Array<{ code: string, file: string, detail?: unknown }> }>}
 */
export async function verifySceneDrafts(root, files) {
  root = path.resolve(root);
  const state = readState(root);
  const config = readConfig(root);
  const lang = langOf(config);
  const checkValue = await sceneValueCheck(config);
  const errors = [];
  for (const file of files) {
    const record = state.scenes.find((x) => x.file === file);
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
    if (metadataText(before) !== metadataText(after)) errors.push({ code: 'head-changed', file });
    if (masterPart(before) !== masterPart(after)) errors.push({ code: 'master-block-changed', file });
    const found = checkScene(after, lang, { checkValue });
    if (found.length > 0) errors.push({ code: 'scene-checks-remain', file, detail: found });
    for (const text of lostOutcomes(before, after)) errors.push({ code: 'outcome-text-lost', file, detail: text });
  }
  if (errors.length === 0) {
    for (const file of files) {
      const record = state.scenes.find((x) => x.file === file);
      const after = fs.readFileSync(path.resolve(root, DRAFT, file), 'utf8');
      record.draft = hash(after);
      record.draft_verified = true;
    }
    writeState(root, state);
  }
  return { status: errors.length > 0 ? 'failed' : 'verified', errors };
}

/**
 * Completes the scenes whose published bytes equal their verified draft and that pass checkScene.
 * @returns {Promise<{ status: 'complete'|'pending'|'failed', scenes?: object[], errors: object[] }>}
 */
export async function completeScenes(root, files = []) {
  root = path.resolve(root);
  const state = readState(root);
  const config = readConfig(root);
  const lang = langOf(config);
  const checkValue = await sceneValueCheck(config);
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) return { status: 'pending', errors: [{ code: 'unverified-publication', file }] };
    const text = fs.readFileSync(full, 'utf8');
    const record = state.scenes.find((x) => x.file === file);
    if (!record?.draft_verified || !record.draft || hash(text) !== record.draft || checkScene(text, lang, { checkValue }).length > 0) {
      return { status: 'pending', errors: [{ code: 'unverified-publication', file }] };
    }
    record.source = sourceHash(text);
    record.status = 'complete';
    delete record.errors;
  }
  writeState(root, state);
  const remaining = state.scenes.filter((x) => x.status !== 'complete');
  return { status: remaining.length > 0 ? 'pending' : 'complete', scenes: state.scenes, errors: [] };
}

/**
 * Reopens a scene that the master changed during the update (status changed) as pending, after the
 * agent has reread it. Its draft is dropped; its errors are recomputed from the current text.
 * @returns {Promise<{ status: 'pending'|'failed', file?: string, source?: string, errors: object[] }>}
 */
export async function refreshChangedScene(root, file) {
  root = path.resolve(root);
  const state = readState(root);
  const record = state.scenes.find((x) => x.file === file);
  if (!record || record.status !== 'changed') return { status: 'failed', errors: [{ code: 'scene-not-changed', file }] };
  const full = path.resolve(root, file);
  if (!full.startsWith(`${root}${path.sep}`) || !fs.existsSync(full)) return { status: 'failed', errors: [{ code: 'source-unavailable', file }] };
  const current = fs.readFileSync(full, 'utf8');
  if (sourceHash(current) !== record.current_source) return { status: 'failed', errors: [{ code: 'source-changed-again', file }] };
  const config = readConfig(root);
  const checkValue = await sceneValueCheck(config);
  const draft = safeDraftPath(root, file);
  if (draft) fs.rmSync(draft, { force: true });
  record.source = record.current_source;
  record.status = 'pending';
  record.errors = formatErrors(checkScene(current, langOf(config), { checkValue }));
  delete record.current_source;
  delete record.draft;
  delete record.draft_verified;
  writeState(root, state);
  return { status: 'pending', file, source: record.source, errors: [] };
}

function readState(root) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, STATE), 'utf8'));
    return { scenes: Array.isArray(value.scenes) ? value.scenes : [] };
  } catch {
    return { scenes: [] };
  }
}

function writeState(root, value) {
  const f = path.join(root, STATE);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(value, null, 2)}\n`);
}
