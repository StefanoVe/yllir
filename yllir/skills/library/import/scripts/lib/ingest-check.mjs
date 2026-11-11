// Validates an acquisition folder of import: card.md, transcription.md
// and the claim, question and review lines. Reads only. Deterministic.

import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { foldForm } from '../../../../../scripts/lib/fold.mjs';
import { findSourcesFolder, ID_PATTERN, SHA_PATTERN, sha256File } from './ingest-inventory.mjs';

export const KINDS = ['pc-sheet', 'place', 'object', 'creature', 'npc', 'story', 'notes', 'other'];
export const STATUSES = ['acquired', 'transcribed', 'verified', 'integrated'];
const CLAIM_CLASSES = ['fact', 'hypothesis', 'secret', 'draft'];
const CLAIM_STATUSES = ['open', 'verified', 'conflict', 'integrated', 'excluded'];
const QUESTION_STATUSES = ['open', 'answered'];
const REVIEW_RESULTS = ['confirmed', 'changed', 'unreadable'];
const CARD_FIELDS = ['id', 'original', 'original_name', 'sha256', 'acquired', 'provenance', 'kind', 'pages', 'status'];
const SECTION_NAMES = { Claims: 'claims', 'Open questions': 'questions', Review: 'review' };
const LOCATOR = /^p(\d+):l(\d+)$/;
const LOCATOR_LINE = /^\[(p\d+:l\d+)\](?: (.*))?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /\p{L}[\p{L}\p{M}]*|\d+/gu;
const MARKER = /\[(?:illegible|\?|note)[^\]]*\]/g;

/** Claim, question and review entries are `- ` followed by fields separated by `|`. */
function entryFields(text, count) {
  if (!text.startsWith('- ')) return null;
  const parts = text.slice(2).split('|').map((part) => part.trim());
  return parts.length === count ? parts : null;
}

function isRealDate(value) {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function letterCount(token) {
  return [...token].filter((ch) => /\p{L}/u.test(ch)).length;
}

function emptyCounts() {
  return { total: 0, open: 0, verified: 0, conflict: 0, integrated: 0, excluded: 0 };
}

/** A target is valid when it is a campaign-relative path of an existing file. */
function targetExists(campaignRoot, target) {
  if (path.isAbsolute(target)) return false;
  const abs = path.resolve(campaignRoot, target);
  const rel = path.relative(campaignRoot, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return fs.existsSync(abs) && fs.statSync(abs).isFile();
}

/** Splits the body of card.md into the lines of its three list sections. */
function splitSections(body, firstLine) {
  const sections = { claims: [], questions: [], review: [] };
  let current = null;
  body.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) {
      current = SECTION_NAMES[heading[1]] ?? null;
      return;
    }
    if (current === null || line.trim() === '') return;
    sections[current].push({ lineNo: firstLine + index, text: line });
  });
  return sections;
}

function emptyResult(id, errors) {
  return {
    id,
    errors,
    warnings: [],
    claims: emptyCounts(),
    open_questions: [],
    unreadable: [],
    claim_list: [],
    question_list: [],
  };
}

/**
 * Checks one acquisition folder.
 * @param {{ campaignRoot: string, id: string, final?: boolean }} args
 * @returns {{ id: string, errors: string[], warnings: string[], claims: object,
 *   open_questions: Array<{id: string, locator: string, question: string}>,
 *   unreadable: string[], claim_list: object[], question_list: object[] }}
 *   claim_list and question_list hold the parsed entries (used by the report).
 * @throws {Error} when the id is malformed or its folder does not exist
 */
