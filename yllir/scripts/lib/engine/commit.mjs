// Checks and commits one batch of campaign documents as one transaction. The
// agent writes drafts under .campaign/drafts/<campaign-relative path>, calls
// checkBatch, and after the model review calls commitBatch. Every change is made
// first on a temporary copy of the campaign (layout, links, plot maps, derived
// indexes), validated against the campaign as it was before the batch (only the
// errors the batch adds block it), then copied into the campaign and saved as one
// version. Deterministic: no model is called here.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSubjectIndex, compareStrings, readStructure } from '../subjects.mjs';
import { buildWorldIndex, writeWorldIndex } from '../world-graph.mjs';
import { planGeographicLayout, applyGeographicLayout } from '../geographic-layout.mjs';
import { validateConfig } from '../config.mjs';
import { loadAdapter, pluginRootFromHere } from '../adapter.mjs';
import { parseYamlLite } from '../yaml-lite.mjs';
import { findMetadataBlock, parseFrontmatter, toCommentMetadata } from '../frontmatter.mjs';
import { status, saveVersion, saveManualChanges, listVersions, ensureRepo } from '../versions.mjs';
import { validateSheet, loadSceneValueCheck } from '../adapter-ops.mjs';
import { plotMap } from '../plot/plot-map.mjs';
import { checkScene } from '../plot/scene-checks.mjs';
import { writeSessionMaps } from '../plot/session-map.mjs';
import { planLinks } from '../links/link-plan.mjs';
import { autoOutcomes } from '../links/auto-outcomes.mjs';
import { applyLinks } from '../links/apply-links.mjs';
import { checkLinks } from '../links/check-links.mjs';
import { checkSheets } from '../sheets/sheet-check.mjs';
import { checkItemSheets } from '../items/item-manager.mjs';
import { planRetiredIds, writeRetiredIds } from './retired-ids.mjs';

export const DRAFT_DIR = '.campaign/drafts';

const STATE_DIR = '.campaign/state';
const ENGINE_DIR = '.campaign/state/engine';
const CHECK_FILE = '.campaign/state/engine/check.json';
const REVIEW_FILE = '.campaign/state/engine/review.json';
const NOTE_FILE = '.campaign/state/work-note.md';
const SUBJECTS_FILE = '.campaign/cache/subjects.json';
// Categories whose documents are never scanned for mentions (see scanMentions).
const UNSCANNED_TYPES = new Set(['notes', 'sources', 'external']);
const CONFLICT_MESSAGE = 'changed by hand since the last saved version: read it again and redo the draft';
const REVIEW_MESSAGE = 'no model review with outcome APPLY matches the current drafts: check the batch again and review it';
const NO_GIT_MESSAGE = 'the campaign is not a git repository; the framework does not write without git';
const MANUAL_MESSAGE_IT = 'Modifiche fatte a mano';
const MANUAL_MESSAGE_EN = 'Changes made by hand';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks a batch without changing the campaign. It saves nothing and writes only
 * .campaign/state/engine/check.json. A batch file that was edited by hand since the
 * last saved version is reported as manual-change (commitBatch saves those edits first).
 * @param {string} root campaign folder
 * @param {{ files?: string[], deletes?: string[], sources?: string[], tmpRoot?: string }} [options] campaign-relative
 *   posix paths. files: documents whose draft is at <root>/.campaign/drafts/<path>. deletes: documents
 *   to remove. sources: files placed in the campaign by framework scripts (copied as they are).
 * @returns {Promise<{ ok: boolean, errors: object[], reviewRequired: boolean, layoutOnly: boolean,
 *   draftsHash: string, finalFiles: string[], ambiguousMentions: object[] }>}
 */
export async function checkBatch(root, options = {}) {
  const { files, deletes, sources, tmpRoot } = readArgs(root, options, false);
  const dir = path.resolve(root);
  const reviewRequired = needsReview(dir, files, deletes, sources);
  const layoutOnly = isLayoutOnly(files, deletes, sources);
  const draftsHash = hashDrafts(dir, files, deletes, sources);
  const repo = status(dir);
  if (!repo.isRepo) {
    return {
      ok: false,
      errors: [{ file: '', code: 'no-git', message: NO_GIT_MESSAGE }],
      reviewRequired,
      layoutOnly,
      draftsHash,
      finalFiles: [...files],
      ambiguousMentions: [],
    };
  }

  const dirty = dirtyPaths(repo.changed, sources);
  const batch = new Set([...files, ...deletes]);
  const conflicts = dirty.filter((rel) => batch.has(rel));
  const evaluation = conflicts.length > 0
    ? { errors: conflicts.map(conflictError), finalFiles: [...files], ambiguousMentions: [], copy: null }
    : await evaluate(dir, { files, deletes, sources, tmpRoot });
  try {
    const ok = evaluation.errors.length === 0;
    writeCheck(dir, {
      draftsHash,
      ok,
      reviewRequired,
      finalFiles: evaluation.finalFiles,
      checkedAt: new Date().toISOString(),
    });
    return {
      ok,
      errors: evaluation.errors,
      reviewRequired,
      layoutOnly,
      draftsHash,
      finalFiles: evaluation.finalFiles,
      ambiguousMentions: evaluation.ambiguousMentions,
    };
  } finally {
    removeCopy(evaluation.copy);
  }
}

