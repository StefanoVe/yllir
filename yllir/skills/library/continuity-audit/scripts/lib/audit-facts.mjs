// Validates the facts that extractor agents wrote for the documents of an
// audit scope. Deterministic: each fact must use a vocabulary attribute, a known
// subject and a quote that really occurs in its document. Also records coverage
// (which documents were read) and adds the metadata facts (location in the
// frontmatter). Judging what to extract is left to the agents.

import fs from 'node:fs';
import path from 'node:path';
import { buildSubjectIndex, readStructure, compareStrings } from '../../../../../scripts/lib/subjects.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { analyzeMarkdown } from '../../../../../scripts/lib/zones.mjs';
import { foldText, foldForm } from '../../../../../scripts/lib/fold.mjs';
import { checkAttribute, checkValue } from './audit-vocabulary.mjs';

const MIN_QUOTE_LENGTH = 8;
const REQUIRED_FIELDS = ['subject', 'attribute', 'value', 'source_type', 'quote'];

/**
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {{ mode: string, files: Array<{fid: string, document: string}> }} scope result of computeScope
 * @param {string} factsDir folder with one `<fid>.json` per scope document
 * @param {{ families: object[], sourceTypes: string[] }} vocab result of loadVocabulary
 * @returns {{ mode: string, complete: boolean, coverage: object[], facts: object[], discarded: object[], ignored_frontmatter: object[], errors: object[] }}
 *   `ignored_frontmatter` holds the facts whose quote only occurs in the frontmatter
 *   (copied `location: [...]` lines): they are neither valid nor discarded.
 */
export function validateFacts(campaignRoot, scope, factsDir, vocab) {
  const index = buildSubjectIndex(campaignRoot);
  const subjectIds = new Set(index.subjects.map((subject) => subject.id));
  const subjectBySheet = new Map(index.subjects.map((subject) => [subject.sheet, subject]));
  const { structure } = readStructure(campaignRoot);
  const sourceTypes = new Set(vocab.sourceTypes);

  const coverage = [];
  const facts = [];
  const discarded = [];
  const ignoredFrontmatter = [];
  const errors = [];

  for (const { fid, document } of scope.files) {
    const text = readText(path.join(campaignRoot, document));
    if (text === null) {
      errors.push({ fid, document, message: 'document not found' });
      coverage.push(toReadEntry(fid, document));
      continue;
    }

    const { data: frontmatter, body, bodyStartLine } = parseFrontmatter(text);
    const { lines } = analyzeMarkdown(body, bodyStartLine);
    const frontmatterOnly = frontmatterLines(text);
    const forcedHypothesis = isNotesDocument(document, structure);

    // Metadata facts do not depend on the facts file.
    const subject = subjectBySheet.get(document);
    if (subject && frontmatter && Array.isArray(frontmatter.location) && frontmatter.location.length > 0) {
      facts.push(metadataFact(fid, document, subject.id, frontmatter.location, keyLine(text, 'location')));
    }

    const list = readFactsList(factsDir, fid, document);
    if (list === null) {
      coverage.push(toReadEntry(fid, document));
      continue;
    }

    let valid = 0;
    let rejected = 0;
    let ignored = 0;
    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      const checked = checkFact(raw, { subjectIds, vocab, sourceTypes });
      if (checked.reason !== undefined) {
        discarded.push({ fid, index: i, reason: checked.reason, fact: raw });
        rejected++;
        continue;
      }

      const located = locateQuote(checked.quote, checked.hint, lines, frontmatterOnly);
      if (located.ignored) {
        ignoredFrontmatter.push({ fid, index: i, fact: raw });
        ignored++;
        continue;
      }
      if (located.reason !== undefined) {
        discarded.push({ fid, index: i, reason: located.reason, fact: raw });
        rejected++;
        continue;
      }

      const line = located.line;
      facts.push({
        id: `F-${fid}-${String(i + 1).padStart(3, '0')}`,
        subject: checked.subject,
        attribute: checked.attribute,
        value: checked.value,
        source_type: forcedHypothesis ? 'hypothesis' : checked.source_type,
        quote: checked.quote,
        document,
        line: line.line,
        section: sectionAt(lines, line.line),
        in_master: line.inMaster,
        forced_hypothesis: forcedHypothesis,
        from_metadata: false,
      });
      valid++;
    }

    coverage.push({
      fid,
      document,
      status: valid > 0 ? 'extracted' : 'read',
      facts_valid: valid,
      facts_discarded: rejected,
      facts_ignored: ignored,
    });
  }

  facts.sort(
    (a, b) =>
      compareStrings(a.document, b.document) || a.line - b.line || compareStrings(a.id, b.id),
  );

  return {
    mode: scope.mode,
    complete: coverage.every((entry) => entry.status !== 'to-read'),
    coverage,
    facts,
    discarded,
    ignored_frontmatter: ignoredFrontmatter,
    errors,
  };
}

function toReadEntry(fid, document) {
  return { fid, document, status: 'to-read', facts_valid: 0, facts_discarded: 0, facts_ignored: 0 };
}

