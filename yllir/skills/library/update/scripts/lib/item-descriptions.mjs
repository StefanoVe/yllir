// Resumable inventory and verification for the semantic item migrations.
// The model writes drafts; scripts only inventory, protect source hashes and verify scope.
// Two profiles share this machinery: item-descriptions-v1 (public descriptions only) and
// item-knowledge-v1 (public and master-only knowledge split, title frozen, master notes kept).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readStructure, listSheets } from '../../../../../scripts/lib/subjects.mjs';
import { parseFrontmatter, toCommentMetadata } from '../../../../../scripts/lib/frontmatter.mjs';

const DRAFT = '.campaign/state/write/draft';
const DEFAULT = 'item-descriptions-v1';
const PROFILES = {
  'item-descriptions-v1': { state: '.campaign/state/update/item-descriptions.json', stageError: descriptionsStageError, verifyError: descriptionsVerifyError },
  'item-knowledge-v1': { state: '.campaign/state/update/item-knowledge.json', stageError: knowledgeStageError, verifyError: knowledgeVerifyError },
};
const hash = (s) => createHash('sha256').update(s).digest('hex');
// Source fingerprint: the same for both metadata forms, so converting the block is not an edit.
const sourceHash = (text) => hash(toCommentMetadata(text) ?? text);
// Fingerprint an inventory saved by an older version held: the plain hash of the dashes form.
const legacyHash = (text) => hash(dashesForm(text));
function dashesForm(text) {
  if (parseFrontmatter(text).format !== 'comment') return text;
  const lines = text.split('\n');
  const close = lines.findIndex((line, i) => i > 0 && line.replace(/\r$/, '') === '-->');
  lines[0] = lines[0].replace('<!-- yllir', '---');
  if (close > 0) lines[close] = lines[close].replace('-->', '---');
  return lines.join('\n');
}
function profile(migration = DEFAULT) {
  const p = PROFILES[migration];
  if (!p) throw new Error(`unknown item migration: ${migration}`);
  return { id: migration, ...p };
}

export function prepareItemDescriptions(root, { persist = true, migration = DEFAULT } = {}) {
  root = path.resolve(root);
  const { structure, errors } = readStructure(root);
  if (!structure) return { status: 'failed', items: [], errors };
  const items = [], seen = new Set();
  for (const category of structure.filter((c) => c.type === 'objects')) for (const file of listSheets(root, category.folder)) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      const full = path.join(root, file);
      if (fs.lstatSync(full).isSymbolicLink()) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (parseFrontmatter(text).data?.template !== 'item') continue;
      items.push({ file, source: sourceHash(text), status: 'pending', legacy: legacyHash(text) });
    } catch (e) { errors.push({ file, message: e.message }); }
  }
  const state = readState(root, migration);
  const previous = new Map((state.items ?? []).map((x) => [x.file, x]));
  const moved = movedRecords(root, state.items ?? [], items, previous);
  const queue = items.map((item) => {
    let old = previous.get(item.file) ?? moved.get(item.file);
    if (old && old.source === item.legacy && old.source !== item.source) old = { ...old, source: item.source };
    if (old?.status === 'complete' && old.source === item.source) return { ...old };
    if (old?.status === 'changed' && old.source !== item.source) return { ...old, current_source: item.source };
    if (old?.source && old.source !== item.source) return { ...old, status: 'changed', current_source: item.source };
    if (old?.status === 'pending' && old.source === item.source) return { ...old };
    return item;
  }).map(({ legacy, ...rest }) => rest);
  if (persist) writeState(root, { migration_id: migration, items: queue }, migration);
  return { status: errors.length ? 'failed' : queue.some((x) => x.status !== 'complete') ? 'pending' : 'complete', items: queue, errors };
}