export function checkAcquisition({ campaignRoot, id, final = false }) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(`bad id: ${id}`);
  }
  const { folder, errors: sourceErrors } = findSourcesFolder(campaignRoot);
  if (folder === null) return emptyResult(id, sourceErrors);

  const dir = path.join(campaignRoot, folder, id);
  if (!fs.existsSync(dir)) {
    throw new Error(`no acquisition folder for ${id}`);
  }

  const errors = [];
  const warnings = [];

  // card.md
  const cardFile = path.join(dir, 'card.md');
  let card = null;
  if (!fs.existsSync(cardFile)) {
    errors.push('card.md is missing');
  } else {
    const parsed = parseFrontmatter(fs.readFileSync(cardFile, 'utf8'));
    for (const err of parsed.errors) errors.push(`card.md line ${err.line}: ${err.message}`);
    if (parsed.data === null) {
      if (parsed.errors.length === 0) errors.push('card.md has no frontmatter');
    } else {
      card = parsed;
    }
  }

  const fields = card === null ? {} : card.data;
  let pagesCount = null;
  if (card !== null) {
    for (const field of CARD_FIELDS) {
      if (!Object.hasOwn(fields, field)) errors.push(`missing field ${field}`);
    }
    for (const field of Object.keys(fields)) {
      if (!CARD_FIELDS.includes(field)) errors.push(`unknown field ${field}`);
    }
    const scalar = (field) => {
      const value = fields[field];
      if (value === undefined) return undefined;
      if (Array.isArray(value)) {
        errors.push(`field ${field} must be a single value`);
        return undefined;
      }
      return value;
    };

    const cardId = scalar('id');
    if (cardId !== undefined) {
      if (!ID_PATTERN.test(cardId)) errors.push(`bad id: ${cardId}`);
      else if (cardId !== id) errors.push(`id ${cardId} does not match folder ${id}`);
    }

    const sha = scalar('sha256');
    if (sha !== undefined && !SHA_PATTERN.test(sha)) errors.push(`bad sha256: ${sha}`);

    const original = scalar('original');
    if (original !== undefined) {
      if (original === '' || path.basename(original) !== original) {
        errors.push(`original must be a file name inside the folder: ${original}`);
      } else if (!fs.existsSync(path.join(dir, original))) {
        errors.push(`original file missing: ${original}`);
      } else if (sha !== undefined && SHA_PATTERN.test(sha) && sha256File(path.join(dir, original)) !== sha) {
        errors.push('sha256 does not match original');
      }
    }

    if (scalar('original_name') === '') errors.push('original_name is empty');

    const acquired = scalar('acquired');
    if (acquired !== undefined && !isRealDate(acquired)) errors.push(`bad date acquired: ${acquired}`);

    const provenance = scalar('provenance');
    if (provenance !== undefined && provenance.trim() === '') errors.push('provenance is empty');

    const kind = scalar('kind');
    if (kind !== undefined && !KINDS.includes(kind)) errors.push(`bad kind: ${kind}`);

    const pagesValue = scalar('pages');
    if (pagesValue !== undefined) {
      if (!/^\d+$/.test(pagesValue)) errors.push(`bad pages: ${pagesValue}`);
      else pagesCount = Number(pagesValue);
    }

    const status = scalar('status');
    if (status !== undefined && !STATUSES.includes(status)) errors.push(`bad status: ${status}`);
  }

  // transcription.md
  const transFile = path.join(dir, 'transcription.md');
  const locators = new Map(); // locator -> { text, page }
  const transLines = []; // { locator, text }
  if (!fs.existsSync(transFile)) {
    errors.push('transcription.md is missing');
  } else {
    fs.readFileSync(transFile, 'utf8')
      .split('\n')
      .forEach((raw, index) => {
        const line = raw.replace(/\r$/, '');
        const lineNo = index + 1;
        if (line.trim() === '' || line.startsWith('#')) return;
        const match = LOCATOR_LINE.exec(line);
        if (match === null) {
          errors.push(`line ${lineNo} has no locator`);
          return;
        }
        const locator = match[1];
        const text = match[2] ?? '';
        if (locators.has(locator)) {
          errors.push(`duplicate locator ${locator} (line ${lineNo})`);
          return;
        }
        locators.set(locator, { text, page: Number(LOCATOR.exec(locator)[1]) });
        transLines.push({ locator, text });
      });
  }

  const doubts = [];
  const unreadable = [];
  for (const { locator, text } of transLines) {
    if (text.includes('[illegible')) {
      if (!unreadable.includes(locator)) unreadable.push(locator);
    }
    if ((text.includes('[illegible') || text.includes('[?')) && !doubts.includes(locator)) {
      doubts.push(locator);
    }
  }

  // Sections: claims, questions, review (line numbers are those of card.md).
  const sections = card === null
    ? { claims: [], questions: [], review: [] }
    : splitSections(card.body, card.bodyStartLine);

  // Claims
  const claimList = [];
  const claimIds = new Set();
  for (const { lineNo, text } of sections.claims) {
    const parts = entryFields(text, 6);
    if (parts === null) {
      errors.push(`claim format: line ${lineNo} is not a claim`);
      continue;
    }
    const [cid, cls, status, locator, claimText, target] = parts;
    let problem = null;
    if (!/^C\d{3}$/.test(cid)) problem = `bad id ${cid}`;
    else if (!CLAIM_CLASSES.includes(cls)) problem = `bad class ${cls}`;
    else if (!CLAIM_STATUSES.includes(status)) problem = `bad status ${status}`;
    else if (!LOCATOR.test(locator)) problem = `bad locator ${locator}`;
    else if (claimText === '') problem = 'empty text';
    if (problem !== null) {
      errors.push(`claim format: ${problem} (line ${lineNo})`);
      continue;
    }
    if (claimIds.has(cid)) errors.push(`duplicate claim id ${cid}`);
    claimIds.add(cid);
    if (!locators.has(locator)) errors.push(`unknown locator ${locator} in ${cid}`);
    if (status === 'integrated') {
      if (target === '') errors.push(`integrated without target: ${cid}`);
      else if (!targetExists(campaignRoot, target)) errors.push(`integrated target missing: ${cid} ${target}`);
    } else if (target !== '') {
      errors.push(`target on a non-integrated claim: ${cid}`);
    }
    claimList.push({ id: cid, class: cls, status, locator, text: claimText, target });
  }

  // Questions
  const questionList = [];
  const questionIds = new Set();
  for (const { lineNo, text } of sections.questions) {
    const parts = entryFields(text, 5);
    if (parts === null) {
      errors.push(`question format: line ${lineNo} is not a question`);
      continue;
    }
    const [qid, status, locator, question, answer] = parts;
    let problem = null;
    if (!/^Q\d{3}$/.test(qid)) problem = `bad id ${qid}`;
    else if (!QUESTION_STATUSES.includes(status)) problem = `bad status ${status}`;
    else if (!LOCATOR.test(locator)) problem = `bad locator ${locator}`;
    else if (question === '') problem = 'empty question';
    else if (status === 'open' && answer !== '') problem = `${qid} is open but has an answer`;
    if (problem !== null) {
      errors.push(`question format: ${problem} (line ${lineNo})`);
      continue;
    }
    if (questionIds.has(qid)) errors.push(`duplicate question id ${qid}`);
    questionIds.add(qid);
    if (!locators.has(locator)) errors.push(`unknown locator ${locator} in ${qid}`);
    if (status === 'answered' && answer === '') errors.push(`question ${qid} answered without answer`);
    questionList.push({ id: qid, status, locator, question, answer });
  }

  // Review
  const reviewed = new Set();
  const reviewIds = new Set();
  for (const { lineNo, text } of sections.review) {
    const parts = entryFields(text, 4);
    if (parts === null) {
      errors.push(`review format: line ${lineNo} is not a review line`);
      continue;
    }
    const [rid, ref, locator, result] = parts;
    let problem = null;
    if (!/^R\d{3}$/.test(rid)) problem = `bad id ${rid}`;
    else if (!LOCATOR.test(locator)) problem = `bad locator ${locator}`;
    else if (!REVIEW_RESULTS.includes(result)) problem = `bad result ${result}`;
    if (problem !== null) {
      errors.push(`review format: ${problem} (line ${lineNo})`);
      continue;
    }
    if (reviewIds.has(rid)) errors.push(`duplicate review id ${rid}`);
    reviewIds.add(rid);
    if (!claimIds.has(ref) && !questionIds.has(ref)) {
      errors.push(`review refers to missing id ${ref} (${rid})`);
    }
    if (!locators.has(locator)) errors.push(`unknown locator ${locator} in ${rid}`);
    reviewed.add(ref);
  }

  for (const question of questionList) {
    if (question.status === 'answered' && !reviewed.has(question.id)) {
      errors.push(`question ${question.id} answered without review`);
    }
  }

  // Doubts need a question at the same locator.
  for (const locator of doubts) {
    if (!questionList.some((question) => question.locator === locator)) {
      errors.push(`doubt at ${locator} has no question`);
    }
  }

  if (final) {
    for (const claim of claimList) {
      if (claim.status === 'open') errors.push(`open claim ${claim.id} (--final)`);
    }
    for (const question of questionList) {
      if (question.status === 'open') errors.push(`open question ${question.id} (--final)`);
    }
  }

  // Uncovered tokens: a number or a capitalized word of the transcription that no
  // claim text, question or answer contains (compared folded).
  const coveredText = [
    ...claimList.map((claim) => claim.text),
    ...questionList.map((question) => `${question.question} ${question.answer}`),
  ].join('\n');
  const covered = new Set(foldForm(coveredText).match(TOKEN) ?? []);
  for (const { locator, text } of transLines) {
    const cleaned = text.replace(MARKER, ' ').trim();
    const words = cleaned.split(/\s+/).filter((word) => word !== '');
    const rest = words.slice(1).join(' ');
    const seen = new Set();
    for (const token of rest.match(TOKEN) ?? []) {
      const isNumber = /^\d+$/.test(token);
      const isName = /^\p{Lu}/u.test(token) && letterCount(token) >= 3;
      if (!isNumber && !isName) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      if (!covered.has(foldForm(token))) {
        warnings.push(`uncovered: ${locator} ${token}`);
      }
    }
  }

  // Pages of the card against the transcription.
  if (pagesCount !== null && pagesCount > 0) {
    const transPages = new Set(transLines.map((line) => Number(LOCATOR.exec(line.locator)[1]))).size;
    if (pagesCount !== transPages) {
      warnings.push(`pages is ${pagesCount} but the transcription has ${transPages} pages`);
    }
  }

  const claims = emptyCounts();
  claims.total = claimList.length;
  for (const claim of claimList) claims[claim.status] += 1;

  return {
    id,
    errors,
    warnings,
    claims,
    open_questions: questionList
      .filter((question) => question.status === 'open')
      .map((question) => ({ id: question.id, locator: question.locator, question: question.question })),
    unreadable,
    claim_list: claimList,
    question_list: questionList,
  };
}

/**
 * The JSON written by ingest-check --out.
 * @param {ReturnType<typeof checkAcquisition>} result
 */
export function checkJson(result) {
  return {
    id: result.id,
    errors: result.errors,
    warnings: result.warnings,
    claims: result.claims,
    open_questions: result.open_questions,
    unreadable: result.unreadable,
  };
}
