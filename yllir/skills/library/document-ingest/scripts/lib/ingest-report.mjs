// Builds the INGEST REPORT of a document-ingest run from the checks of its
// acquisition folders. Pure: the CLI reads the write and audit reports and
// writes the result. Deterministic.

import { checkAcquisition } from './ingest-check.mjs';
import { compareStrings } from '../../../../../scripts/lib/subjects.mjs';

const DEFAULT_CONTINUE = 'the step of the invoking skill that called document-ingest';

/** Value of the first `status:` line of a report, or `unknown` when there is none. */
export function statusValue(text) {
  const match = /^status:[ \t]*(.*?)[ \t]*$/m.exec(text);
  return match === null || match[1] === '' ? 'unknown' : match[1];
}

function zeroClaims() {
  return { total: 0, open: 0, verified: 0, conflict: 0, integrated: 0, excluded: 0 };
}

/**
 * @param {{ campaignRoot: string, ids: string[], duplicates?: number,
 *   writeText?: string|null, auditText?: string|null, continueWith?: string|null,
 *   statusReason?: string|null }} args
 *   writeText / auditText: the content of the report files, or null when not run
 * @returns {{ status: 'DONE'|'NEEDS_ATTENTION'|'FAILED', text: string }}
 */
export function buildReport({
  campaignRoot,
  ids,
  duplicates = 0,
  writeText = null,
  auditText = null,
  continueWith = null,
  statusReason = null,
}) {
  const sourceIds = [...new Set(ids)].sort(compareStrings);

  const checks = sourceIds.map((id) => {
    try {
      return checkAcquisition({ campaignRoot, id, final: false });
    } catch (err) {
      return {
        id,
        errors: [err.message],
        warnings: [],
        claims: zeroClaims(),
        open_questions: [],
        unreadable: [],
        claim_list: [],
        question_list: [],
      };
    }
  });

  const totals = zeroClaims();
  for (const check of checks) {
    for (const key of Object.keys(totals)) totals[key] += check.claims[key];
  }
  const checkErrors = checks.reduce((sum, check) => sum + check.errors.length, 0);
  const unreadable = checks.flatMap((check) => check.unreadable.map((locator) => `${check.id} ${locator}`));
  const openQuestions = checks.flatMap((check) =>
    check.question_list
      .filter((question) => question.status === 'open')
      .map((question) => `- ${check.id} ${question.id} ${question.locator} ${question.question}`),
  );
  const conflicts = checks.flatMap((check) =>
    check.claim_list
      .filter((claim) => claim.status === 'conflict')
      .map((claim) => `- ${check.id} ${claim.id} ${claim.locator} conflict: ${claim.text}`),
  );
  const masterLines = [...openQuestions, ...conflicts];

  const writeStatus = writeText === null ? null : statusValue(writeText);
  const auditStatus = auditText === null ? null : statusValue(auditText);

  let status;
  if (statusReason !== null || checkErrors > 0) {
    status = 'FAILED';
  } else {
    const writeOk = writeStatus === null ? totals.integrated === 0 : writeStatus === 'DONE';
    const clean = openQuestions.length === 0 && conflicts.length === 0 && totals.open === 0;
    status = clean && writeOk ? 'DONE' : 'NEEDS_ATTENTION';
  }

  const lines = ['INGEST REPORT', `status: ${status}`];
  if (statusReason !== null) lines.push(`reason: ${statusReason}`);
  lines.push(
    `sources: ${sourceIds.length} (${sourceIds.length > 0 ? sourceIds.join(',') : 'none'})`,
    `duplicates skipped: ${duplicates}`,
    `claims: ${totals.total} (integrated ${totals.integrated}, verified ${totals.verified}, conflict ${totals.conflict}, open ${totals.open}, excluded ${totals.excluded})`,
    `unreadable parts: ${unreadable.length} (${unreadable.length > 0 ? unreadable.join('; ') : 'none'})`,
    `check: ${checkErrors} errors`,
    `write: ${writeStatus ?? 'not run'}`,
    `audit: ${auditStatus ?? 'not run'}`,
    'open questions for the master:',
  );
  if (masterLines.length === 0) lines.push('- none');
  else lines.push(...masterLines);
  lines.push(`continue with: ${continueWith ?? DEFAULT_CONTINUE}`);

  return { status, text: `${lines.join('\n')}\n` };
}