export function stageItemDescriptionDraft(root, file, content, migration = DEFAULT) {
  root = path.resolve(root);
  const inventory = prepareItemDescriptions(root, { migration });
  const item = inventory.items.find((x) => x.file === file);
  if (!item || item.status === 'changed') return { status: 'failed', errors: [{ code: 'source-changed', file }] };
  const original = fs.readFileSync(path.join(root, file), 'utf8');
  const code = profile(migration).stageError(original, content);
  if (code) return { status: 'failed', errors: [{ code, file }] };
  const dest = path.resolve(root, DRAFT, file);
  if (!dest.startsWith(`${path.resolve(root, DRAFT)}${path.sep}`)) return { status: 'failed', errors: [{ code: 'unsafe-path', file }] };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf8');
  const state = readState(root, migration); const record = state.items.find((x) => x.file === file);
  record.draft = hash(content); writeState(root, state, migration);
  return { status: 'staged', file, source: item.source, draft: hash(content) };
}

/** Explicitly reopen a source-changed item after the runner has reread the master's edit. */
export function refreshChangedItem(root, file, migration = DEFAULT) {
  root = path.resolve(root);
  const state = readState(root, migration), item = state.items.find((entry) => entry.file === file);
  if (!item || item.status !== 'changed') return { status: 'failed', errors: [{ code: 'item-not-changed', file }] };
  const full = path.resolve(root, file);
  if (!full.startsWith(`${root}${path.sep}`) || !fs.existsSync(full)) return { status: 'failed', errors: [{ code: 'source-unavailable', file }] };
  const current = fs.readFileSync(full, 'utf8');
  if (sourceHash(current) !== item.current_source) return { status: 'failed', errors: [{ code: 'source-changed-again', file }] };
  const draft = path.resolve(root, DRAFT, file);
  if (draft.startsWith(`${path.resolve(root, DRAFT)}${path.sep}`)) fs.rmSync(draft, { force: true });
  item.source = item.current_source; item.status = 'pending'; delete item.current_source; delete item.draft; delete item.reviewed;
  writeState(root, state, migration);
  return { status: 'pending', file, source: item.source };
}

export function verifyItemDescriptionDrafts(root, files, migration = DEFAULT) {
  root = path.resolve(root);
  const state = readState(root, migration), errors = [];
  for (const file of files) {
    const item = state.items?.find((x) => x.file === file);
    try {
      const before = fs.readFileSync(path.join(root, file), 'utf8');
      const after = fs.readFileSync(path.resolve(root, DRAFT, file), 'utf8');
      if (!item || sourceHash(before) !== item.source) errors.push({ code: 'source-changed', file });
      else {
        const code = profile(migration).verifyError(before, after);
        if (code) errors.push({ code, file });
        else { item.draft = hash(after); item.draft_verified = true; }
      }
    } catch (e) { errors.push({ code: 'draft-unavailable', file, message: e.message }); }
  }
  if (!errors.length) writeState(root, state, migration);
  return { status: errors.length ? 'failed' : 'verified', errors };
}

export function completeItemDescriptions(root, files = [], migration = DEFAULT) {
  root = path.resolve(root);
  const state = readState(root, migration);
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) return { status: 'pending', errors: [{ code: 'unverified-publication', file }] };
    const text = fs.readFileSync(full, 'utf8');
    const item = state.items.find((x) => x.file === file);
    if (!item?.draft_verified || !item.draft || hash(text) !== item.draft || !hasBriefAndDescription(text)) return { status: 'pending', errors: [{ code: 'unverified-publication', file }] };
    item.source = sourceHash(text); item.status = 'complete';
  }
  writeState(root, state, migration);
  const remaining = state.items.filter((x) => x.status !== 'complete');
  return { status: remaining.length ? 'pending' : 'complete', items: state.items, errors: [] };
}

/** Store the separate semantic verdict for an unchanged public description. */
export function acceptUnchangedItem(root, file, reason, migration = DEFAULT) {
  root = path.resolve(root);
  const state = readState(root, migration), item = state.items.find((entry) => entry.file === file);
  if (!item || item.status !== 'pending' || typeof reason !== 'string' || reason.trim().length < 12) return { status: 'failed', errors: [{ code: 'invalid-unchanged-review', file }] };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (sourceHash(source) !== item.source || !hasBriefAndDescription(source)) return { status: 'failed', errors: [{ code: 'source-changed-or-incomplete', file }] };
  item.draft = hash(source); item.draft_verified = true; item.semantic_review = 'accepted-unchanged'; item.review_reason = reason.trim();
  writeState(root, state, migration);
  return { status: 'reviewed-unchanged', file, source: item.source };
}

