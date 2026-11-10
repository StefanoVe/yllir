// Writes the LINKER REPORT: a deterministic text built from the link plan, the
// reviewer outcomes, the apply result and the check exit code. The executor
// never writes it by hand, so no review item can be dropped from it.

import fs from 'node:fs';
import path from 'node:path';
import { validateOutcomes } from './apply-links.mjs';

const EMPTY_PLAN = { scope: [], proposals: [], review: [] };

/**
 * Reads a JSON file. `absent` when the file does not exist, `broken` when it
 * cannot be read or parsed, `ok` with the parsed value otherwise.
 */
function readJsonFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return err.code === 'ENOENT' ? { state: 'absent' } : { state: 'broken' };
  }
  try {
    return { state: 'ok', value: JSON.parse(text) };
  } catch {
    return { state: 'broken' };
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlan(value) {
  return (
    isPlainObject(value) &&
    Array.isArray(value.scope) &&
    Array.isArray(value.proposals) &&
    Array.isArray(value.review)
  );
}

/**
 * Status by the rules of the report: FAILED when the plan cannot be read or a
 * status reason is given; NEEDS_ATTENTION when the check failed, the apply
 * result is not ok, or an input could not be read; DONE otherwise.
 */
export function computeStatus({ planOk, statusReason, checkExit, resultNotOk, attention, checkValid = true }) {
  if (!planOk || statusReason !== null) return 'FAILED';
  if ((checkExit !== '0' && checkExit !== '1') || !checkValid) return 'FAILED';
  if (checkExit === '1' || resultNotOk || attention) return 'NEEDS_ATTENTION';
  return 'DONE';
}

/** Check line: `passed`, `<n> errors`, or `not run`. */
export function checkLine(checkExit, checkErrors) {
  if (checkExit === '0') return 'passed';
  if (checkExit === '1') return `${checkErrors} errors`;
  return 'not run';
}

/** Number of errors in a check.json value; 1 when the value has no countable errors. */
export function countCheckErrors(value) {
  if (Array.isArray(value)) return value.length;
  if (isPlainObject(value)) {
    if (Array.isArray(value.errors)) return value.errors.length;
    if (typeof value.errors === 'number') return value.errors;
  }
  return 1;
}

/**
 * Renders the report text. Pure: it takes already-read inputs.
 * @param {object} input
 * @param {object} input.plan a valid link plan
 * @param {object[]} input.validOutcomes outcomes that passed validateOutcomes
 * @param {object|null} input.result the apply result, or null
 * @param {string} input.status
 * @param {string|null} input.statusReason
 * @param {string} input.check the check line
 * @param {string} input.continueWith
 * @returns {string}
 */
export function renderReport({ plan, validOutcomes, result, status, statusReason, check, checkDetails = [], applyDetails = [], continueWith }) {
  const byPid = new Map(validOutcomes.map((o) => [o.id, o]));
  const applied = result !== null && Array.isArray(result.applied) ? result.applied.length : 0;

  const omitted = plan.proposals
    .filter((p) => byPid.has(p.pid) && byPid.get(p.pid).outcome === 'OMIT')
    .map((p) => `${p.pid}: ${byPid.get(p.pid).reason}`);

  const decisions = [];
  for (const r of plan.review) {
    const where = `${r.file}:${r.line} "${r.text}"`;
    if (r.state === 'ambiguous') {
      decisions.push(`- ${where} could be ${(r.candidates ?? []).join(' or ')} — ambiguous name`);
    } else {
      decisions.push(`- ${where} links to ${r.link_target} — link points to a different document`);
    }
  }
  for (const p of plan.proposals) {
    const o = byPid.get(p.pid);
    if (o && (o.outcome === 'ASK' || o.outcome === 'FIX')) {
      decisions.push(`- ${p.file}:${p.line} "${p.text}" could be ${p.subject} — ${o.reason}`);
    }
  }

  const lines = [
    'LINKER REPORT',
    `status: ${status}${statusReason !== null ? ` (${statusReason})` : ''}`,
    `scope: ${plan.scope.length} files`,
    `applied: ${applied}`,
    omitted.length === 0 ? 'omitted: 0' : `omitted: ${omitted.length} (${omitted.join('; ')})`,
    'decisions for the master:',
    ...(decisions.length === 0 ? ['- none'] : decisions),
    `check: ${check}`,
    ...checkDetails,
    ...applyDetails,
    `continue with: ${continueWith}`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Reads the inputs, decides the status and writes the report file.
 * A missing outcomes or result file counts as none. An unreadable outcomes or
 * result file, or a missing check file with check-exit 1, is a reason for
 * NEEDS_ATTENTION. An unreadable plan gives FAILED.
 * @param {object} options
 * @param {string} options.root campaign root (for evidence paths and .campaign/state/linker/check.json)
 * @param {string} options.planFile
 * @param {string|null} [options.outcomesFile]
 * @param {string|null} [options.resultFile]
 * @param {string|null} [options.checkExit] "0", "1", any other code, or null for not run
 * @param {string|null} [options.statusReason]
 * @param {string} options.continueWith
 * @param {string} options.outFile
 * @returns {{ status: string, outFile: string }}
 */
export function writeLinkerReport({
  root,
  planFile,
  outcomesFile = null,
  resultFile = null,
  checkExit = null,
  statusReason = null,
  continueWith,
  outFile,
}) {
  const planRead = readJsonFile(planFile);
  const planOk = planRead.state === 'ok' && isPlan(planRead.value);
  const plan = planOk ? planRead.value : EMPTY_PLAN;

  let attention = false;
  let outcomes = [];
  if (outcomesFile !== null) {
    const read = readJsonFile(outcomesFile);
    if (read.state === 'broken' || (read.state === 'ok' && !Array.isArray(read.value))) {
      attention = true;
    } else if (read.state === 'ok') {
      outcomes = read.value;
    }
  }
  const validOutcomes = planOk ? validateOutcomes(root, plan, outcomes).valid : [];

  let result = null;
  if (resultFile !== null) {
    const read = readJsonFile(resultFile);
    if (read.state === 'broken' || (read.state === 'ok' && !isPlainObject(read.value))) {
      attention = true;
    } else if (read.state === 'ok') {
      result = read.value;
    }
  }

  let checkErrors = null;
  let checkDetails = [];
  let checkValid = false;
  if (checkExit === '0' || checkExit === '1') {
    const read = readJsonFile(path.join(root, '.campaign', 'state', 'linker', 'check.json'));
    const checkJson = read.value;
    checkValid = read.state === 'ok' && isPlainObject(checkJson) && Array.isArray(checkJson.checked) && Array.isArray(checkJson.errors);
    if (checkValid) {
      checkErrors = checkJson.errors.length;
      checkValid = (checkExit === '0' && checkJson.errors.length === 0) || (checkExit === '1' && checkJson.errors.length > 0);
      checkDetails = checkJson.errors.map((error) => `- ${error.file}:${error.line}:${error.col} ${error.code} ${error.message}`);
    }
  }

  const status = computeStatus({
    planOk,
    statusReason,
    checkExit,
    resultNotOk: result !== null && result.ok === false,
    attention,
    checkValid,
  });

  const applyDetails = [];
  if (result !== null && isPlainObject(result)) {
    for (const rejected of Array.isArray(result.rejected) ? result.rejected : []) {
      const rawId = rejected?.entry?.id;
      const pid = typeof rawId === 'string' && /^P\d+$/.test(rawId) ? rawId : '(unknown)';
      const reason = typeof rejected?.reason === 'string' ? rejected.reason : 'invalid rejected entry';
      applyDetails.push(`apply rejected: ${pid} — ${reason}`);
    }
    for (const pid of Array.isArray(result.missing_outcome) ? result.missing_outcome : []) {
      applyDetails.push(`apply missing outcome: ${typeof pid === 'string' && /^P\d+$/.test(pid) ? pid : '(unknown)'}`);
    }
  }

  const text = renderReport({
    plan,
    validOutcomes,
    result,
    status,
    statusReason,
    check: checkLine(checkExit, checkErrors),
    checkDetails,
    applyDetails,
    continueWith,
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, text);
  return { status, outFile };
}
