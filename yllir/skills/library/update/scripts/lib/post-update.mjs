// Plans the resumable statistics-table migration performed after framework
// alignment. Campaign documents are only staged as write-sequence drafts here.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { inspectStatisticsTables, convertStatisticsTables } from '../../../../../scripts/lib/statistics-tables.mjs';
import { listSheets, readStructure } from '../../../../../scripts/lib/subjects.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';

const DRAFT_ROOT = '.campaign/state/write/draft';
const MANIFEST_PATH = '.campaign/state/update/sheet-drafts.json';
const TEMPLATE_TYPES = new Set(['npc', 'vendor', 'enemy', 'creature']);
const CATEGORY_TYPES = new Set(['subjects', 'places', 'objects', 'free', 'master-only']);

/**
 * Find candidate sheets and optionally stage deterministic conversions.
 * Staging writes only ignored draft files. It never edits campaign documents.
 */
export function preparePostUpdate(root, { writeDrafts = false } = {}) {
  root = path.resolve(root);
  const { structure, errors: structureErrors } = readStructure(root);
  if (structure === null) return { status: 'failed', drafted: [], pending: [], candidates: [], errors: structureErrors };
  const language = readLanguage(root);
  if (!['it', 'en'].includes(language)) {
    return {
      status: 'pending', drafted: [], pending: [], candidates: [],
      errors: [{ code: 'unsupported-language', message: `statistics migration is not defined for campaign language ${language}` }],
    };
  }
  const drafted = [];
  const pending = [];
  const candidates = [];
  const errors = [];
  const manifest = readManifest(root);
  const seen = new Set();

  for (const category of structure) {
    if (!CATEGORY_TYPES.has(category.type) || typeof category.folder !== 'string') continue;
    for (const file of listSheets(root, category.folder)) {
      if (seen.has(file)) continue;
      seen.add(file);
      const full = path.join(root, file);
      try {
        if (fs.lstatSync(full).isSymbolicLink()) continue;
        const text = fs.readFileSync(full, 'utf8');
        const frontmatter = parseFrontmatter(text);
        if (!TEMPLATE_TYPES.has(frontmatter.data?.template)) continue;
        const inspected = inspectStatisticsTables(text, language);
        if (inspected.status === 'none') continue;
        const sourceHash = createHash('sha256').update(text).digest('hex');
        if (writeDrafts && manifest[file]?.source !== undefined && manifest[file].source !== sourceHash) {
          errors.push({ code: 'source-changed', file, message: 'the sheet changed after its migration draft was staged' });
          continue;
        }
        candidates.push(file);
        const converted = convertStatisticsTables(text, language);
        const expected = converted.convertedCount > 0 ? converted.markdown : text;
        if (writeDrafts) stageDraft(root, file, expected, manifest[file]?.source === sourceHash);
        manifest[file] = { source: sourceHash, draft: createHash('sha256').update(expected).digest('hex') };
        if (converted.convertedCount > 0) {
          drafted.push(file);
        }
        if (converted.status === 'pending' || converted.convertedCount === 0) {
          pending.push({ file, tables: converted.pending ?? inspected.tables.filter((table) => table.classification === 'ambiguous') });
        }
      } catch (err) {
        errors.push({ code: 'sheet-inspection-failed', file, message: err.message });
      }
    }
  }
  if (writeDrafts && candidates.length > 0) {
    const manifestPath = path.join(root, MANIFEST_PATH);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return {
    status: errors.length > 0 ? 'failed' : drafted.length > 0 || pending.length > 0 ? 'pending' : 'complete',
    drafted,
    pending,
    candidates,
    errors,
  };
}

/** Reject staged drafts whose source changed or that altered bytes outside statistics sections. */
export function verifyPostUpdateDrafts(root, files) {
  root = path.resolve(root);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), 'utf8')); }
  catch (err) { return { status: 'failed', errors: [{ code: 'missing-manifest', message: err.message }] }; }
  const errors = [];
  const pairs = [];
  for (const file of files) {
    const source = path.join(root, file);
    const draft = path.resolve(root, DRAFT_ROOT, file);
    try {
      if (createHash('sha256').update(fs.readFileSync(source)).digest('hex') !== manifest[file]?.source) {
        errors.push({ code: 'source-changed', file, message: 'the sheet changed after the migration draft was prepared' });
        continue;
      }
      pairs.push({ file, before: fs.readFileSync(source, 'utf8'), after: fs.readFileSync(draft, 'utf8') });
    } catch (err) {
      errors.push({ code: 'draft-unavailable', file, message: err.message });
    }
  }
  for (const { file, before, after } of pairs) {
    const oldSections = inspectStatisticsTables(before, readLanguage(root)).sections;
    const newSections = inspectStatisticsTables(after, readLanguage(root)).sections;
    if (outsideRanges(before, oldSections) !== outsideRanges(after, newSections)) {
      errors.push({ code: 'outside-statistics-changed', file, message: 'bytes outside Statistics sections changed' });
      continue;
    }
    const oldNumbers = numericTokens(oldSections.map((section) => section.source).join('\n'));
    const newNumbers = numericTokens(newSections.map((section) => section.source).join('\n'));
    if (!containsTokens(newNumbers, oldNumbers)) {
      errors.push({ code: 'statistics-value-lost', file, message: 'a numeric value from the original Statistics section is missing' });
    }
    const remaining = inspectStatisticsTables(after, readLanguage(root));
    if (remaining.status !== 'none') {
      errors.push({ code: 'legacy-statistics-remain', file, message: 'the draft still contains an ambiguous or old-format Statistics block' });
    }
  }
  return { status: errors.length === 0 ? 'verified' : 'failed', errors };
}

/**
 * The guided part is finished only after a full re-scan finds no old table block.
 * It writes no state: update-campaign.mjs records the result.
 */
export function completePostUpdate(root) {
  root = path.resolve(root);
  const scan = preparePostUpdate(root);
  if (scan.status === 'failed') return scan;
  if (scan.status === 'pending') return { ...scan, status: 'pending' };
  return { ...scan, status: 'complete' };
}

function stageDraft(root, file, content, owned) {
  const target = path.resolve(root, DRAFT_ROOT, file);
  const base = path.resolve(root, DRAFT_ROOT);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error(`unsafe draft path: ${file}`);
  if (fs.existsSync(target)) {
    if (owned || fs.readFileSync(target, 'utf8') === content) return;
    throw new Error(`an unrelated draft already exists for ${file}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function readManifest(root) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function outsideRanges(text, ranges) {
  const ordered = [...ranges].sort((a, b) => a.start - b.start);
  const pieces = [];
  let cursor = 0;
  for (const range of ordered) {
    if (range.start < cursor) continue;
    pieces.push(text.slice(cursor, range.start));
    cursor = range.end;
  }
  pieces.push(text.slice(cursor));
  return pieces.join('');
}

function numericTokens(text) {
  return text.match(/\b\d+(?:[.,]\d+)?\b/g) ?? [];
}

function containsTokens(haystack, needles) {
  const remaining = [...haystack];
  for (const token of needles) {
    const index = remaining.indexOf(token);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}

function readLanguage(root) {
  try {
    const parsed = parseYamlLite(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8'));
    return parsed.errors.length === 0 && typeof parsed.data?.language?.main === 'string'
      ? parsed.data.language.main
      : 'en';
  } catch {
    return 'en';
  }
}