/**
 * Saves the master's hand edits, then checks and, when clean, writes a batch into the
 * campaign and saves one version. Hand edits saved by this call are listed in manualChanges
 * even when the batch is refused, so a refused batch can be redrafted from the saved state.
 * @param {string} root campaign folder
 * @param {{ files?: string[], deletes?: string[], sources?: string[], message: string, note?: string }} options
 * @returns {Promise<{ ok: boolean, errors: object[], saved: { hash: string } | null, finalFiles: string[],
 *   manualChanges: string[], ambiguousMentions: object[], reviewRequired: boolean, layoutOnly: boolean }>}
 */
export async function commitBatch(root, options = {}) {
  const { files, deletes, sources, message, note, tmpRoot } = readArgs(root, options, true);
  const dir = path.resolve(root);
  const reviewRequired = needsReview(dir, files, deletes, sources);
  const layoutOnly = isLayoutOnly(files, deletes, sources);
  const refuse = (errors, extra = {}) => ({
    ok: false,
    errors,
    saved: null,
    finalFiles: [...files],
    manualChanges: [],
    ambiguousMentions: [],
    reviewRequired,
    layoutOnly,
    ...extra,
  });

  if (!status(dir).isRepo) {
    return refuse([{ file: '', code: 'no-git', message: NO_GIT_MESSAGE }]);
  }
  // 1. The master's own edits are saved first, so the framework never works on unsaved hand edits.
  // Only the paths dirty before ensureRepo are hand edits: the ignore rules that ensureRepo adds to
  // older campaigns belong to this commit's framework version.
  const dirty = dirtyPaths(status(dir).changed, sources);
  ensureRepo(dir);
  for (const rel of dirty) {
    if (!rel.endsWith('.md') || !isRegularFile(path.join(dir, rel))) continue;
    const fixed = masterProvenance(fs.readFileSync(path.join(dir, rel), 'utf8'));
    if (fixed !== null) fs.writeFileSync(path.join(dir, rel), fixed);
  }
  if (dirty.length > 0) {
    const manualMessage = campaignLanguage(dir) === 'it' ? MANUAL_MESSAGE_IT : MANUAL_MESSAGE_EN;
    saveManualChanges(dir, manualMessage);
  }

  // 2. A batch file edited by hand is refused: the draft was made from older content.
  const batch = new Set([...files, ...deletes]);
  const conflicts = dirty.filter((rel) => batch.has(rel));
  if (conflicts.length > 0) {
    return refuse(conflicts.map(conflictError), { manualChanges: dirty });
  }

  // 3. The model review must match the drafts as they are now.
  const draftsHash = hashDrafts(dir, files, deletes, sources);
  if (reviewRequired && !reviewApproved(dir, draftsHash)) {
    return refuse([{ file: '', code: 'review-missing', message: REVIEW_MESSAGE }], { manualChanges: dirty });
  }

  // 4. Same work as checkBatch, on the copy only.
  const evaluation = await evaluate(dir, { files, deletes, sources, tmpRoot });
  try {
    if (evaluation.errors.length > 0) {
      return {
        ok: false,
        errors: evaluation.errors,
        saved: null,
        finalFiles: evaluation.finalFiles,
        manualChanges: dirty,
        ambiguousMentions: evaluation.ambiguousMentions,
        reviewRequired,
        layoutOnly,
      };
    }

    // 5. Write: the copy, then the saved version, then the work state.
    let saved;
    try {
      syncTree(evaluation.copy, dir, evaluation.externalLinks);
      saved = saveVersion(dir, { message, kind: 'framework' });
      removeDrafts(dir, files);
      rmIfExists(path.join(dir, REVIEW_FILE));
      rmIfExists(path.join(dir, CHECK_FILE));
      writeWorkNote(dir, evaluation.finalFiles, note);
    } catch (error) {
      return {
        ok: false,
        errors: [{ file: '', code: error.code ?? 'write-failed', message: error.message }],
        saved: null,
        finalFiles: evaluation.finalFiles,
        manualChanges: dirty,
        ambiguousMentions: evaluation.ambiguousMentions,
        reviewRequired,
        layoutOnly,
      };
    }

    return {
      ok: true,
      errors: [],
      saved: saved.saved ? { hash: saved.hash } : null,
      finalFiles: evaluation.finalFiles,
      manualChanges: dirty,
      ambiguousMentions: evaluation.ambiguousMentions,
      reviewRequired,
      layoutOnly,
    };
  } finally {
    removeCopy(evaluation.copy);
  }
}

/**
 * Records the model review of the batch that was checked last. The review is bound to the
 * drafts hash that check printed: it is refused when check.json did not pass or was written
 * for other drafts. Writes review.json as { outcome, draftsHash }; commitBatch saves only
 * an APPLY review. Nothing is written on a refusal.
 * @param {string} root campaign folder
 * @param {{ outcome: string, draftsHash?: string }} options outcome: APPLY or FIX (the reviewer's answer)
 * @returns {{ ok: true, outcome: string, draftsHash: string } | { ok: false, errors: object[] }}
 */
