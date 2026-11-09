// Measures how big and risky a set of drafted campaign changes is, before the
// write sequence decides how many checks to run. Deterministic: it only reads
// files, never calls an agent or the network. Each measure has a level (low,
// medium, high); the level of the change is the highest of them, and
// `decidedBy` names the measures that reach it.

import fs from 'node:fs';
import path from 'node:path';
import {
  readStructure,
  masterOnlyChecker,
  buildSubjectIndex,
  compareStrings,
} from '../../../../../scripts/lib/subjects.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { analyzeMarkdown } from '../../../../../scripts/lib/zones.mjs';
import { foldForm } from '../../../../../scripts/lib/fold.mjs';
import { findSubject } from '../../../../library/npc-manager/scripts/lib/find-subject.mjs';

/** Every number used to choose a level. Tune them here. */
export const THRESHOLDS = Object.freeze({
  size: {
    newLow: 40, // non-blank lines of a new document
    newMedium: 120,
    existingLowChanged: 6, // changed lines (added + removed) of an existing document
    existingLowRatio: 0.2, // changed / non-blank lines of the old text
    existingMediumChanged: 30,
    existingMediumRatio: 0.5,
  },
  breadth: {
    lowDocuments: 1, // low when there is one document and at most lowSubjects subjects
    lowSubjects: 1,
    mediumDocuments: 3,
    mediumSubjects: 3,
  },
  reach: {
    lowMax: 0, // mentions up to this count are low
    mediumMax: 3, // up to this count medium, above it high
  },
  minFormLength: 3, // shorter forms are ignored by reach and homonym
});

const RANK = { low: 0, medium: 1, high: 2 };
const KNOWN_TYPES = new Set([
  'subjects',
  'places',
  'objects',
  'free',
  'master-only',
  'external',
  'plot',
  'chronicle',
]);
const HIGH_TYPES = new Set(['plot', 'chronicle']);

/**
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {{ files: string[], draftDir: string, subjects?: string[] }} input
 *   files: campaign-relative documents; drafts are read from `<draftDir>/<file>`
 *   subjects: ids of the subjects the change touches (only counted)
 * @returns {{ level: string, decidedBy: string[], measures: Array<{name: string, value: string|number, level: string}>, reach: string[] }}
 */
export function classifyWrite(campaignRoot, { files, draftDir, subjects } = {}) {
  const root = path.resolve(String(campaignRoot ?? ''));
  const draftRoot = typeof draftDir === 'string' && draftDir !== '' ? path.resolve(draftDir) : null;
  const structure = readStructure(root).structure ?? [];
  const records = loadRecords(root, draftRoot, Array.isArray(files) ? files : []);

  const ctx = {
    root,
    structure,
    records,
    subjectCount: Array.isArray(subjects) ? subjects.length : 0,
    reachFiles: [],
    indexCache: undefined,
  };
  // The subject index is built once, and only by the measures that need it.
  ctx.index = () => {
    if (ctx.indexCache === undefined) ctx.indexCache = buildSubjectIndex(root);
    return ctx.indexCache;
  };

  const measures = [
    runMeasure('draft', () => draftMeasure(ctx)),
    runMeasure('size', () => sizeMeasure(ctx)),
    runMeasure('breadth', () => breadthMeasure(ctx)),
    runMeasure('reach', () => reachMeasure(ctx)),
    runMeasure('content', () => contentMeasure(ctx)),
    runMeasure('privacy', () => privacyMeasure(ctx)),
    runMeasure('homonym', () => homonymMeasure(ctx)),
  ];

  let level = 'low';
  for (const measure of measures) {
    if (RANK[measure.level] > RANK[level]) level = measure.level;
  }
  const decidedBy = measures.filter((measure) => measure.level === level).map((measure) => measure.name);

  return { level, decidedBy, measures, reach: ctx.reachFiles };
}

/** Runs one measure; a throw becomes a high measure with the error (fail-safe). */
function runMeasure(name, fn) {
  try {
    const { value, level } = fn();
    return { name, value, level };
  } catch (err) {
    return { name, value: `error: ${err?.message ?? String(err)}`, level: 'high' };
  }
}

// ---------------------------------------------------------------------------
// Loading

/**
 * One record per distinct document. A record has: rel (campaign-relative path),
 * problem ('invalid' | 'missing' | null), draftText, oldText (null for a new
 * document), isNew, draft and old (parsed frontmatter), diff (existing documents
 * with a draft), and filled in later by the size measure: changed, sizeLevel.
 */
function loadRecords(root, draftRoot, files) {
  const records = [];
  const seen = new Set();

  for (const raw of files) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const rel = path.posix.normalize(raw.trim());
    if (seen.has(rel)) continue;
    seen.add(rel);

    const invalid =
      rel === '.' || rel === '..' || rel.startsWith('../') || path.posix.isAbsolute(rel);
    const draftText = invalid || draftRoot === null ? null : readIfFile(path.join(draftRoot, rel));
    const oldText = invalid ? null : readIfFile(path.join(root, rel));
    const isNew = oldText === null;

    let problem = null;
    if (invalid) problem = 'invalid';
    else if (draftText === null) problem = 'missing';

    const record = {
      rel,
      problem,
      draftText,
      oldText,
      isNew,
      draft: draftText === null ? null : parseFrontmatter(draftText),
      old: oldText === null ? null : parseFrontmatter(oldText),
      diff: null,
      changed: 0,
      sizeLevel: null,
    };
    if (draftText !== null && oldText !== null) record.diff = diffLines(draftText, oldText);
    records.push(record);
  }
  return records;
}

