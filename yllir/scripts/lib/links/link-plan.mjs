// Plans the links for the mentions of a campaign. One proposal per bare mention
// (with its target and the before/after text of its line) and one review entry
// per ambiguous or linked-elsewhere mention. It writes nothing and is
// deterministic: the same files give byte-identical output.

import fs from 'node:fs';
import path from 'node:path';
import {
  buildSubjectIndex,
  canonicalInternalPath,
  compareStrings,
  masterOnlyChecker,
  readStructure,
} from '../subjects.mjs';
import { scanMentions } from '../mentions.mjs';

const REVIEW_STATES = new Set(['ambiguous', 'linked-elsewhere']);

/**
 * Builds the subject index and scans the whole campaign.
 * @returns {{ index: object, scan: object }}
 */
export function scanCampaign(campaignRoot) {
  const index = buildSubjectIndex(campaignRoot);
  const scan = scanMentions(campaignRoot, index);
  return { index, scan };
}

/**
 * Linking runs in two directions, with no extra argument:
 * - outward: the mentions inside the given files are linked to their sheets;
 * - inward: every subject passed in `subjects`, and every subject whose sheet is
 *   one of the given files, has all its mentions linked, in any campaign file
 *   (the other documents join the scope).
 * When both `files` and `subjects` are null, the whole campaign is in scope.
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {{ files?: string[]|null, subjects?: string[]|null }} [options]
 * @returns {{ scope: string[], errors: object[], proposals: object[], review: object[] }}
 */
export function planLinks(campaignRoot, options = {}) {
  return planFromScan(campaignRoot, scanCampaign(campaignRoot), options);
}

/**
 * Same as planLinks, on a scan already made by scanCampaign.
 * @param {string} campaignRoot absolute path to the campaign folder
 * @param {{ index: object, scan: object }} scanned result of scanCampaign
 * @param {{ files?: string[]|null, subjects?: string[]|null }} [options]
 */
export function planFromScan(campaignRoot, { index, scan }, { files = null, subjects = null } = {}) {
  const errors = [...index.errors];
  const scanned = new Set(scan.files);
  const scope = new Set();

  if (files === null && subjects === null) {
    for (const file of scan.files) scope.add(file);
  } else {
    const validFiles = new Set();
    if (files !== null) {
      for (const rawFile of new Set(files)) {
        const file = canonicalInternalPath(campaignRoot, rawFile);
        if (scanned.has(file)) {
          scope.add(file);
          validFiles.add(file);
        } else {
          errors.push({ file: rawFile, message: 'file not in scan' });
        }
      }
    }
    // Outward and inward: the subjects passed by the caller, plus the subjects
    // whose sheet is one of the valid files (so no caller argument is needed).
    const wanted = new Set(subjects ?? []);
    for (const subject of index.subjects) {
      if (validFiles.has(subject.sheet)) wanted.add(subject.id);
    }
    if (wanted.size > 0) {
      for (const occ of scan.occurrences) {
        const direct = typeof occ.subject === 'string' && wanted.has(occ.subject);
        const candidate = (occ.candidates ?? []).some((id) => wanted.has(id));
        if (direct || candidate) scope.add(occ.file);
      }
    }
  }

  // A symlink is an original kept outside the repo (made by document ingest): the linker
  // never writes into it, so it gets no proposal or review entry and is not in scope.
  // It can still be a subject sheet, so the subjects above keep pointing at it.
  const linkCache = new Map();
  const isLink = (file) => {
    if (!linkCache.has(file)) {
      let link = false;
      try {
        link = fs.lstatSync(path.join(campaignRoot, file)).isSymbolicLink();
      } catch {
        link = false;
      }
      linkCache.set(file, link);
    }
    return linkCache.get(file);
  };

  const sheetOf = new Map(index.subjects.map((subject) => [subject.id, subject.sheet]));
  // A master-only subject is never linked, from any document (the subject stays in the index).
  const isMasterOnly = masterOnlyChecker(readStructure(campaignRoot).structure ?? []);
  const linesCache = new Map();
  const linesOf = (file) => {
    if (!linesCache.has(file)) {
      const text = fs.readFileSync(path.join(campaignRoot, file), 'utf8');
      linesCache.set(file, text.split(/\r?\n/));
    }
    return linesCache.get(file);
  };

  const proposals = [];
  const review = [];
  let proposalNo = 0;
  let reviewNo = 0;

  for (const occ of scan.occurrences) {
    if (!scope.has(occ.file) || isLink(occ.file)) continue;

    if (occ.state === 'bare' && occ.subject !== null) {
      const sheet = sheetOf.get(occ.subject);
      if (isMasterOnly(sheet)) continue;
      const target = encodeTarget(path.posix.relative(path.posix.dirname(occ.file), sheet));
      const before = linesOf(occ.file)[occ.line - 1] ?? '';
      const start = occ.col - 1;
      const after =
        before.slice(0, start) +
        `[${occ.text}](${target})` +
        before.slice(start + occ.text.length);
      proposalNo += 1;
      proposals.push({
        pid: `P${String(proposalNo).padStart(3, '0')}`,
        file: occ.file,
        line: occ.line,
        col: occ.col,
        text: occ.text,
        subject: occ.subject,
        sheet,
        target,
        before,
        after,
        in_master: occ.in_master,
      });
    } else if (REVIEW_STATES.has(occ.state)) {
      reviewNo += 1;
      const entry = {
        rid: `R${String(reviewNo).padStart(3, '0')}`,
        file: occ.file,
        line: occ.line,
        col: occ.col,
        text: occ.text,
        state: occ.state,
        subject: occ.subject,
      };
      if (occ.candidates !== undefined) entry.candidates = occ.candidates;
      if (occ.link_target !== undefined) entry.link_target = occ.link_target;
      review.push(entry);
    }
  }

  return {
    scope: [...scope].filter((file) => !isLink(file)).sort(compareStrings),
    errors,
    proposals,
    review,
  };
}

/** Encodes only the characters that break a Markdown link target. */
function encodeTarget(relative) {
  return relative.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}
