// Computes the scope of a continuity audit: the documents to read and the
// subjects to check. Deterministic: the same campaign and arguments give the
// same scope. Mentions come from mentions.mjs, with the notes folders included.

import fs from 'node:fs';
import path from 'node:path';
import { buildSubjectIndex, compareStrings } from '../../../../../scripts/lib/subjects.mjs';
import { scanMentions } from '../../../../../scripts/lib/mentions.mjs';

/**
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {{ mode: 'pre'|'full', files?: string[], subjects?: string[] }} options
 *   `files` and `subjects` are used by mode `pre` only.
 * @returns {{ mode: string, subjects: string[], files: Array<{fid: string, document: string}>, errors: Array<{file: string, message: string}> }}
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

  let subjectIds;
  let documents;
  if (mode === 'full') {
    subjectIds = index.subjects.map((subject) => subject.id);
    documents = scan.files;
  } else {
    const given = new Set();
    for (const raw of files) {
      const document = normalizeDocument(raw);
      if (document === null) {
        errors.push({ file: raw, message: 'file outside campaign' });
      } else if (!isFile(path.join(campaignRoot, document))) {
        errors.push({ file: raw, message: 'file not found' });
      } else {
        given.add(document);
      }
    }

    // S: the given subjects, the subjects owning a given sheet, and every
    // subject mentioned (any state) in a given file.
    const selected = new Set(subjects);
    for (const subject of index.subjects) {
      if (given.has(subject.sheet)) selected.add(subject.id);
    }
    for (const occurrence of scan.occurrences) {
      if (given.has(occurrence.file)) {
        for (const id of occurrenceIds(occurrence)) selected.add(id);
      }
    }

    // Documents: the given files, the sheets of S, and every file (notes
    // included) that mentions a subject of S.
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
    })),
    errors,
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
