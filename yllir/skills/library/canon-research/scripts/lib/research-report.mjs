// Writes the RESEARCH REPORT: validates the answer a reviewer wrote against the
// search result (evidence quotes, source classes, coverage, master-only content)
// and renders the report text. The mechanics are deterministic; the answer is
// data. The report never prints lines of the master block, only the locators
// and quotes that the answer itself carried.

import fs from 'node:fs';
import path from 'node:path';
import { compareStrings, masterOnlyChecker, readStructure } from '../../../../../scripts/lib/subjects.mjs';
import { foldForm, foldText } from '../../../../../scripts/lib/fold.mjs';
import { parseFrontmatter } from '../../../../../scripts/lib/frontmatter.mjs';
import { analyzeMarkdown } from '../../../../../scripts/lib/zones.mjs';
import { isExternalFor, sourceClassFor } from './research-search.mjs';

const CLASSES = new Set(['fact', 'source-claim', 'interpretation', 'hypothesis', 'silence']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string';
}

function validEvidence(entry) {
  return (
    isPlainObject(entry) &&
    typeof entry.file === 'string' &&
    Number.isInteger(entry.line) &&
    typeof entry.quote === 'string'
  );
}

function isValidSearch(value) {
  return (
    isPlainObject(value) &&
    Array.isArray(value.terms) &&
    Array.isArray(value.documents) &&
    Array.isArray(value.hits) &&
    Array.isArray(value.files_with_hits) &&
    Array.isArray(value.homonyms)
  );
}

/** Reads a JSON file: `missing`, `unreadable`, `invalid` (not JSON) or `ok` with the value. */
function readJsonFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { state: err.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
  try {
    return { state: 'ok', value: JSON.parse(text) };
  } catch {
    return { state: 'invalid' };
  }
}

/** Shape problems of the answer file. Every problem names the claim and what is wrong. */
function shapeProblems(answer) {
  const problems = [];
  if (!isString(answer.answer)) problems.push('answer file: "answer" must be a string');
  if (!Array.isArray(answer.claims)) {
    problems.push('answer file: "claims" must be a list');
  } else {
    answer.claims.forEach((claim, index) => {
      const n = index + 1;
      if (!isPlainObject(claim)) {
        problems.push(`claim ${n}: must be an object`);
        return;
      }
      if (!CLASSES.has(claim.class)) {
        problems.push(`claim ${n}: class must be one of fact, source-claim, interpretation, hypothesis, silence`);
      }
      if (!isString(claim.text)) problems.push(`claim ${n}: text must be a string`);
      if (claim.evidence !== undefined && !Array.isArray(claim.evidence)) {
        problems.push(`claim ${n}: evidence must be a list`);
        return;
      }
      (claim.evidence ?? []).forEach((entry, k) => {
        if (!validEvidence(entry)) {
          problems.push(`claim ${n}: evidence ${k + 1} must have file, line (integer) and quote`);
        }
      });
    });
  }
  if (!Array.isArray(answer.read) || !answer.read.every(isString)) {
    problems.push('answer file: "read" must be a list of file paths');
  }
  if (
    answer.unverified_leads !== undefined &&
    (!Array.isArray(answer.unverified_leads) || !answer.unverified_leads.every(isString))
  ) {
    problems.push('answer file: "unverified_leads" must be a list of strings');
  }
  return problems;
}

/**
 * Reads one campaign document for evidence checks. Null when the path is not a
 * file inside the campaign.
 */