/** File content, or null when the path is not a regular file or cannot be read. */
function readIfFile(full) {
  if (full === null) return null;
  try {
    if (!fs.statSync(full).isFile()) return null;
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

/** Non-blank lines, trimmed. */
function linesOf(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Multiset comparison of the non-blank lines of the draft and the old text.
 * `added` holds the draft lines with no remaining equal old line; `removed` is
 * the number of old lines with no remaining equal draft line.
 */
function diffLines(draftText, oldText) {
  const oldLines = linesOf(oldText);
  const remaining = new Map();
  for (const line of oldLines) remaining.set(line, (remaining.get(line) ?? 0) + 1);

  const added = [];
  for (const line of linesOf(draftText)) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) remaining.set(line, count - 1);
    else added.push(line);
  }
  let removed = 0;
  for (const count of remaining.values()) removed += count;

  return { added, removed, oldNonBlank: oldLines.length };
}

/** Title and aliases of a parsed draft, as raw texts. */
function draftFormTexts(record) {
  const parsed = record.draft;
  const title = titleOf(parsed, record.rel);
  const aliases = Array.isArray(parsed.data?.aliases) ? parsed.data.aliases.map(String) : [];
  return [title, ...aliases];
}

/** First level-1 heading of the body, or the file name without `.md`. */
function titleOf(parsed, rel) {
  const first = analyzeMarkdown(parsed.body, parsed.bodyStartLine).lines.find(
    (line) => line.block === 'heading' && line.level === 1,
  );
  if (first !== undefined && typeof first.headingText === 'string' && first.headingText.trim() !== '') {
    return first.headingText.trim();
  }
  return path.posix.basename(rel, '.md');
}

/** Name folded for matching: accents and case removed, every non-letter/digit run is one space. */
function normalizeName(text) {
  return foldForm(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Normalized forms of the given texts, without duplicates and too-short ones. */
function usableForms(texts) {
  const forms = new Set();
  for (const text of texts) {
    const form = normalizeName(text);
    if (form.length >= THRESHOLDS.minFormLength) forms.add(form);
  }
  return forms;
}

// ---------------------------------------------------------------------------
// Measures. Each returns { value, level }.

/** Missing or invalid drafts. */
function draftMeasure(ctx) {
  const problems = ctx.records
    .filter((record) => record.problem !== null)
    .map((record) => `${record.problem}: ${record.rel}`);
  if (problems.length === 0) return { value: 'ok', level: 'low' };
  return { value: problems.join('; '), level: 'high' };
}

/** Changed lines of all documents; a level per document is kept for the other measures. */
function sizeMeasure(ctx) {
  const t = THRESHOLDS.size;
  let total = 0;
  let level = 'low';

  for (const record of ctx.records) {
    if (record.draftText === null) continue;

    if (record.isNew) {
      const count = linesOf(record.draftText).length;
      record.changed = count;
      record.sizeLevel = count <= t.newLow ? 'low' : count <= t.newMedium ? 'medium' : 'high';
    } else {
      const { added, removed, oldNonBlank } = record.diff;
      const changed = added.length + removed;
      const ratio = changed / Math.max(1, oldNonBlank);
      record.changed = changed;
      if (changed <= t.existingLowChanged && ratio <= t.existingLowRatio) record.sizeLevel = 'low';
      else if (changed <= t.existingMediumChanged && ratio <= t.existingMediumRatio) record.sizeLevel = 'medium';
      else record.sizeLevel = 'high';
    }

    total += record.changed;
    if (RANK[record.sizeLevel] > RANK[level]) level = record.sizeLevel;
  }
  return { value: total, level };
}

/** How many documents and subjects the change touches. */
function breadthMeasure(ctx) {
  const t = THRESHOLDS.breadth;
  const documents = ctx.records.length;
  const subjects = ctx.subjectCount;
  let level;
  if (documents === t.lowDocuments && subjects <= t.lowSubjects) level = 'low';
  else if (documents <= t.mediumDocuments && subjects <= t.mediumSubjects) level = 'medium';
  else level = 'high';
  return { value: `${documents}+${subjects}`, level };
}

/** Other campaign documents that mention a subject the change is about. */
function reachMeasure(ctx) {
  const t = THRESHOLDS.reach;
  const texts = [];
  const documents = new Set(ctx.records.map((record) => record.rel));

  for (const record of ctx.records) {
    if (record.draftText === null) continue;
    texts.push(...draftFormTexts(record));
    if (!record.isNew) {
      for (const subject of ctx.index().subjects) {
        if (subject.sheet !== record.rel) continue;
        for (const form of subject.forms) texts.push(form.text);
      }
    }
  }
  const forms = usableForms(texts);

  const mentioning = [];
  if (forms.size > 0) {
    for (const rel of listMarkdown(ctx.root)) {
      if (documents.has(rel)) continue;
      const text = readIfFile(path.join(ctx.root, rel));
      if (text === null) continue;
      const padded = ` ${normalizeName(text)} `;
      for (const form of forms) {
        if (padded.includes(` ${form} `)) {
          mentioning.push(rel);
          break;
        }
      }
    }
  }
  ctx.reachFiles = mentioning.sort(compareStrings);

  let level;
  const count = ctx.reachFiles.length;
  if (count <= t.lowMax) level = 'low';
  else if (count <= t.mediumMax) level = 'medium';
  else level = 'high';

  // Cap: when no document is new and every existing document is only a small
  // change, the mentions alone do not make the change high.
  const onlySmall = ctx.records.every(
    (record) => record.draftText === null || (!record.isNew && record.sizeLevel === 'low'),
  );
  if (onlySmall && level === 'high') level = 'medium';

  return { value: count, level };
}

/** Every Markdown file under the campaign root, except .git and the top-level .campaign. */
function listMarkdown(root) {
  const found = [];
  const visited = new Set();

  const walk = (dir, relDir) => {
    let real;
    try {
      real = fs.realpathSync(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.name === '.git' || rel === '.campaign') continue;
      const full = path.join(dir, entry.name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue; // broken link
      }
      if (stat.isDirectory()) walk(full, rel);
      else if (stat.isFile() && entry.name.endsWith('.md')) found.push(rel);
    }
  };

  walk(root, '');
  return found.sort(compareStrings);
}

/** Kinds of the documents: the category type decides the level. */
function contentMeasure(ctx) {
  const kinds = [];
  let level = 'low';
  const raise = (to) => {
    if (RANK[to] > RANK[level]) level = to;
  };

  for (const record of ctx.records) {
    if (record.draftText === null) continue;

    const category = categoryOf(ctx.structure, record.rel);
    if (record.rel === 'campaign.yaml') {
      kinds.push('config');
      raise('high');
    } else if (category === null || typeof category.type !== 'string' || !KNOWN_TYPES.has(category.type)) {
      kinds.push('unknown');
      raise('high');
    } else {
      kinds.push(category.type);
      raise(HIGH_TYPES.has(category.type) ? 'high' : 'low');
    }

    if (!record.isNew) {
      if (frontmatterBlock(record.draftText) !== frontmatterBlock(record.oldText)) {
        kinds.push('frontmatter');
        raise('medium');
      }
      if (record.diff.added.some((line) => /\b\d{3,4}\b/.test(line))) {
        kinds.push('date');
        raise('medium');
      }
    }
  }
  return { value: [...new Set(kinds)].join(','), level };
}

/** Category of a campaign-relative path: the one with the longest folder that is a prefix of it. */
function categoryOf(structure, rel) {
  let best = null;
  let bestLength = -1;
  for (const entry of structure) {
    if (typeof entry.folder !== 'string') continue;
    const folder = path.posix.normalize(entry.folder).replace(/\/+$/, '');
    const prefix = folder === '.' || folder === '' ? '' : `${folder}/`;
    if (rel.startsWith(prefix) && prefix.length > bestLength) {
      best = entry;
      bestLength = prefix.length;
    }
  }
  return best;
}

/** Text between the frontmatter delimiters ('' when there is none). */
function frontmatterBlock(text) {
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (lines[0] !== '---') return '';
  const close = lines.indexOf('---', 1);
  return (close === -1 ? lines.slice(1) : lines.slice(1, close)).join('\n');
}

/** Master-only documents are high; a `<!-- master -->` block is medium. */
function privacyMeasure(ctx) {
  const isMasterOnly = masterOnlyChecker(ctx.structure);
  let masterBlock = false;
  let masterOnly = false;

  for (const record of ctx.records) {
    if (record.draftText === null) continue;
    if (isMasterOnly(record.rel)) masterOnly = true;
    if (linesOf(record.draftText).includes('<!-- master -->')) masterBlock = true;
  }
  if (masterOnly) return { value: 'masteronly', level: 'high' };
  if (masterBlock) return { value: 'masterblock', level: 'medium' };
  return { value: 'none', level: 'low' };
}

/** Subjects of the campaign that a draft title or alias matches, other than the document itself. */
function homonymMeasure(ctx) {
  const matched = new Set();

  for (const record of ctx.records) {
    if (record.draftText === null) continue;
    const ownId = record.draft.data?.id ?? record.old?.data?.id;
    const seen = new Set();
    for (const text of draftFormTexts(record)) {
      const form = normalizeName(text);
      if (form.length < THRESHOLDS.minFormLength || seen.has(form)) continue;
      seen.add(form);
      for (const match of findSubject(ctx.root, text).matches) {
        if (match.id === ownId) continue;
        matched.add(match.id);
      }
    }
  }

  if (matched.size > 0) return { value: `${matched.size} matches`, level: 'high' };
  return { value: '0 matches', level: 'low' };
}
