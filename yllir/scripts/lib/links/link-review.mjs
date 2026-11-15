// Review of the mentions that the engine did not link. planReview lists the
// proposals of some campaign files for an agent reviewer, with the text around
// each one and the sheet it points to, and saves the plan with its pids.
// applyReview takes the reviewer's outcomes (id, outcome, reason only), fills the
// rest from the saved plan, applies them with applyLinks and saves one version
// when links were written. The sheet excerpt leaves out master-only text; mentions
// inside master-only text of a document are reviewed like any other text.

import fs from 'node:fs';
import path from 'node:path';
import { planLinks } from './link-plan.mjs';
import { applyLinks } from './apply-links.mjs';
import { isGenerated } from '../mentions.mjs';
import { compareStrings, readStructure } from '../subjects.mjs';
import { status, saveVersion, saveManualChanges, ensureRepo } from '../versions.mjs';
import { findMetadataBlock } from '../frontmatter.mjs';
import { parseYamlLite } from '../yaml-lite.mjs';

export const DEFAULT_PLAN_FILE = '.campaign/state/link-review.json';
const NO_GIT_MESSAGE = 'the campaign is not a git repository; the framework does not write without git';
// Same messages as the batch commit uses for hand edits (see commit.mjs).
const MANUAL_MESSAGE_IT = 'Modifiche fatte a mano';
const MANUAL_MESSAGE_EN = 'Changes made by hand';
// Categories whose documents are never scanned for mentions (same rule as the batch check).
const UNSCANNED_TYPES = new Set(['notes', 'sources', 'external']);
const EXCERPT_LINES = 12;
// From the master marker to its closing marker, or to the end when the closing marker is missing.
const MASTER_BLOCK = /<!-- master -->[\s\S]*?(?:<!-- \/master -->|$)/g;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The --out and --plan paths must be files under .campaign/state/ of the campaign. */
function checkedStatePath(rel) {
  const parts = rel.split('/');
  if (path.posix.isAbsolute(rel) || parts.includes('..') || !rel.startsWith('.campaign/state/') || rel.endsWith('/')) {
    throw new Error('the link plan file must be a file under .campaign/state/ of the campaign');
  }
  return rel;
}

/** Relative path without `..` or absolute parts, with `/` separators. Null when it is not one. */
function cleanRelative(rel) {
  if (typeof rel !== 'string') return null;
  const clean = rel.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (clean === '' || path.posix.isAbsolute(clean) || clean.split('/').includes('..')) return null;
  return clean;
}

/** Files that the linker scans: inside a scanned category and not generated. Same rule as the batch check. */
function linkableFiles(root, files) {
  const structure = readStructure(root).structure ?? [];
  const scanned = structure
    .filter((category) => typeof category.folder === 'string' && !UNSCANNED_TYPES.has(category.type))
    .map((category) => path.posix.normalize(category.folder).replace(/\/+$/, ''));
  return files.filter(
    (rel) => scanned.some((folder) => rel === folder || rel.startsWith(`${folder}/`)) && !isGenerated(root, rel),
  );
}

/** Paths the hand-edit save ignores: git itself and the framework's own state and drafts. */
function isExcludedFromTree(rel) {
  return rel === '.git' || rel.startsWith('.git/') || rel.startsWith('.campaign/drafts/') || rel.startsWith('.campaign/state/');
}

/** Same rule as commit.mjs: a master's `provenance: generated` line in a dirty sheet becomes `master`. */
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

function campaignLanguage(root) {
  try {
    const main = parseYamlLite(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8')).data?.language?.main;
    return typeof main === 'string' ? main : '';
  } catch {
    return '';
  }
}

/**
 * Saves the master's hand edits as their own version before the framework writes
 * anything, as the batch commit does. Returns the dirty paths (empty when none).
 */
function saveHandEdits(root) {
  const dirty = status(root).changed
    .map((entry) => entry.path)
    .filter((rel) => !isExcludedFromTree(rel))
    .sort(compareStrings);
  ensureRepo(root);
  for (const rel of dirty) {
    if (!rel.endsWith('.md')) continue;
    const full = path.join(root, rel);
    try {
      if (!fs.lstatSync(full).isFile()) continue;
    } catch {
      continue;
    }
    const fixed = masterProvenance(fs.readFileSync(full, 'utf8'));
    if (fixed !== null) fs.writeFileSync(full, fixed);
  }
  if (dirty.length > 0) {
    saveManualChanges(root, campaignLanguage(root) === 'it' ? MANUAL_MESSAGE_IT : MANUAL_MESSAGE_EN);
  }
  return dirty;
}

/** Sheet text as the reviewer may see it: master-only text removed, first lines only. */
function publicExcerpt(text) {
  return text.replace(MASTER_BLOCK, '').split(/\r?\n/).slice(0, EXCERPT_LINES).join('\n');
}

/**
 * Makes the evidence of a sheet: the sheet and the line of its title (`# `), or line 1 when there is none.
 * Same value as autoOutcomes uses.
 */
function evidenceOf(root, sheet) {
  const lines = fs.readFileSync(path.join(root, sheet), 'utf8').split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith('# '));
  return `${sheet}:${index === -1 ? 1 : index + 1}`;
}

/** Reads a sheet once per call; a sheet that cannot be read gives an empty excerpt and evidence line 1. */
function sheetInfo(root, cache, sheet) {
  if (!cache.has(sheet)) {
    let info;
    try {
      const text = fs.readFileSync(path.join(root, sheet), 'utf8');
      info = { evidence: evidenceOf(root, sheet), excerpt: publicExcerpt(text) };
    } catch {
      info = { evidence: `${sheet}:1`, excerpt: '' };
    }
    cache.set(sheet, info);
  }
  return cache.get(sheet);
}

