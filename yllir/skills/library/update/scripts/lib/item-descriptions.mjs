// Resumable inventory and verification for the semantic item-description update.
// The model writes drafts; scripts only inventory, protect source hashes and verify scope.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readStructure, listSheets } from '../../../../../scripts/lib/subjects.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';

const STATE = '.campaign/state/update/item-descriptions.json';
const DRAFT = '.campaign/state/write/draft';
const hash = (s) => createHash('sha256').update(s).digest('hex');

export function prepareItemDescriptions(root, { persist = true } = {}) {
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
      items.push({ file, source: hash(text), status: 'pending' });
    } catch (e) { errors.push({ file, message: e.message }); }
  }
  const state = readState(root);
  const previous = new Map((state.items ?? []).map((x) => [x.file, x]));
  const moved = movedRecords(root, state.items ?? [], items, previous);
  const queue = items.map((item) => {
    const old = previous.get(item.file) ?? moved.get(item.file);
    if (old?.status === 'complete' && old.source === item.source) return { ...old };
    if (old?.status === 'changed' && old.source !== item.source) return { ...old, current_source: item.source };
    if (old?.source && old.source !== item.source) return { ...old, status: 'changed', current_source: item.source };
    if (old?.status === 'pending' && old.source === item.source) return { ...old };
    return item;
  });
  if (persist) writeState(root, { migration_id: 'item-descriptions-v1', items: queue });
  return { status: errors.length ? 'failed' : queue.some((x) => x.status !== 'complete') ? 'pending' : 'complete', items: queue, errors };
}

export function stageItemDescriptionDraft(root, file, content) {
  root = path.resolve(root);
  const inventory = prepareItemDescriptions(root);
  const item = inventory.items.find((x) => x.file === file);
  if (!item || item.status === 'changed') return { status: 'failed', errors: [{ code: 'source-changed', file }] };
  const original = fs.readFileSync(path.join(root, file), 'utf8');
  if (scopeOutsideDescriptions(original) !== scopeOutsideDescriptions(content)) return { status: 'failed', errors: [{ code: 'outside-description-changed', file }] };
  const dest = path.resolve(root, DRAFT, file);
  if (!dest.startsWith(`${path.resolve(root, DRAFT)}${path.sep}`)) return { status: 'failed', errors: [{ code: 'unsafe-path', file }] };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf8');
  const state = readState(root); const record = state.items.find((x) => x.file === file);
  record.draft = hash(content); writeState(root, state);
  return { status: 'staged', file, source: item.source, draft: hash(content) };
}

/** Explicitly reopen a source-changed item after the runner has reread the master's edit. */
export function refreshChangedItem(root, file) {
  root = path.resolve(root);
  const state = readState(root), item = state.items.find((entry) => entry.file === file);
  if (!item || item.status !== 'changed') return { status: 'failed', errors: [{ code: 'item-not-changed', file }] };
  const full = path.resolve(root, file);
  if (!full.startsWith(`${root}${path.sep}`) || !fs.existsSync(full)) return { status: 'failed', errors: [{ code: 'source-unavailable', file }] };
  const current = fs.readFileSync(full, 'utf8');
  if (hash(current) !== item.current_source) return { status: 'failed', errors: [{ code: 'source-changed-again', file }] };
  const draft = path.resolve(root, DRAFT, file);
  if (draft.startsWith(`${path.resolve(root, DRAFT)}${path.sep}`)) fs.rmSync(draft, { force: true });
  item.source = item.current_source; item.status = 'pending'; delete item.current_source; delete item.draft; delete item.reviewed;
  writeState(root, state);
  return { status: 'pending', file, source: item.source };
}

export function verifyItemDescriptionDrafts(root, files) {
  root = path.resolve(root);
  const state = readState(root), errors = [];
  for (const file of files) {
    const item = state.items?.find((x) => x.file === file);
    try {
      const before = fs.readFileSync(path.join(root, file), 'utf8');
      const after = fs.readFileSync(path.resolve(root, DRAFT, file), 'utf8');
      if (!item || hash(before) !== item.source) errors.push({ code: 'source-changed', file });
      else if (scopeOutsideDescriptions(before) !== scopeOutsideDescriptions(after)) errors.push({ code: 'outside-description-changed', file });
      else if (!hasBriefAndDescription(after)) errors.push({ code: 'description-sections-missing', file });
      else if (containsReserved(before) !== containsReserved(after)) errors.push({ code: 'reserved-block-changed', file });
      else { item.draft = hash(after); item.draft_verified = true; }
    } catch (e) { errors.push({ code: 'draft-unavailable', file, message: e.message }); }
  }
  if (!errors.length) writeState(root, state);
  return { status: errors.length ? 'failed' : 'verified', errors };
}

export function completeItemDescriptions(root, files = []) {
  root = path.resolve(root);
  const state = readState(root);
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) return { status: 'pending', errors: [{ code: 'unverified-publication', file }] };
    const text = fs.readFileSync(full, 'utf8');
    const item = state.items.find((x) => x.file === file);
    if (!item?.draft_verified || !item.draft || hash(text) !== item.draft || !hasBriefAndDescription(text)) return { status: 'pending', errors: [{ code: 'unverified-publication', file }] };
    item.source = hash(text); item.status = 'complete';
  }
  writeState(root, state);
  const remaining = state.items.filter((x) => x.status !== 'complete');
  return { status: remaining.length ? 'pending' : 'complete', items: state.items, errors: [] };
}

/** Store the separate semantic verdict for an unchanged public description. */
export function acceptUnchangedItem(root, file, reason) {
  root = path.resolve(root);
  const state = readState(root), item = state.items.find((entry) => entry.file === file);
  if (!item || item.status !== 'pending' || typeof reason !== 'string' || reason.trim().length < 12) return { status: 'failed', errors: [{ code: 'invalid-unchanged-review', file }] };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (hash(source) !== item.source || !hasBriefAndDescription(source)) return { status: 'failed', errors: [{ code: 'source-changed-or-incomplete', file }] };
  item.draft = hash(source); item.draft_verified = true; item.semantic_review = 'accepted-unchanged'; item.review_reason = reason.trim();
  writeState(root, state);
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
function readState(root) { try { return JSON.parse(fs.readFileSync(path.join(root, STATE), 'utf8')); } catch { return { items: [] }; } }
function writeState(root, value) { const f = path.join(root, STATE); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(value, null, 2)}\n`); }