function readDocument(root, file, isMasterOnly) {
  const full = path.resolve(root, file);
  if (!full.startsWith(root + path.sep)) return null;
  let text;
  try {
    text = fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
  const { body, bodyStartLine } = parseFrontmatter(text);
  const masterLines = new Set(
    analyzeMarkdown(body, bodyStartLine).lines.filter((l) => l.inMaster).map((l) => l.line),
  );
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return { lines, masterLines, categoryMaster: isMasterOnly(file) };
}

/**
 * Validates the answer and writes the report file.
 * @param {object} options
 * @param {string} options.root absolute campaign root
 * @param {string} options.searchFile search.json written by research-search.mjs
 * @param {string} options.answerFile answer.json written by the reviewer
 * @param {string} options.continueWith text for the `continue with:` line
 * @param {string} options.outFile report file to write
 * @returns {{ status: string, outFile: string, problems: string[] }}
 */
export function writeResearchReport({ root, searchFile, answerFile, continueWith, outFile }) {
  const problems = [];
  const structure = readStructure(root).structure ?? [];
  const isMasterOnly = masterOnlyChecker(structure);

  const searchRead = readJsonFile(searchFile);
  let search = null;
  if (searchRead.state === 'ok' && isValidSearch(searchRead.value)) {
    search = searchRead.value;
  } else {
    problems.push('search file is missing or not a valid search result (run research-search.mjs again)');
  }

  let answerFailed = false;
  let answer = null;
  const answerRead = readJsonFile(answerFile);
  if (answerRead.state === 'missing') {
    answerFailed = true;
    problems.push('answer file is missing');
  } else if (answerRead.state === 'unreadable') {
    answerFailed = true;
    problems.push('answer file cannot be read');
  } else if (answerRead.state === 'invalid') {
    answerFailed = true;
    problems.push('answer file is not valid JSON');
  } else if (isPlainObject(answerRead.value)) {
    answer = answerRead.value;
    problems.push(...shapeProblems(answer));
  } else {
    problems.push('answer file: top level must be an object');
  }

  const claims = Array.isArray(answer?.claims) ? answer.claims : [];
  const readList = Array.isArray(answer?.read) ? answer.read.filter(isString) : [];
  const leads = Array.isArray(answer?.unverified_leads) ? answer.unverified_leads.filter(isString) : [];

  // Evidence checks, source classes and master-only content.
  const documentCache = new Map();
  const documentOf = (file) => {
    if (!documentCache.has(file)) documentCache.set(file, readDocument(root, file, isMasterOnly));
    return documentCache.get(file);
  };
  let masterOnly = false;
  const claimLines = [];
  const externalUsed = new Set(); // evidence files from an external folder (shared world, read only)

  claims.forEach((claim, index) => {
    const n = index + 1;
    if (!isPlainObject(claim)) return;
    const evidence = Array.isArray(claim.evidence) ? claim.evidence : [];
    const locators = [];
    const sourceClasses = new Set();

    for (const entry of evidence) {
      if (!validEvidence(entry)) continue;
      const locator = `${entry.file}:${entry.line}`;
      const doc = documentOf(entry.file);
      if (doc === null) {
        problems.push(`claim ${n}, ${locator}: file not found in the campaign`);
        continue;
      }
      if (entry.line < 1 || entry.line > doc.lines.length) {
        problems.push(`claim ${n}, ${locator}: line not found in the file`);
        continue;
      }
      locators.push(locator);
      const cls = sourceClassFor(structure, entry.file);
      if (cls !== null) sourceClasses.add(cls);
      if (isExternalFor(structure, entry.file)) externalUsed.add(entry.file);
      if (doc.categoryMaster || doc.masterLines.has(entry.line)) masterOnly = true;

      const quote = foldForm(entry.quote);
      if (quote === '') {
        problems.push(`claim ${n}, ${locator}: empty quote`);
      } else if (!foldText(doc.lines[entry.line - 1]).folded.includes(quote)) {
        problems.push(`claim ${n}, ${locator}: quote not found on that line`);
      }
    }

    if (CLASSES.has(claim.class) && claim.class !== 'silence' && evidence.length === 0) {
      problems.push(`claim ${n}: class ${claim.class} needs at least one evidence entry`);
    }
    if (claim.class === 'fact' && !sourceClasses.has('canon')) {
      problems.push(
        sourceClasses.size > 0
          ? `claim ${n}: a fact supported only by notes or sources; use hypothesis or source-claim`
          : `claim ${n}: a fact needs evidence from a canon document`,
      );
    }

    const text = isString(claim.text) ? claim.text : '';
    const where = locators.length > 0 ? ` (${locators.join('; ')})` : '';
    claimLines.push(`- [${String(claim.class)}] ${text}${where}`);
  });

  // Coverage: every file with hits must be read; every file read must be a scanned document.
  let notRead = [];
  let readCount = 0;
  if (search !== null) {
    const documents = new Set(search.documents);
    const readSet = new Set(readList);
    notRead = search.files_with_hits.filter((file) => !readSet.has(file)).sort(compareStrings);
    for (const file of [...readSet].sort(compareStrings)) {
      if (documents.has(file)) {
        readCount += 1;
      } else {
        problems.push(`read: ${file} is not a scanned document`);
      }
    }
  }

  const status =
    answerFailed || search === null
      ? 'FAILED'
      : problems.length > 0 || notRead.length > 0
        ? 'NEEDS_ATTENTION'
        : 'DONE';

  const lines = [
    'RESEARCH REPORT',
    `status: ${status}`,
    `question terms: ${search ? search.terms.join('; ') : 'unknown'}`,
    `covered: ${
      search
        ? `${search.documents.length} documents scanned, ${search.hits.length} hits in ${search.files_with_hits.length} files, ${readCount} files read`
        : 'unknown'
    }`,
    `not read: ${search ? (notRead.length > 0 ? notRead.join(', ') : 'none') : 'unknown'}`,
    `contains master-only content: ${masterOnly ? 'yes' : 'no'}`,
    `from the shared world (external, read only): ${
      externalUsed.size > 0 ? [...externalUsed].sort(compareStrings).join(', ') : 'none'
    }`,
    `homonyms: ${
      search
        ? search.homonyms.length > 0
          ? search.homonyms.map((h) => `${h.folded}: ${h.subjects.join(', ')}`).join('; ')
          : 'none'
        : 'unknown'
    }`,
    'answer:',
    isString(answer?.answer) ? answer.answer : '(no answer)',
    'claims:',
    ...(claimLines.length > 0 ? claimLines : ['- none']),
    'unverified leads:',
    ...(leads.length > 0 ? leads.map((lead) => `- ${lead}`) : ['- none']),
  ];
  if (problems.length > 0) lines.push('problems:', ...problems.map((p) => `- ${p}`));
  lines.push(`continue with: ${continueWith}`);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${lines.join('\n')}\n`);
  return { status, outFile, problems };
}
