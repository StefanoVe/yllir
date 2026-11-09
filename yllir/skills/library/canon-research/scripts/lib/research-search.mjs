// Searches a campaign for a list of terms: the subjects they name, every line of
// every document that mentions them (or a term), and the links around the sheets
// of those subjects. It reads every category, notes and sources included, and
// labels each hit with its source class. Deterministic: the same files give the
// same output.

import fs from 'node:fs';
import path from 'node:path';
import {
  buildSubjectIndex,
  compareStrings,
  listSheets,
  masterOnlyChecker,
  readStructure,
} from '../../../../../scripts/lib/subjects.mjs';
import { foldForm, foldText } from '../../../../../scripts/lib/fold.mjs';
import { analyzeMarkdown } from '../../../../../scripts/lib/zones.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';

const WORD_CHAR = /[\p{L}\p{N}]/u;
const HIT_TEXT_MAX = 300;

/**
 * Splits the --terms value on `;`. Blank terms are dropped; the rest are kept as given (trimmed).
 * @param {string} raw
 * @returns {string[]}
 */
export function parseTerms(raw) {
  return String(raw)
    .split(';')
    .map((term) => term.trim())
    .filter((term) => foldForm(term) !== '');
}

/**
 * Category of a campaign-relative path: the one with the longest folder that is a
 * prefix of it (the same rule as masterOnlyChecker).
 * @param {object[]} structure
 * @param {string} file
 * @returns {object|null} the structure entry, or null
 */
export function categoryOf(structure, file) {
  let best = null;
  let bestLength = -1;
  for (const entry of structure) {
    if (typeof entry.folder !== 'string') continue;
    const folder = path.posix.normalize(entry.folder).replace(/\/+$/, '');
    const prefix = folder === '.' || folder === '' ? '' : `${folder}/`;
    if (file.startsWith(prefix) && prefix.length > bestLength) {
      best = entry;
      bestLength = prefix.length;
    }
  }
  return best;
}

/**
 * Source class of a campaign-relative path: `notes` or `sources` for those
 * category types, `sources` for `external` (another campaign, not our canon),
 * `canon` for every other category, null when no category holds it.
 * @param {object[]} structure
 * @param {string} file
 * @returns {'canon'|'notes'|'sources'|null}
 */
export function sourceClassFor(structure, file) {
  const category = categoryOf(structure, file);
  if (category === null) return null;
  if (category.type === 'external') return 'sources';
  return category.type === 'notes' || category.type === 'sources' ? category.type : 'canon';
}

/** True when `needle` occurs in `haystack` as whole words (both folded). */
export function containsWholeWord(haystack, needle) {
  let from = 0;
  for (;;) {
    const start = haystack.indexOf(needle, from);
    if (start < 0) return false;
    const end = start + needle.length;
    const before = start > 0 ? haystack[start - 1] : '';
    const after = end < haystack.length ? haystack[end] : '';
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = start + 1;
  }
}

function isWordChar(ch) {
  return ch !== '' && WORD_CHAR.test(ch);
}

/**
 * Resolves a Markdown link target found in `fromFile` to a campaign-relative
 * path of another existing .md file. Anchors, external URLs and anything outside
 * the campaign give null.
 */
function resolveDocLink(target, fromFile, campaignRoot) {
  const withoutAnchor = target.split('#')[0];
  if (withoutAnchor === '') return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(withoutAnchor)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutAnchor);
  } catch {
    decoded = withoutAnchor;
  }
  const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), decoded));
  if (rel === '..' || rel.startsWith('../') || path.posix.isAbsolute(rel)) return null;
  if (rel === fromFile || !rel.endsWith('.md')) return null;
  try {
    return fs.statSync(path.join(campaignRoot, rel)).isFile() ? rel : null;
  } catch {
    return null;
  }
}