/**
 * Plan mode. Plans the links of the given campaign files, saves the full plan
 * (with the raw proposals, for applyReview) and returns the part for the reviewer.
 * @param {string} root absolute path to the campaign folder
 * @param {{ files?: string[], out?: string }} options
 */
export function planReview(root, { files = [], out = DEFAULT_PLAN_FILE } = {}) {
  const planFile = checkedStatePath(out);
  const wanted = linkableFiles(root, [...new Set(files.map(cleanRelative).filter((f) => f !== null))]);
  const plan = planLinks(root, { files: wanted });

  const cache = new Map();
  const proposals = plan.proposals.map((p) => {
    const info = sheetInfo(root, cache, p.sheet);
    const item = {
      pid: p.pid,
      file: p.file,
      line: p.line,
      col: p.col,
      text: p.text,
      subject: p.subject,
      sheet: p.sheet,
      target: p.target,
      before: p.before,
      after: p.after,
      in_master: p.in_master,
      evidence: info.evidence,
      sheet_excerpt: info.excerpt,
    };
    return item;
  });

  const full = path.join(root, planFile);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    `${JSON.stringify({ scope: plan.scope, errors: plan.errors, proposals: plan.proposals, review: plan.review }, null, 2)}\n`,
  );

  return { ok: true, count: proposals.length, proposals, review: plan.review, plan_file: planFile };
}

/** Full result shape for a refusal, so the caller always gets the same keys. */
function refusal(code, message) {
  return {
    ok: false,
    applied: [],
    omit: [],
    ask: [],
    missing_outcome: [],
    rejected: [{ entry: null, reason: message, code }],
    skipped: [],
    residual_unexplained: [],
    saved: null,
    manualChanges: [],
    errors: [{ file: '', code, message }],
  };
}

/** The outcomes file must be a regular file under .campaign/state/ or .campaign/drafts/ of the campaign. */
function readOutcomesFile(root, rel) {
  const clean = cleanRelative(rel);
  if (clean === null) return null;
  if (!clean.startsWith('.campaign/state/') && !clean.startsWith('.campaign/drafts/')) return null;
  const full = path.join(root, clean);
  try {
    if (!fs.statSync(full).isFile()) return null;
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Apply mode. Reads the reviewer's outcomes ({ id, outcome, reason }), completes
 * them from the saved plan, applies them and saves one version when links were written.
 * Deletes the plan file after a successful apply.
 * @param {string} root absolute path to the campaign folder
 * @param {{ outcomesFile: string, planFile?: string, message: string }} options
 */
export function applyReview(root, { outcomesFile, planFile = DEFAULT_PLAN_FILE, message }) {
  if (!status(root).isRepo) return refusal('no-git', NO_GIT_MESSAGE);

  const planRel = checkedStatePath(planFile);
  const planFull = path.join(root, planRel);
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planFull, 'utf8'));
  } catch {
    return refusal('no-plan', `no readable link plan at ${planRel}: run links with --files first`);
  }
  if (!isPlainObject(plan) || !Array.isArray(plan.proposals)) {
    return refusal('no-plan', `${planRel} is not a link plan`);
  }

  const outcomesRaw = readOutcomesFile(root, outcomesFile);
  if (outcomesRaw === null || outcomesRaw === undefined) {
    return refusal('bad-outcomes-file', 'the outcomes file must be an existing file under .campaign/state/ or .campaign/drafts/');
  }
  if (!Array.isArray(outcomesRaw)) return refusal('bad-outcomes-file', 'the outcomes file must hold a JSON array');

  const byPid = new Map(plan.proposals.map((p) => [p.pid, p]));
  const cache = new Map();
  const outcomes = [];
  for (const entry of outcomesRaw) {
    const proposal = isPlainObject(entry) && typeof entry.id === 'string' ? byPid.get(entry.id) : undefined;
    if (proposal === undefined) {
      // Unknown or malformed entries go through unchanged, so applyLinks rejects them.
      outcomes.push(entry);
      continue;
    }
    outcomes.push({
      id: proposal.pid,
      file: proposal.file,
      occurrence: `${proposal.line}:${proposal.col}`,
      target: proposal.target,
      evidence: sheetInfo(root, cache, proposal.sheet).evidence,
      outcome: entry.outcome,
      reason: entry.reason,
    });
  }

  // Hand edits first, in their own version, so the framework version holds only the links.
  const manualChanges = saveHandEdits(root);
  const result = applyLinks(root, plan, outcomes);

  let saved = null;
  if (result.applied.length > 0) {
    const version = saveVersion(root, { message, kind: 'framework' });
    saved = version.saved ? { hash: version.hash } : null;
  }

  const ok = result.ok;
  if (ok) fs.rmSync(planFull, { force: true });

  const detail = (pid) => {
    const p = byPid.get(pid);
    return { pid, file: p.file, line: p.line, text: p.text, subject: p.subject, sheet: p.sheet };
  };

  return {
    ok,
    applied: result.applied,
    omit: result.omit,
    ask: result.ask.map(detail),
    missing_outcome: result.missing_outcome,
    rejected: result.rejected,
    skipped: result.skipped,
    residual_unexplained: result.residual_unexplained.map((p) => p.pid),
    saved,
    manualChanges,
  };
}