export function recordReview(root, { outcome, draftsHash }) {
  const dir = path.resolve(root);
  const refuse = (code, message) => ({ ok: false, errors: [{ file: '', code, message }] });
  if (outcome !== 'APPLY' && outcome !== 'FIX') {
    return refuse('bad-outcome', 'the outcome of the review must be APPLY or FIX');
  }
  if (typeof draftsHash !== 'string' || draftsHash === '') {
    return refuse('no-drafts-hash', 'the drafts hash printed by the last check is required');
  }
  const check = readJson(path.join(dir, CHECK_FILE));
  if (check === null) {
    return refuse('check-missing', 'the batch was not checked: check it first, then review it');
  }
  if (check.ok !== true) {
    return refuse('check-failed', 'the last check did not pass: fix the batch and check it again before the review');
  }
  if (check.draftsHash !== draftsHash) {
    return refuse('review-stale', 'the batch changed since the last check, check it again and review it');
  }
  fs.mkdirSync(path.join(dir, ENGINE_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, REVIEW_FILE), `${JSON.stringify({ outcome, draftsHash }, null, 2)}\n`);
  return { ok: true, outcome, draftsHash };
}

// ---------------------------------------------------------------------------
// Evaluation: preflight, copy, transform, validate
// ---------------------------------------------------------------------------

/**
 * Runs everything that does not write the campaign. The returned copy (when present)
 * must be removed by the caller.
 */
async function evaluate(dir, { files, deletes, sources, tmpRoot }) {
  const draftsHash = hashDrafts(dir, files, deletes, sources);
  const preflightErrors = preflight(dir, files, deletes, sources);
  if (preflightErrors.length > 0) {
    return { errors: preflightErrors, finalFiles: [...files], ambiguousMentions: [], draftsHash, copy: null, externalLinks: new Map() };
  }
  const retired = planRetiredIds(dir, { files, deletes, draftRoot: path.join(dir, DRAFT_DIR) });
  if (retired.errors.length > 0) {
    return { errors: retired.errors, finalFiles: [...files], ambiguousMentions: [], draftsHash, copy: null, externalLinks: new Map() };
  }

  const copy = fs.mkdtempSync(path.join(tmpRoot, 'yllir-engine-'));
  const result = { errors: [], finalFiles: [...files], ambiguousMentions: [], draftsHash, copy, externalLinks: new Map() };
  try {
    const existing = files.filter((rel) => lstatOrNull(path.join(dir, rel)) !== null);
    const baseline = await validate(dir, scopesFor(dir, existing, deletes));

    const transformed = await transform(dir, copy, { files, deletes, retired: retired.ids });
    result.externalLinks = transformed.externalLinks;
    result.finalFiles = transformed.finalFiles;
    result.ambiguousMentions = transformed.ambiguousMentions;
    if (transformed.errors.length > 0) {
      result.errors = transformed.errors;
      return result;
    }

    const after = await validate(copy, scopesFor(copy, transformed.finalFiles, deletes));
    result.errors = newErrors(baseline, after, transformed.pathMap);
  } catch (error) {
    result.errors = [{ file: '', code: 'check-failed', message: error.message }];
  }
  return result;
}

/** Checks that do not need the copy. Returns error objects. */
function preflight(dir, files, deletes, sources) {
  const errors = [];
  const add = (file, code, message) => errors.push({ file, code, message });
  const draftRoot = path.join(dir, DRAFT_DIR);

  for (const rel of files) {
    const why = relativeProblem(rel, true);
    if (why !== null) {
      add(rel, 'bad-path', `${rel} ${why}`);
      continue;
    }
    const draft = path.join(draftRoot, rel);
    const draftStat = lstatOrNull(draft);
    if (symlinkAbove(draftRoot, rel) || (draftStat !== null && draftStat.isSymbolicLink())) {
      add(rel, 'symlink-draft', `the draft of ${rel} must not be a symbolic link or pass through one`);
      continue;
    }
    if (draftStat === null || !draftStat.isFile()) {
      add(rel, 'missing-draft', `there is no draft for ${rel}`);
      continue;
    }
    if (draftStat.size === 0) {
      add(rel, 'empty-draft', `the draft of ${rel} is empty`);
      continue;
    }
    if (symlinkAbove(dir, rel)) {
      add(rel, 'symlink-target', `${rel} must not be a symbolic link or pass through one`);
      continue;
    }
    const target = lstatOrNull(path.join(dir, rel));
    if (target !== null && target.isSymbolicLink()) add(rel, 'symlink-target', `${rel} must not be a symbolic link`);
    else if (target !== null && target.isDirectory()) add(rel, 'bad-target', `${rel} is a folder in the campaign`);
  }

  for (const rel of deletes) {
    const why = relativeProblem(rel, false);
    if (why !== null) {
      add(rel, 'bad-path', `${rel} ${why}`);
      continue;
    }
    if (symlinkAbove(dir, rel)) {
      add(rel, 'symlink-target', `${rel} must not pass through a symbolic link`);
      continue;
    }
    const target = lstatOrNull(path.join(dir, rel));
    if (target === null) add(rel, 'missing-file', `${rel} does not exist, so it cannot be deleted`);
    else if (target.isDirectory()) add(rel, 'bad-target', `${rel} is a folder, not a document`);
  }

  for (const rel of sources) {
    const why = relativeProblem(rel, false, { source: true });
    if (why !== null) {
      add(rel, 'bad-path', `${rel} ${why}`);
      continue;
    }
    if (symlinkAbove(dir, rel)) {
      add(rel, 'symlink-target', `${rel} must not pass through a symbolic link`);
      continue;
    }
    const target = lstatOrNull(path.join(dir, rel));
    if (target === null) add(rel, 'missing-source', `${rel} is not in the campaign`);
    else if (target.isDirectory()) add(rel, 'bad-target', `${rel} is a folder, not a file`);
  }

  for (const rel of files) {
    if (deletes.includes(rel)) add(rel, 'bad-path', `${rel} is both written and deleted`);
    if (sources.includes(rel)) add(rel, 'bad-path', `${rel} is both written and a source`);
  }
  for (const rel of deletes) {
    if (sources.includes(rel)) add(rel, 'bad-path', `${rel} is both deleted and a source`);
  }
  return errors;
}