function readText(absolute) {
  try {
    return fs.readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The lines between the first two `---` of a document, with their 1-based line
 * numbers. Empty when the document has no closed frontmatter.
 * @returns {Array<{ line: number, text: string }>}
 */
function frontmatterLines(text) {
  const rawLines = text.split('\n').map((raw) => raw.replace(/\r$/, ''));
  if (rawLines[0] !== '---') return [];
  const found = [];
  for (let i = 1; i < rawLines.length; i++) {
    if (rawLines[i] === '---') return found;
    found.push({ line: i + 1, text: rawLines[i] });
  }
  return [];
}

/** The facts array of `<fid>.json`, or null when the document counts as not read. */
function readFactsList(factsDir, fid, document) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(factsDir, `${fid}.json`), 'utf8'));
  } catch {
    return null;
  }
  if (!isPlainObject(data) || data.document !== document || data.read !== true) return null;
  if (data.facts === undefined) return [];
  return Array.isArray(data.facts) ? data.facts : null;
}

/**
 * Checks everything that does not need the document text.
 * @returns {{ reason: string } | { subject, attribute, value, source_type, quote, hint }}
 */
function checkFact(raw, { subjectIds, vocab, sourceTypes }) {
  if (!isPlainObject(raw)) return { reason: 'not an object' };

  const fields = {};
  for (const name of REQUIRED_FIELDS) {
    const value = raw[name];
    if (name === 'value' && typeof value === 'number' && Number.isFinite(value)) {
      fields.value = String(value);
    } else if (typeof value === 'string') {
      fields[name] = value;
    } else {
      return { reason: `missing field: ${name}` };
    }
  }

  if (!subjectIds.has(fields.subject)) return { reason: `unknown subject: ${fields.subject}` };

  const attribute = checkAttribute(vocab, fields.attribute);
  if (!attribute.ok) return { reason: `unknown attribute: ${fields.attribute} (${attribute.reason})` };

  const value = checkValue(attribute.valueKind, fields.value, subjectIds);
  if (!value.ok) return { reason: `bad value: ${value.reason}` };

  if (!sourceTypes.has(fields.source_type)) {
    return { reason: `unknown source type: ${fields.source_type}` };
  }

  if ([...fields.quote.trim()].length < MIN_QUOTE_LENGTH) return { reason: 'quote too short' };

  return {
    subject: fields.subject,
    attribute: fields.attribute,
    value: fields.value,
    source_type: fields.source_type,
    quote: fields.quote,
    hint: Number.isInteger(raw.line) ? raw.line : null,
  };
}

/**
 * Finds the line of the document that contains the quote. Both sides are folded
 * (case, accents, apostrophes, dashes, spaces). Frontmatter lines are not in `lines`.
 * A quote with no body match that occurs in the frontmatter is `ignored`: extractors
 * copy frontmatter lines, and the metadata facts already cover them.
 * @param {Array<{ line: number, text: string }>} frontmatter frontmatter lines
 * @returns {{ line: object } | { ignored: true } | { reason: string }}
 */
function locateQuote(quote, hint, lines, frontmatter) {
  const needle = foldForm(quote);
  if (needle === '') return { reason: 'quote not found' };

  const matches = lines.filter((line) => foldText(line.text).folded.includes(needle));
  if (hint !== null) {
    const hinted = matches.find((line) => line.line === hint);
    if (hinted) return { line: hinted };
  }
  if (matches.length === 1) return { line: matches[0] };
  if (matches.length === 0) {
    const inFrontmatter = frontmatter.some((line) => foldText(line.text).folded.includes(needle));
    return inFrontmatter ? { ignored: true } : { reason: 'quote not found' };
  }
  return { reason: 'quote ambiguous' };
}

/** Text of the nearest heading at or above the line, or "" when there is none. */
function sectionAt(lines, lineNo) {
  let section = '';
  for (const line of lines) {
    if (line.line > lineNo) break;
    if (line.block === 'heading') section = line.headingText;
  }
  return section;
}

/** True when the document lies under a category of type `notes` or `sources` (the longest folder wins). */
function isNotesDocument(document, structure) {
  let best = null;
  for (const category of structure ?? []) {
    if (typeof category.folder !== 'string') continue;
    const folder = category.folder.replace(/\/+$/, '');
    if (folder === '' || !document.startsWith(`${folder}/`)) continue;
    if (best === null || folder.length > best.folder.length) {
      best = { folder, type: category.type };
    }
  }
  return best !== null && (best.type === 'notes' || best.type === 'sources');
}

function metadataFact(fid, document, subjectId, items, line) {
  return {
    id: `M-${fid}`,
    subject: subjectId,
    attribute: 'location.current',
    value: items.join(','),
    source_type: 'editorial-summary',
    quote: `location: [${items.join(', ')}]`,
    document,
    line,
    section: 'metadata',
    in_master: false,
    forced_hypothesis: false,
    from_metadata: true,
  };
}

/** 1-based line of the top-level `key:` line inside the frontmatter (1 when not found). */
function keyLine(text, key) {
  const rawLines = text.split('\n').map((raw) => raw.replace(/\r$/, ''));
  if (rawLines[0] !== '---') return 1;
  for (let i = 1; i < rawLines.length; i++) {
    if (rawLines[i] === '---') break;
    if (rawLines[i].startsWith(`${key}:`)) return i + 1;
  }
  return 1;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