/**
 * A saved record whose file is gone and whose source bytes equal one new item is that item after a
 * move (for example a geographic migration). It is reused only when it is the single match on both
 * sides; any other case stays a new pending item.
 */
function movedRecords(root, saved, items, previous) {
  const gone = saved.filter((x) => x.source && !fs.existsSync(path.join(root, x.file)));
  const newItems = items.filter((item) => !previous.has(item.file));
  const moved = new Map();
  for (const item of newItems) {
    const sameSource = gone.filter((x) => x.source === item.source);
    const newWithSameSource = newItems.filter((other) => other.source === item.source);
    if (sameSource.length === 1 && newWithSameSource.length === 1) moved.set(item.file, { ...sameSource[0], file: item.file });
  }
  return moved;
}

function scopeOutsideDescriptions(text) { return text.replace(sectionRegex(), ''); }
function sectionRegex() { return /^## (?:In breve|In brief|Brief|Description|Descrizione)\s*\n[\s\S]*?(?=^## |^<!-- master -->|$(?![\s\S]))/gim; }
function hasBriefAndDescription(text) { return /^## (?:In breve|In brief|Brief)\s*\n\s*\S/im.test(text) && /^## (?:Descrizione|Description)\s*\n\s*\S/im.test(text); }
function containsReserved(text) { return /<!-- master -->[\s\S]*?<!-- \/master -->/.exec(text)?.[0] ?? ''; }

// Scope checks per profile: each returns an error code, or null when the draft is acceptable.
function descriptionsStageError(before, after) {
  return scopeOutsideDescriptions(before) !== scopeOutsideDescriptions(after) ? 'outside-description-changed' : null;
}
function descriptionsVerifyError(before, after) {
  if (scopeOutsideDescriptions(before) !== scopeOutsideDescriptions(after)) return 'outside-description-changed';
  if (!hasBriefAndDescription(after)) return 'description-sections-missing';
  if (containsReserved(before) !== containsReserved(after)) return 'reserved-block-changed';
  return null;
}
function knowledgeStageError(before, after) {
  return head(before) !== head(after) ? 'head-changed' : null;
}
function knowledgeVerifyError(before, after) {
  if (head(before) !== head(after)) return 'head-changed';
  if (!hasBriefAndDescription(after) || !hasEffects(after)) return 'public-sections-missing';
  if (!hasSingleMasterBlockAtEnd(after)) return 'master-block-invalid';
  const oldLines = lines(containsReserved(before)), newLines = new Set(lines(containsReserved(after)));
  if (oldLines.some((line) => !newLines.has(line))) return 'master-notes-lost';
  return null;
}
/** Everything before the first "## " heading: the metadata block and the "#" title. */
function head(text) { return text.split(/^## /m)[0]; }
/** The Effects section has at least one non-blank line before the next heading or the master block. */
function hasEffects(text) {
  const body = /^## (?:Effetti|Effects)[ \t]*\n([\s\S]*?)(?=^## |^<!-- master -->|$(?![\s\S]))/im.exec(text)?.[1] ?? '';
  return body.trim() !== '';
}
function hasSingleMasterBlockAtEnd(text) {
  const open = '<!-- master -->', close = '<!-- /master -->';
  if (text.split(open).length - 1 !== 1 || text.split(close).length - 1 !== 1) return false;
  if (text.indexOf(open) > text.indexOf(close)) return false;
  return text.slice(text.indexOf(close) + close.length).trim() === '';
}
function lines(text) { return text.split('\n').map((line) => line.trim()).filter(Boolean); }

function readState(root, migration = DEFAULT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, profile(migration).state), 'utf8')); } catch { return { items: [] }; }
}
function writeState(root, value, migration = DEFAULT) {
  const f = path.join(root, profile(migration).state);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(value, null, 2)}\n`);
}