/**
 * Builds the copy, applies the batch to it, and runs the transform steps in order:
 * layout, links, plot maps, derived indexes. Errors returned here always block.
 */
async function transform(dir, copy, { files, deletes, retired }) {
  const out = { errors: [], finalFiles: [...files], pathMap: {}, ambiguousMentions: [], externalLinks: new Map() };
  out.externalLinks = copyCampaign(dir, copy);

  for (const rel of files) {
    const dest = path.join(copy, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(dir, DRAFT_DIR, rel), dest);
    if (rel.endsWith('.md')) {
      // Every saved document uses the comment form, even when an agent wrote a dashes block.
      const converted = toCommentMetadata(fs.readFileSync(dest, 'utf8'));
      if (converted !== null) fs.writeFileSync(dest, converted);
    }
  }
  for (const rel of deletes) fs.rmSync(path.join(copy, rel), { force: true });
  writeRetiredIds(copy, retired);

  // 1. Geographic layout. A plan that is blocked by an error is left to validation.
  const layout = planGeographicLayout(copy);
  if (layout.status === 'ready') {
    const applied = applyGeographicLayout(copy, layout, { files });
    if (applied.status !== 'applied') {
      const errors = (applied.errors ?? []).map((item) => normalize('geographic-layout', item));
      out.errors = errors.length > 0 ? errors : [{ file: '', code: 'geographic-layout', message: `layout ${applied.status}` }];
      return out;
    }
    out.finalFiles = applied.finalFiles;
    out.pathMap = layout.pathMap ?? {};
  }

  // 2. Links: safe proposals are applied, uncertain ones are reported as ambiguous.
  const linkable = linkableFiles(copy, out.finalFiles);
  const plan = planLinks(copy, { files: linkable });
  const auto = autoOutcomes(copy, plan);
  const applied = applyLinks(copy, plan, auto.outcomes);
  const pidFile = new Map(plan.proposals.map((p) => [p.pid, p.file]));
  for (const rejected of applied.rejected) {
    out.errors.push({ file: '', code: 'links', message: `link outcome rejected: ${rejected.reason}` });
  }
  for (const skipped of applied.skipped) {
    out.errors.push({
      file: pidFile.get(skipped.pid) ?? '',
      code: 'links',
      message: `link could not be inserted: ${skipped.reason}`,
    });
  }
  const uncertain = new Set(auto.uncertain);
  out.ambiguousMentions = plan.proposals
    .filter((p) => uncertain.has(p.pid))
    .map((p) => ({ file: p.file, line: p.line, text: p.text, candidates: [p.subject] }));

  // 3. Plot maps, when a plot document or a plot session changed.
  const structure = readStructure(copy).structure ?? [];
  const plotFolders = folderPaths(structure, (type) => type === 'plot');
  if ([...out.finalFiles, ...deletes].some((rel) => plotFolders.some((folder) => isInside(rel, folder)))) {
    const map = plotMap(copy);
    if (!map.errors.some((error) => error.code === 'campaign-config')) {
      writeSessionMaps(copy, map.sessions);
    }
  }

  // 4. Derived indexes.
  fs.mkdirSync(path.join(copy, '.campaign', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(copy, SUBJECTS_FILE), `${JSON.stringify(buildSubjectIndex(copy), null, 2)}\n`);
  writeWorldIndex(copy, buildWorldIndex(copy));

  return out;
}

/**
 * Runs every validator on a campaign folder. Each validator that throws is reported
 * as an error with the validator name as code, so one broken validator never hides the rest.
 * @param {string} dir campaign folder (the real one, or the copy)
 * @param {{ files: string[], checkFiles: string[]|null, planFiles: string[]|null }} scope
 */
async function validate(dir, { files, checkFiles, planFiles }) {
  const out = [];
  const run = (code, produce, fallbackFile = '') => {
    try {
      for (const item of produce()) out.push(normalize(code, item, fallbackFile));
    } catch (error) {
      out.push({ file: fallbackFile, code, message: error.message });
    }
  };

  run('world', () => buildWorldIndex(dir).errors);
  run('links', () => checkLinks(dir, { files: checkFiles }).errors);
  run('links', () => planLinks(dir, { files: planFiles }).errors);
  if (files.length > 0) {
    run('sheets', () => checkSheets(dir, { files }).errors);
    run('items', () => checkItemSheets(dir, { files }).errors);
  }
  run('config', () => validateConfig(dir).errors.map((e) => ({ ...e, message: e.path ? `${e.path}: ${e.message}` : e.message })), 'campaign.yaml');
  run('plot', () => plotMap(dir).errors);
  run('geographic-layout', () => planGeographicLayout(dir).errors);
  out.push(...(await adapterErrors(dir, files)));
  if (files.length > 0) {
    try {
      out.push(...(await sceneErrors(dir, files)));
    } catch (error) {
      out.push(normalize('scene-checks', { message: error.message }));
    }
  }
  return out;
}

/** Errors of the plot event files in the batch (see plot/scene-checks.mjs). */
async function sceneErrors(dir, files) {
  const structure = readStructure(dir).structure ?? [];
  const plotFolders = folderPaths(structure, (type) => type === 'plot');
  const eventFiles = files.filter((rel) => isSceneEventFile(rel, plotFolders));
  if (eventFiles.length === 0) return [];

  const config = readConfig(dir);
  const lang = typeof config?.language?.main === 'string' ? config.language.main : 'en';
  const checkValue = await sceneValueCheck(config);
  const out = [];
  for (const file of eventFiles) {
    const text = readText(path.join(dir, file));
    if (text === null) continue;
    for (const entry of checkScene(text, lang, { checkValue })) {
      out.push(normalize('scene-checks', { file, message: `line ${entry.line}: ${entry.message}` }, file));
    }
  }
  return out;
}

/** An event file: inside a plot folder, in an Eventi or Events folder, and not a session main file. */
function isSceneEventFile(rel, plotFolders) {
  if (!rel.endsWith('.md') || !plotFolders.some((folder) => isInside(rel, folder))) return false;
  const parent = path.posix.basename(path.posix.dirname(rel));
  if (parent !== 'Eventi' && parent !== 'Events') return false;
  return path.posix.basename(rel, '.md') !== parent;
}

/** The adapter's scene check of check values, or undefined when no game-rules adapter loads. */
async function sceneValueCheck(config) {
  const adapterId = config?.system?.adapter;
  if (typeof adapterId !== 'string' || adapterId === '' || adapterId === 'none') return undefined;
  const loaded = loadAdapter(pluginRootFromHere(), adapterId);
  if (!loaded.ok || !loaded.adapter) return undefined;
  return (await loadSceneValueCheck(loaded.adapter)) ?? undefined;
}

/** Errors of the system adapter: its own load errors, and each sheet of a kind it checks. */
async function adapterErrors(dir, files) {
  const config = readConfig(dir);
  const adapterId = config?.system?.adapter;
  if (typeof adapterId !== 'string' || adapterId === '' || adapterId === 'none') return [];

  const loaded = loadAdapter(pluginRootFromHere(), adapterId);
  const out = loaded.errors.map((e) =>
    normalize('adapter', { code: e.code, message: e.path ? `${e.path}: ${e.message}` : e.message }),
  );
  if (!loaded.ok || !loaded.adapter) return out;

  const lang = typeof config.language?.main === 'string' ? config.language.main : 'en';
  const itemFolders = folderPaths(readStructure(dir).structure ?? [], (type) => type === 'objects');
  for (const file of files) {
    const text = readText(path.join(dir, file));
    if (text === null) continue;
    const { data } = parseFrontmatter(text);
    // A sketch is not checked by the adapter: it has no statistics yet.
    const sketch = data?.sketch === true || data?.sketch === 'true';
    const kind = sketch
      ? null
      : ['enemy', 'npc', 'vendor'].includes(data?.template)
        ? 'creature'
        : itemFolders.some((f) => isInside(file, f)) ? 'item' : null;
    if (kind === null) continue;
    const checked = await validateSheet(loaded.adapter, kind, text, lang);
    for (const error of checked.errors) out.push(normalize('adapter', error, file));
  }
  return out;
}

/** Scope of the validators: the batch files, and the whole campaign when a file is deleted. */
function scopesFor(dir, files, deletes) {
  return {
    files,
    checkFiles: deletes.length > 0 ? null : files,
    planFiles: deletes.length > 0 ? null : linkableFiles(dir, files),
  };
}

/**
 * Errors of the copy that were not already in the campaign before the batch.
 * Each error is identified by its file (after the layout moves), its code and its message.
 */
function newErrors(baseline, after, pathMap) {
  const counts = new Map();
  for (const error of baseline) {
    const file = Object.hasOwn(pathMap, error.file) ? pathMap[error.file] : error.file;
    const key = keyOf({ ...error, file });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const fresh = [];
  for (const error of after) {
    const key = keyOf(error);
    const seen = counts.get(key) ?? 0;
    if (seen > 0) counts.set(key, seen - 1);
    else fresh.push(error);
  }
  return fresh;
}

function keyOf(error) {
  return JSON.stringify([error.file, error.code, error.message]);
}

function normalize(code, item, fallbackFile = '') {
  const error = {
    file: typeof item.file === 'string' ? item.file : fallbackFile,
    code: typeof item.code === 'string' ? item.code : code,
    message: typeof item.message === 'string' ? item.message : String(item.message ?? ''),
  };
  if (item.ids !== undefined) error.ids = item.ids;
  return error;
}

function conflictError(file) {
  return { file, code: 'manual-change', message: CONFLICT_MESSAGE };
}

// ---------------------------------------------------------------------------
// Copy and tree synchronisation
// ---------------------------------------------------------------------------

/**
 * Copies the campaign, without .git and the transient folders. Relative symlinks inside the
 * campaign stay relative. Relative symlinks that point outside the campaign are made absolute in
 * the copy, because a relative target would resolve to another place there; syncTree restores
 * them. Returns the rewritten links by campaign-relative path: { absolute, original }.
 */
function copyCampaign(dir, copy) {
  const restored = new Map();
  fs.cpSync(dir, copy, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: (src) => {
      const rel = path.relative(dir, src).split(path.sep).join('/');
      return !isExcludedFromTree(rel);
    },
  });
  for (const [rel, kind] of listTree(copy)) {
    if (kind !== 'link') continue;
    const original = fs.readlinkSync(path.join(dir, rel));
    if (path.isAbsolute(original)) continue;
    const resolved = path.resolve(path.dirname(path.join(dir, rel)), original);
    const inside = path.relative(dir, resolved);
    if (!inside.startsWith('..') && !path.isAbsolute(inside)) continue;
    fs.rmSync(path.join(copy, rel), { force: true });
    fs.symlinkSync(resolved, path.join(copy, rel));
    restored.set(rel, { absolute: resolved, original });
  }
  return restored;
}

/** Makes the campaign tree equal to the copy: writes what differs, deletes what is gone. */
function syncTree(from, to, externalLinks = new Map()) {
  const source = listTree(from);
  const target = listTree(to);
  const emptied = new Set();

  for (const rel of target.keys()) {
    if (source.has(rel)) continue;
    fs.rmSync(path.join(to, rel), { force: true });
    for (let parent = path.posix.dirname(rel); parent !== '.'; parent = path.posix.dirname(parent)) {
      emptied.add(parent);
    }
  }

  for (const [rel, kind] of source) {
    const fromFull = path.join(from, rel);
    const toFull = path.join(to, rel);
    const current = target.get(rel);
    if (kind === 'link') {
      let linkTarget = fs.readlinkSync(fromFull);
      const external = externalLinks.get(rel);
      if (external && linkTarget === external.absolute) linkTarget = external.original;
      if (current === 'link' && fs.readlinkSync(toFull) === linkTarget) continue;
      if (current !== undefined) fs.rmSync(toFull, { force: true });
      fs.mkdirSync(path.dirname(toFull), { recursive: true });
      fs.symlinkSync(linkTarget, toFull);
    } else {
      if (current === 'file' && fs.readFileSync(fromFull).equals(fs.readFileSync(toFull))) continue;
      if (current !== undefined) fs.rmSync(toFull, { force: true });
      fs.mkdirSync(path.dirname(toFull), { recursive: true });
      fs.copyFileSync(fromFull, toFull);
    }
  }

  // Folders that the removals left empty go away; folders that were already empty stay.
  for (const dirRel of [...emptied].sort((a, b) => b.length - a.length)) {
    if (isInside(dirRel, '.campaign') || isInside(dirRel, '.git')) continue;
    const full = path.join(to, dirRel);
    if (isEmptyDir(full)) fs.rmdirSync(full);
  }
}

/** Files and symlinks of a tree, by campaign-relative path. Directories are not listed. */
function listTree(base) {
  const found = new Map();
  const walk = (rel) => {
    const full = rel === '' ? base : path.join(base, rel);
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (isExcludedFromTree(child)) continue;
      if (entry.isSymbolicLink()) found.set(child, 'link');
      else if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) found.set(child, 'file');
    }
  };
  walk('');
  return found;
}