/** Lines of a text, without the empty element a final newline would add. */
function splitLines(text) {
  const parts = text.split(/\r?\n/);
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * Searches the campaign for the given terms.
 * @param {string} campaignRoot absolute path to the campaign folder (campaign.yaml must be readable)
 * @param {string[]} terms terms as given (already split by parseTerms)
 * @returns {object} the search result written by research-search.mjs
 */
export function searchCampaign(campaignRoot, terms) {
  const { structure, errors } = readStructure(campaignRoot);
  if (structure === null) {
    throw new Error(errors.map((e) => `${e.file}: ${e.message}`).join('\n'));
  }

  const termsFolded = [...new Set(terms.map((term) => foldForm(term)))];
  const index = buildSubjectIndex(campaignRoot);

  const matched = index.subjects.filter((subject) =>
    subject.forms.some((form) =>
      termsFolded.some(
        (term) =>
          term === form.folded ||
          containsWholeWord(form.folded, term) ||
          containsWholeWord(term, form.folded),
      ),
    ),
  );
  const matchedIds = new Set(matched.map((subject) => subject.id));
  const homonyms = index.homonyms.filter((h) => h.subjects.some((id) => matchedIds.has(id)));

  const needles = [
    ...new Set([...termsFolded, ...matched.flatMap((subject) => subject.forms.map((f) => f.folded))]),
  ];

  // Every document of every category folder. A file belongs to the category with the longest matching folder.
  const categoryByFile = new Map();
  for (const category of structure) {
    // External documents belong to another campaign: never searched.
    if (typeof category.folder !== 'string' || category.type === 'external') continue;
    for (const file of listSheets(campaignRoot, category.folder)) {
      if (file.startsWith('.campaign/')) continue;
      if (!categoryByFile.has(file)) categoryByFile.set(file, categoryOf(structure, file));
    }
  }
  const documents = [...categoryByFile.keys()].sort(compareStrings);
  const isMasterOnly = masterOnlyChecker(structure);

  const hits = [];
  const texts = new Map();
  for (const file of documents) {
    const text = fs.readFileSync(path.join(campaignRoot, file), 'utf8');
    texts.set(file, text);
    const category = categoryByFile.get(file);
    const { body, bodyStartLine } = parseFrontmatter(text);
    const masterLines = new Set(
      analyzeMarkdown(body, bodyStartLine).lines.filter((l) => l.inMaster).map((l) => l.line),
    );
    const categoryMaster = isMasterOnly(file);
    const sourceClass = sourceClassFor(structure, file);

    splitLines(text).forEach((raw, i) => {
      const lineNo = i + 1;
      const { folded } = foldText(raw);
      if (!needles.some((needle) => containsWholeWord(folded, needle))) return;
      hits.push({
        file,
        line: lineNo,
        category: category.id ?? null,
        type: category.type ?? null,
        source_class: sourceClass,
        master_only: categoryMaster || masterLines.has(lineNo),
        text: raw.trim().slice(0, HIT_TEXT_MAX),
      });
    });
  }

  // Outgoing links of every document, and the incoming links of every document.
  const outbound = new Map();
  for (const file of documents) {
    const { body, bodyStartLine } = parseFrontmatter(texts.get(file));
    const targets = new Set();
    for (const line of analyzeMarkdown(body, bodyStartLine).lines) {
      for (const span of line.spans) {
        if (span.kind !== 'link') continue;
        const resolved = resolveDocLink(span.target, file, campaignRoot);
        if (resolved !== null) targets.add(resolved);
      }
    }
    outbound.set(file, [...targets].sort(compareStrings));
  }
  const inbound = new Map();
  for (const file of documents) {
    for (const target of outbound.get(file)) {
      if (!inbound.has(target)) inbound.set(target, []);
      inbound.get(target).push(file);
    }
  }

  const links = {};
  for (const subject of [...matched].sort((a, b) => compareStrings(a.sheet, b.sheet))) {
    links[subject.sheet] = {
      out: outbound.get(subject.sheet) ?? [],
      in: (inbound.get(subject.sheet) ?? []).slice().sort(compareStrings),
    };
  }

  return {
    terms,
    subjects: matched.map((subject) => ({
      id: subject.id,
      sheet: subject.sheet,
      category: subject.category,
      type: subject.type,
      forms: subject.forms.map((form) => form.text),
    })),
    homonyms,
    hits,
    links,
    documents,
    files_with_hits: [...new Set(hits.map((hit) => hit.file))].sort(compareStrings),
    index_errors: index.errors,
  };
}
