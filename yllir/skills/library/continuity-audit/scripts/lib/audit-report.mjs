// Validates the judge's judgments of audit candidates and builds the audit report.
// Pure functions: no file access. The CLI (../audit-report.mjs) reads the JSON inputs.

export const CATEGORIES = [
  'direct-contradiction',
  'possible-discrepancy',
  'unexplained-detail',
  'perspective',
  'attestation-conflict',
];

const DASH = '—';

/** Returns the locator `<document>:<line>` of a fact. */
function locatorOf(fact) {
  return `${fact.document}:${fact.line}`;
}

/** Candidates may be passed as the whole candidates.json object or as the bare array. */
function candidateList(candidates) {
  if (Array.isArray(candidates)) return candidates;
  if (candidates && Array.isArray(candidates.candidates)) return candidates.candidates;
  return [];
}

/** Values of a candidate as a display string. */
function valuesText(values) {
  if (Array.isArray(values)) return values.map((value) => String(value)).join(' vs ');
  return String(values);
}

/**
 * Checks the judgments against the candidates.
 * Returns { valid: Map<cid, judgment>, problems: [{ cid|null, message }] }.
 * Any problem makes the audit INVALID: the judge must be run again.
 */
export function validateJudgments(candidates, judgments, mode) {
  const valid = new Map();
  const problems = [];
  if (!Array.isArray(judgments)) {
    problems.push({ cid: null, message: 'judgments must be an array' });
    return { valid, problems };
  }

  const byCid = new Map();
  for (const candidate of candidateList(candidates)) byCid.set(candidate.cid, candidate);

  const seen = new Set();
  for (const judgment of judgments) {
    const cid = judgment && typeof judgment === 'object' ? judgment.cid : undefined;
    if (!byCid.has(cid)) {
      problems.push({ cid: cid ?? null, message: `unknown cid ${JSON.stringify(cid ?? null)}` });
      continue;
    }
    if (seen.has(cid)) {
      problems.push({ cid, message: 'duplicate judgment for this cid' });
      continue;
    }
    seen.add(cid);

    const candidate = byCid.get(cid);
    let ok = true;
    if (!CATEGORIES.includes(judgment.category)) {
      problems.push({ cid, message: `bad category ${JSON.stringify(judgment.category ?? null)}` });
      ok = false;
    }
    if (mode === 'pre' && typeof judgment.related_to_change !== 'boolean') {
      problems.push({ cid, message: 'related_to_change must be a boolean in pre mode' });
      ok = false;
    }
    if (typeof judgment.reason !== 'string' || judgment.reason.trim() === '') {
      problems.push({ cid, message: 'reason must be a non-empty string' });
      ok = false;
    }
    if (!Array.isArray(judgment.locators)) {
      problems.push({ cid, message: 'locators must be an array' });
      ok = false;
    } else {
      const places = new Set((candidate.facts ?? []).map(locatorOf));
      const used = new Set();
      for (const locator of judgment.locators) {
        if (!places.has(locator)) {
          problems.push({ cid, message: `locator ${JSON.stringify(locator)} is not a fact place of this candidate` });
          ok = false;
        } else {
          used.add(locator);
        }
      }
      // One locator per place, up to two: a candidate with facts from two or more places
      // must cite two of them.
      const required = Math.min(2, places.size);
      if (used.size < required) {
        problems.push({ cid, message: `needs at least ${required} distinct locators, got ${used.size}` });
        ok = false;
      }
    }
    if (ok) valid.set(cid, judgment);
  }

  for (const candidate of candidateList(candidates)) {
    if (!seen.has(candidate.cid)) {
      problems.push({ cid: candidate.cid, message: 'missing judgment for this cid' });
    }
  }
  return { valid, problems };
}

/** Coverage numbers from facts.json. */
function coverageSummary(facts) {
  const coverage = Array.isArray(facts.coverage) ? facts.coverage : [];
  const count = (status) => coverage.filter((entry) => entry.status === status).length;
  return {
    documents: coverage.length,
    extracted: count('extracted'),
    read_no_facts: count('read'),
    not_read: count('to-read'),
  };
}

/** Lines for the "not checked" section, in text form and as JSON records. */
function notChecked(facts) {
  const lines = [];
  const coverage = Array.isArray(facts.coverage) ? facts.coverage : [];
  for (const entry of coverage) {
    if (entry.status === 'to-read') lines.push(`${entry.document} (not read)`);
  }
  const discarded = Array.isArray(facts.discarded) ? facts.discarded : [];
  for (const entry of discarded) {
    lines.push(`${entry.fid}#${entry.index} discarded: ${entry.reason}`);
  }
  return lines;
}

/** Formats one judged candidate as a report line. */
function judgedLine(candidate, judgment, mode) {
  // related_to_change is only meaningful in pre mode, and only problems carry the prefix.
  const related = mode === 'pre' && judgment.related_to_change === true && judgment.category !== 'perspective';
  const prefix = related ? '[RELATED] ' : '';
  return `- ${prefix}[${judgment.category}] ${candidate.subject} ${candidate.attribute}: ${valuesText(candidate.values)} ${DASH} ${judgment.locators.join(', ')} ${DASH} ${judgment.reason}`;
}