// ---------------------------------------------------------------------------
// Drafts, review, notes
// ---------------------------------------------------------------------------

/**
 * Sorted hash of the batch: each file with its draft content, each delete by its path,
 * each source by its path and the sha256 of its content.
 */
function hashDrafts(dir, files, deletes, sources) {
  const parts = [];
  for (const rel of files) {
    const content = readBytes(path.join(dir, DRAFT_DIR, rel)) ?? Buffer.alloc(0);
    parts.push(Buffer.concat([Buffer.from(`${rel}\0`), content, Buffer.from('\0')]));
  }
  for (const rel of deletes) parts.push(Buffer.from(`delete\0${rel}\0`));
  for (const rel of sources) {
    const content = readFollowing(path.join(dir, rel)) ?? Buffer.alloc(0);
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    parts.push(Buffer.from(`source\0${rel}\0${digest}\0`));
  }
  parts.sort(Buffer.compare);
  const hash = crypto.createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

/**
 * A review is needed for drafts, deletes, and Markdown sources. Two cases need none: a layout-only
 * batch, and a batch whose drafts differ from the campaign only by Markdown link markup or image
 * embeds (the author adding links to ambiguous mentions, or images, which add no facts).
 */
function needsReview(dir, files, deletes, sources) {
  // Image styles and image providers are configuration, not canon: their Markdown prompts need no review.
  const markdownSources = sources.some((rel) => rel.endsWith('.md') && !isCampaignContentSource(rel));
  if (files.length > 0 && deletes.length === 0 && !markdownSources && onlyLinksOrImagesChanged(dir, files)) return false;
  return files.length > 0 || deletes.length > 0 || markdownSources;
}

/**
 * True when every draft equals its campaign file once link and image markup is removed and blank
 * lines are collapsed (see normalizeText).
 */
function onlyLinksOrImagesChanged(dir, files) {
  return files.every((rel) => {
    const draft = readText(path.join(dir, DRAFT_DIR, rel));
    const current = readText(path.join(dir, rel));
    return draft !== null && current !== null && comparable(draft) === comparable(current);
  });
}

/** The text used to compare a draft with its campaign file: no map sections, no links, no images, normalized blank lines. */
function comparable(text) {
  return normalizeText(stripLinks(stripImages(stripMapSections(text))));
}

const MAP_OPEN = '<!-- yllir:map -->';
const MAP_CLOSE = '<!-- /yllir:map -->';

/**
 * Removes each generated map section: from a line that is exactly the opening marker to the next line
 * that is exactly the closing marker, both included. An opening marker without a closing one removes nothing.
 */
function stripMapSections(text) {
  const lines = text.split('\n');
  const kept = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === MAP_OPEN) {
      const close = lines.findIndex((line, at) => at > i && line.trim() === MAP_CLOSE);
      if (close >= 0) {
        i = close + 1;
        continue;
      }
    }
    kept.push(lines[i]);
    i += 1;
  }
  return kept.join('\n');
}

