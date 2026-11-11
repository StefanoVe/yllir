// Computes the scope of a continuity audit: the documents to read and the
// subjects to check. Deterministic: the same campaign and arguments give the
// same scope. Mentions come from mentions.mjs, with the notes folders included.

import fs from 'node:fs';
import path from 'node:path';
import { buildSubjectIndex, canonicalInternalPath, compareStrings, readStructure } from '../../../../../scripts/lib/subjects.mjs';
import { scanMentions } from '../../../../../scripts/lib/mentions.mjs';

/**
 * External categories (`type: external`) hold read-only originals of another
 * campaign or shared world. They are canon for the comparison: their subjects
 * are checked against and their sheets are read as reference documents, with
 * the flag `external: true`. They are never modified, and mentions inside them
 * are never scanned (the linker does not touch them either).
 *
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {{ mode: 'pre'|'full', files?: string[], subjects?: string[] }} options
 *   `files` and `subjects` are used by mode `pre` only.
 * @returns {{ mode: string, subjects: string[], files: Array<{fid: string, document: string, external: boolean}>, errors: Array<{file: string, message: string}> }}
 */
export function computeScope(campaignRoot, { mode, files = [], subjects = [] } = {}) {
  if (mode !== 'pre' && mode !== 'full') {
    throw new TypeError(`unknown mode: ${mode}`);
  }
  const index = buildSubjectIndex(campaignRoot);
  const scan = scanMentions(campaignRoot, index, { includeNotes: true });
  // Index errors are reported too: a subject that is not indexed would be
  // silently left out of the audit otherwise.
  const errors = [...index.errors];

  // Sheets of the external subjects: read-only reference documents. Mentions
  // are never scanned inside them, so they enter the scope only as the sheet
  // of a subject of S.
  const externalSheets = new Set(index.subjects.filter((s) => s.external === true).map((s) => s.sheet));
  const categoryTypeOf = categoryTypeChecker(readStructure(campaignRoot).structure ?? []);
  const isExternalFile = (rel) => externalSheets.has(rel) || categoryTypeOf(rel) === 'external';

  let subjectIds;
  let documents;
  if (mode === 'full') {
    subjectIds = index.subjects.map((subject) => subject.id);
    documents = [...new Set([...scan.files, ...externalSheets])];
  } else {
    const given = new Set();
    for (const raw of files) {
      const normalized = normalizeDocument(raw);
      const document = normalized === null ? null : canonicalInternalPath(campaignRoot, normalized);
      if (document === null) {
        errors.push({ file: raw, message: 'file outside campaign' });
      } else if (isExternalFile(document)) {
        errors.push({ file: raw, message: 'external file: not to be modified' });
      } else if (!isFile(path.join(campaignRoot, document))) {
        errors.push({ file: raw, message: 'file not found' });
      } else {
        given.add(document);
      }
    }

    // S: the given subjects (external ones included), the subjects owning a
    // given sheet, and every subject mentioned (any state) in a given file.
    const selected = new Set(subjects);
    for (const subject of index.subjects) {
      if (given.has(subject.sheet) || subject.paths?.some((alias) => given.has(alias))) selected.add(subject.id);
    }
    for (const occurrence of scan.occurrences) {
      if (given.has(occurrence.file)) {
        for (const id of occurrenceIds(occurrence)) selected.add(id);
      }
    }

    // Documents: the given files, the sheets of S (external ones too, read
    // only), and every campaign file (notes included) that mentions a subject of S.
    const docs = new Set(given);
    for (const subject of index.subjects) {
      if (selected.has(subject.id)) docs.add(subject.sheet);
    }
    for (const occurrence of scan.occurrences) {
      if (occurrenceIds(occurrence).some((id) => selected.has(id))) {
        docs.add(occurrence.file);
      }
    }
    subjectIds = [...selected];
    documents = [...docs];
  }

  subjectIds.sort(compareStrings);
  documents.sort(compareStrings);
  return {
    mode,
    subjects: subjectIds,
    files: documents.map((document, i) => ({
      fid: `D${String(i + 1).padStart(3, '0')}`,
      document,
      external: externalSheets.has(document),
    })),
    errors,
  };
}

/**
 * Returns a function giving the type of the category that owns a campaign-relative
 * path: the category with the longest folder that is a prefix of it (as in
 * masterOnlyChecker), or null when none does.
 */
function categoryTypeChecker(structure) {
  const categories = structure
    .filter((entry) => typeof entry.folder === 'string')
    .map((entry) => {
      const folder = path.posix.normalize(entry.folder).replace(/\/+$/, '');
      const prefix = folder === '.' || folder === '' ? '' : `${folder}/`;
      return { type: entry.type, prefix };
    });

  return (rel) => {
    let best = null;
    for (const category of categories) {
      if (rel.startsWith(category.prefix) && (best === null || category.prefix.length > best.prefix.length)) {
        best = category;
      }
    }
    return best === null ? null : best.type;
  };
}

/** Subject ids of an occurrence: its subject, or every candidate of a homonym group. */
function occurrenceIds(occurrence) {
  return [...(occurrence.subject ? [occurrence.subject] : []), ...(occurrence.candidates ?? [])];
}

/**
 * Turns a user-given path into a campaign-relative path with `/` separators.
 * Returns null when it is absolute or points outside the campaign.
 */
function normalizeDocument(raw) {
  const normalized = path.posix.normalize(String(raw).replace(/\\/g, '/'));
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    return null;
  }
  return normalized;
}

function isFile(absolute) {
  try {
    return fs.statSync(absolute).isFile();
  } catch {
    return false;
  }
}