/** Builds the audit report: { status, json, text }. */
export function buildReport({ scope, facts, candidates, judgments, coverageReview }) {
  const mode = scope && scope.mode === 'pre' ? 'pre' : 'full';
  const candidateItems = candidateList(candidates);
  const allJudgments = judgments === undefined || judgments === null ? [] : judgments;
  const { valid, problems: validationProblems } = validateJudgments(candidateItems, allJudgments, mode);

  if (validationProblems.length > 0) {
    const text = [
      'AUDIT REPORT',
      'status: INVALID',
      ...validationProblems.map((problem) => `- ${problem.cid ?? '(none)'}: ${problem.message}`),
      '',
    ].join('\n');
    return {
      status: 'INVALID',
      json: {
        status: 'INVALID',
        mode,
        validation_problems: validationProblems,
      },
      text,
    };
  }

  const reviewVerdict = coverageReview ? coverageReview.verdict : null;
  const zeroCandidates = candidateItems.length === 0;
  let status = 'COMPLETE';
  if (facts.complete !== true) status = 'INCOMPLETE';
  else if (zeroCandidates && reviewVerdict !== 'CONFIRMED') status = 'INCOMPLETE';

  // Judged candidates, in candidate order.
  const judged = [];
  for (const candidate of candidateItems) {
    const judgment = valid.get(candidate.cid);
    if (judgment) judged.push({ candidate, judgment });
  }
  const problemItems = judged.filter((item) => item.judgment.category !== 'perspective');
  const perspectiveItems = judged.filter((item) => item.judgment.category === 'perspective');
  if (mode === 'pre') {
    // Stable partition: related to the change first.
    problemItems.sort((a, b) => Number(b.judgment.related_to_change) - Number(a.judgment.related_to_change));
  }

  const excludedItems = Array.isArray(candidates && candidates.excluded) ? candidates.excluded : [];
  const hypotheses = Array.isArray(candidates && candidates.hypotheses) ? candidates.hypotheses : [];
  const coverage = coverageSummary(facts);
  const factList = Array.isArray(facts.facts) ? facts.facts : [];
  const discardedList = Array.isArray(facts.discarded) ? facts.discarded : [];
  const notCheckedLines = notChecked(facts);

  const reviewMissed = coverageReview && Array.isArray(coverageReview.missed) ? coverageReview.missed.length : 0;
  const reviewText = coverageReview
    ? reviewVerdict === 'MISSED'
      ? `MISSED (${reviewMissed} missed)`
      : String(reviewVerdict)
    : 'not run';

  const problemLines = problemItems.map((item) => judgedLine(item.candidate, item.judgment, mode));
  const perspectiveLines = perspectiveItems.map((item) => judgedLine(item.candidate, item.judgment, mode));
  const excludedLines = excludedItems.map(
    (item) => `- ${item.subject} ${item.attribute}: ${valuesText(item.values)} ${DASH} ${item.reason ?? item.exclusion}`,
  );

  const listOrNone = (lines) => (lines.length === 0 ? ['- none'] : lines);
  const text = [
    'AUDIT REPORT',
    `status: ${status}`,
    `mode: ${mode}`,
    `coverage: ${coverage.documents} documents ${DASH} extracted ${coverage.extracted}, read with no facts ${coverage.read_no_facts}, not read ${coverage.not_read}`,
    `facts: ${factList.length} valid, ${discardedList.length} discarded`,
    `problems (${problemLines.length}):`,
    ...listOrNone(problemLines),
    `differences explained by perspective or source (${perspectiveLines.length}):`,
    ...listOrNone(perspectiveLines),
    `excluded by the master's decisions (${excludedLines.length}):`,
    ...listOrNone(excludedLines),
    `hypotheses not treated as facts: ${hypotheses.length}`,
    'not checked:',
    ...listOrNone(notCheckedLines.map((line) => `- ${line}`)),
    `coverage review: ${reviewText}`,
  ].join('\n') + '\n';

  const toRecord = ({ candidate, judgment }) => ({
    cid: candidate.cid,
    category: judgment.category,
    related_to_change: judgment.related_to_change ?? null,
    subject: candidate.subject,
    attribute: candidate.attribute,
    values: candidate.values,
    locators: judgment.locators,
    reason: judgment.reason,
  });

  const json = {
    status,
    mode,
    coverage,
    facts: { valid: factList.length, discarded: discardedList.length },
    problems: problemItems.map(toRecord),
    perspective: perspectiveItems.map(toRecord),
    excluded: excludedItems.map((item) => ({
      subject: item.subject,
      attribute: item.attribute,
      values: item.values,
      reason: item.reason ?? item.exclusion,
    })),
    hypotheses: hypotheses.length,
    not_checked: notCheckedLines,
    // Quotes of the reviewer are not copied: they may come from master-only text.
    coverage_review: coverageReview
      ? {
          verdict: reviewVerdict,
          missed: Array.isArray(coverageReview.missed) ? coverageReview.missed.map((m) => ({ fid: m.fid })) : [],
        }
      : null,
  };

  return { status, json, text };
}