/** Removes each whole line that is only an image embed, and every inline image embed. */
function stripImages(text) {
  return text.replace(/^[ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*\r?\n?/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '');
}

/** Replaces every Markdown link (not an image) with its text. */
function stripLinks(text) {
  return text.replace(/(?<!!)\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/** Collapses every run of two or more blank lines into one blank line. */
function normalizeText(text) {
  return text.replace(/\n[ \t]*\r?\n(?:[ \t]*\r?\n)+/g, '\n\n');
}

function isLayoutOnly(files, deletes, sources) {
  return files.length === 0 && deletes.length === 0 && sources.length === 0;
}

/** Changed paths that are the master's own edits: framework state and sources excluded. */
function dirtyPaths(changed, sources) {
  return changed
    .map((entry) => entry.path)
    .filter((rel) => !isExcludedFromTree(rel) && !sources.includes(rel))
    .sort(compareStrings);
}

function writeCheck(dir, record) {
  fs.mkdirSync(path.join(dir, ENGINE_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, CHECK_FILE), `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * True when review.json says APPLY, check.json passed for these drafts, and the review is not older than the check.
 * A review that carries a draftsHash (written by `engine review`) must name these drafts too; one without it
 * (older flows, the master screen's live-table review) is accepted on the outcome and the check alone.
 */
function reviewApproved(dir, draftsHash) {
  const reviewPath = path.join(dir, REVIEW_FILE);
  const checkPath = path.join(dir, CHECK_FILE);
  const review = readJson(reviewPath);
  const check = readJson(checkPath);
  if (!review || review.outcome !== 'APPLY') return false;
  if (review.draftsHash !== undefined && review.draftsHash !== draftsHash) return false;
  if (!check || check.draftsHash !== draftsHash || check.ok !== true) return false;
  return fs.statSync(reviewPath).mtimeMs >= fs.statSync(checkPath).mtimeMs;
}

function writeWorkNote(dir, finalFiles, note) {
  const [latest] = listVersions(dir, { limit: 1 });
  const lastSaved = latest ? `${latest.hash} ${latest.message}` : 'none';
  const trimmedNote = note.trim() === '' ? 'none' : note.trim();
  const lines = [
    '# Work in progress',
    `updated: ${new Date().toISOString()}`,
    `last saved: ${lastSaved}`,
    `files: ${finalFiles.join(', ')}`,
    `note: ${trimmedNote}`,
  ];
  fs.mkdirSync(path.join(dir, STATE_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, NOTE_FILE), `${lines.join('\n')}\n`);
}

function removeDrafts(dir, files) {
  const draftRoot = path.join(dir, DRAFT_DIR);
  for (const rel of files) {
    const full = path.join(draftRoot, rel);
    fs.rmSync(full, { force: true });
    let parent = path.dirname(full);
    while (parent.startsWith(`${draftRoot}${path.sep}`) && isEmptyDir(parent)) {
      fs.rmdirSync(parent);
      parent = path.dirname(parent);
    }
  }
}

/**
 * Rewrites `provenance: generated` to `provenance: master` in the frontmatter of a
 * document the master edited by hand. Returns the new text, or null when nothing changes.
 */
function masterProvenance(text) {
  const lines = text.split('\n');
  const block = findMetadataBlock(lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)));
  if (block === null || block.close === -1) return null;
  for (let i = 1; i < block.close; i++) {
    const fixed = lines[i].replace(/^provenance:[ \t]*generated([ \t]*\r?)$/, 'provenance: master$1');
    if (fixed !== lines[i]) {
      lines[i] = fixed;
      return lines.join('\n');
    }
  }
  return null;
}

function campaignLanguage(dir) {
  const main = readConfig(dir)?.language?.main;
  return typeof main === 'string' ? main : '';
}

function removeCopy(copy) {
  if (copy) fs.rmSync(copy, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function readArgs(root, options, requireMessage) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new TypeError('root must be the path of the campaign folder');
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  const { files = [], deletes = [], sources = [], message, note = '', tmpRoot = os.tmpdir() } = options;
  if (typeof tmpRoot !== 'string' || tmpRoot === '') {
    throw new TypeError('tmpRoot must be a folder path');
  }
  for (const [name, list] of [['files', files], ['deletes', deletes], ['sources', sources]]) {
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
      throw new TypeError(`${name} must be a list of campaign-relative paths`);
    }
  }
  if (requireMessage && (typeof message !== 'string' || message.trim() === '')) {
    throw new TypeError('message must be a non-empty string');
  }
  if (typeof note !== 'string') {
    throw new TypeError('note must be a string');
  }
  return {
    files: [...new Set(files)],
    deletes: [...new Set(deletes)],
    sources: [...new Set(sources)],
    message,
    note,
    tmpRoot,
  };
}

/**
 * Folders under .campaign/ whose files a batch may name as sources: image styles
 * (.campaign/styles/<id>/<file>) and campaign image providers (.campaign/image-providers/<id>/<file>).
 * Nothing else under .campaign/ is allowed, and files and deletes are never allowed there.
 */
const CAMPAIGN_CONTENT_DIRS = ['.campaign/styles/', '.campaign/image-providers/'];

/** True for a file inside one of CAMPAIGN_CONTENT_DIRS, at least one level below it. */
function isCampaignContentSource(rel) {
  return CAMPAIGN_CONTENT_DIRS.some((dir) => rel.startsWith(dir) && rel.length > dir.length);
}

/**
 * Null when the path may be used, otherwise the reason it may not. A source may also be a file of
 * a campaign content folder (see isCampaignContentSource); files and deletes may not.
 */
function relativeProblem(rel, markdown, { source = false } = {}) {
  if (rel === '') return 'must not be empty';
  if (rel.includes('\\') || path.posix.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) {
    return 'must be a relative path with forward slashes';
  }
  const parts = rel.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    return 'must be a plain relative path without . or ..';
  }
  if (parts.includes('.git')) return 'is inside a folder the framework owns';
  if (parts.includes('.campaign') && !(source && isCampaignContentSource(rel))) {
    return 'is inside a folder the framework owns';
  }
  if (markdown && !rel.endsWith('.md')) return 'must be a Markdown file ending in .md';
  return null;
}

/** Campaign-relative folders of the categories whose type passes the predicate. */
function folderPaths(structure, predicate) {
  return structure
    .filter((category) => typeof category.folder === 'string' && predicate(category.type))
    .map((category) => path.posix.normalize(category.folder).replace(/\/+$/, ''));
}

/** Files that the linker scans: those inside a scanned category. */
function linkableFiles(dir, files) {
  const structure = readStructure(dir).structure ?? [];
  const scanned = folderPaths(structure, (type) => !UNSCANNED_TYPES.has(type));
  return files.filter((rel) => scanned.some((folder) => isInside(rel, folder)));
}

function isInside(rel, folder) {
  return rel === folder || rel.startsWith(`${folder}/`);
}

function isExcludedFromTree(rel) {
  return rel === '.git' || isInside(rel, '.git') || isInside(rel, DRAFT_DIR) || isInside(rel, STATE_DIR);
}

/** True when an existing folder between the base and the file is a symbolic link. */
function symlinkAbove(base, rel) {
  let current = base;
  for (const part of rel.split('/').slice(0, -1)) {
    current = path.join(current, part);
    const stat = lstatOrNull(current);
    if (stat === null) return false;
    if (stat.isSymbolicLink()) return true;
  }
  return false;
}

function lstatOrNull(full) {
  try {
    return fs.lstatSync(full);
  } catch {
    return null;
  }
}

function isRegularFile(full) {
  const stat = lstatOrNull(full);
  return stat !== null && stat.isFile();
}

function isEmptyDir(full) {
  try {
    return fs.statSync(full).isDirectory() && fs.readdirSync(full).length === 0;
  } catch {
    return false;
  }
}

function readText(full) {
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

function readBytes(full) {
  if (!isRegularFile(full)) return null;
  return fs.readFileSync(full);
}

/** Contents of a file, following symbolic links (sources may be links to originals kept outside). */
function readFollowing(full) {
  try {
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}

function readJson(full) {
  const text = readText(full);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readConfig(dir) {
  const text = readText(path.join(dir, 'campaign.yaml'));
  if (text === null) return null;
  return parseYamlLite(text).data ?? null;
}

function rmIfExists(full) {
  fs.rmSync(full, { force: true });
}
