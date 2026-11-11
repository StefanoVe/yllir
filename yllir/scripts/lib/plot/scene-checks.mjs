// Checks the form of the checks in a plot event file (a scene). Every check is a
// `### <Check label>: <check>` heading with exactly one `#### <success>` and one
// `#### <failure>` heading after it. Pure and synchronous: no clock, no randomness.
// Only the public body is read (the metadata block and the master-only block are not),
// and fenced code blocks are ignored. Line numbers are 1-based lines of the full file.

import { parseFrontmatter } from '../frontmatter.mjs';
import { publicBody } from '../public-text.mjs';

export const SCENE_CHECK_LABELS = {
  it: { check: 'Prova', success: 'Successo', failure: 'Fallimento' },
  en: { check: 'Check', success: 'Success', failure: 'Failure' },
};

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/;
const FENCE_RE = /^\s*```/;
const LEGACY_OUTCOME_RE = /^\s*[-*]\s+(\*\*)?(Successo|Fallimento|Success|Failure)(\*\*)?\s*:/iu;

// Prose patterns that ask for a check. Capital letters matter only in the first `prova di` pattern.
const PROSE_PATTERNS = {
  it: [
    { re: /\bCD\s*\d+/iu },
    { re: /\btir[oi]\s+salvezza\b/iu },
    { re: /\b(prova|prove|tiro|tiri)\s+(di|su)\s+\p{Lu}/u },
    { re: /\b(fa|fare|fate|faccia|facciano|chied\w*|richied\w*|tira|tirare|tirate)\b[^.!?]{0,30}\b(una\s+|un\s+)?(prova|tiro)\b/iu },
  ],
  en: [
    { re: /\bDC\s*\d+/iu },
    { re: /\bsaving\s+throws?\b/iu },
    { re: /\b(make|makes|roll|rolls|ask|asks|request|requests)\b[^.!?]{0,30}\b(check|roll|saving throw)\b/iu },
  ],
};

function error(code, line, message) {
  return { code, line, message };
}

function clean(text) {
  return text.replace(/[ \t]+#+[ \t]*$/, '').trim();
}

/**
 * Checks one scene file.
 * @param {string} markdown full file content
 * @param {string} lang 'it' or 'en'; any other value is treated as 'en'
 * @param {{ checkValue?: (value: string, lang: string) => Array<{ code: string, message: string }> }} [options]
 *   checkValue validates the value of each nonempty check heading (for example the game-rules adapter).
 * @returns {Array<{ code: string, line: number, message: string }>}
 */
export function checkScene(markdown, lang, { checkValue } = {}) {
  const language = lang === 'it' ? 'it' : 'en';
  const labels = SCENE_CHECK_LABELS[language];
  const text = String(markdown);
  const publicPart = publicBody(text);
  if (publicPart.trim() === '') return [];

  const { bodyStartLine } = parseFrontmatter(text);
  const errors = [];

  // Lines of the public body with their file line numbers; fenced code is marked.
  const lines = [];
  let inFence = false;
  publicPart.split('\n').forEach((raw, i) => {
    const value = raw.replace(/\r$/, '');
    const entry = { text: value, line: bodyStartLine + i, code: false };
    if (FENCE_RE.test(value)) {
      inFence = !inFence;
      entry.code = true;
    } else if (inFence) {
      entry.code = true;
    }
    lines.push(entry);
  });

  // Headings outside fenced code, in order.
  const headings = [];
  lines.forEach((entry, index) => {
    if (entry.code) return;
    const match = HEADING_RE.exec(entry.text);
    if (match) headings.push({ index, level: match[1].length, text: clean(match[2]), line: entry.line });
  });

  const checkLabelRe = new RegExp(`^${labels.check}:`, 'iu');
  const checkValueRe = new RegExp(`^${labels.check}:\\s*(.*)$`, 'iu');
  const successKey = labels.success.toLowerCase();
  const failureKey = labels.failure.toLowerCase();

  // A check block runs from its check heading to the next heading of level 1-3 (or the end).
  const blocks = [];
  headings.forEach((heading, p) => {
    if (heading.level !== 3 || !checkLabelRe.test(heading.text)) return;
    let q = p + 1;
    while (q < headings.length && headings[q].level > 3) q++;
    blocks.push({ start: p, stop: q });
  });
  const inBlockHeading = new Set();
  for (const block of blocks) {
    for (let p = block.start; p < block.stop; p++) inBlockHeading.add(p);
  }

  headings.forEach((heading, p) => {
    if (heading.level === 3 && !checkLabelRe.test(heading.text)) {
      errors.push(error('check-heading-form', heading.line,
        `### is only for checks: write "### ${labels.check}: <check>"`));
    }
    if (heading.level === 3 && checkLabelRe.test(heading.text)) {
      const value = checkValueRe.exec(heading.text)[1].trim();
      if (value === '') {
        errors.push(error('check-missing-value', heading.line,
          `check heading has no check after the colon: write "### ${labels.check}: <check>"`));
      } else if (typeof checkValue === 'function') {
        for (const entry of checkValue(value, language)) {
          errors.push(error(entry.code, heading.line, entry.message));
        }
      }
    }
    if (heading.level === 4 && !inBlockHeading.has(p)) {
      errors.push(error('check-outcome-outside', heading.line,
        `#### ${heading.text} is outside a check: put it under a "### ${labels.check}: <check>" heading`));
    }
  });

  // Lines that belong to a check block (from its heading up to the next block end).
  const inBlockLine = new Set();
  for (const block of blocks) {
    const from = headings[block.start].index;
    const to = block.stop < headings.length ? headings[block.stop].index : lines.length;
    for (let i = from; i < to; i++) inBlockLine.add(i);
  }

  for (const block of blocks) {
    const checkHeading = headings[block.start];
    const outcomes = [];
    for (let p = block.start + 1; p < block.stop; p++) {
      const heading = headings[p];
      if (heading.level !== 4) continue;
      const key = heading.text.toLowerCase();
      const kind = key === successKey ? 'success' : key === failureKey ? 'failure' : 'other';
      outcomes.push({ kind, heading, position: p });
      if (kind === 'other') {
        errors.push(error('check-outcome-heading', heading.line,
          `#### ${heading.text} is not an outcome: write "#### ${labels.success}" and "#### ${labels.failure}" inside the check`));
      }
    }

    const seen = new Set();
    for (const outcome of outcomes) {
      if (outcome.kind === 'other') continue;
      if (seen.has(outcome.kind)) {
        errors.push(error('check-outcome-heading', outcome.heading.line,
          `#### ${outcome.heading.text} is repeated in the check: write it once`));
      }
      seen.add(outcome.kind);
    }

    const successes = outcomes.filter((o) => o.kind === 'success');
    const failures = outcomes.filter((o) => o.kind === 'failure');
    const missing = successes.length === 0 || failures.length === 0
      || failures[0].position < successes[0].position;
    if (missing) {
      errors.push(error('check-missing-outcome', checkHeading.line,
        `check needs "#### ${labels.success}" followed by "#### ${labels.failure}"`));
    }

    // An outcome has text when a nonblank line comes before the next heading (of any level) or the block end.
    for (const outcome of outcomes) {
      if (outcome.kind === 'other') continue;
      const nextHeading = headings[outcome.position + 1];
      const stop = nextHeading ? nextHeading.index : lines.length;
      const hasText = lines.slice(outcome.heading.index + 1, stop).some((entry) => entry.text.trim() !== '');
      if (!hasText) {
        errors.push(error('check-empty-outcome', outcome.heading.line,
          `#### ${outcome.heading.text} has no text`));
      }
    }
  }

  lines.forEach((entry, index) => {
    if (entry.code || HEADING_RE.test(entry.text)) return;
    if (LEGACY_OUTCOME_RE.test(entry.text)) {
      errors.push(error('check-legacy-outcomes', entry.line,
        `outcome written as a list item: write "#### ${labels.success}" and "#### ${labels.failure}" headings instead`));
    }
    if (inBlockLine.has(index)) return;
    if (PROSE_PATTERNS[language].some((pattern) => pattern.re.test(entry.text))) {
      errors.push(error('check-outside-heading', entry.line,
        `a check written in prose: write it as "### ${labels.check}: <check>" with "#### ${labels.success}" and "#### ${labels.failure}"`));
    }
  });

  return errors;
}
