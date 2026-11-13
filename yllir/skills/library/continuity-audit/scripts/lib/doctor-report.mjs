// Validates the doctor input of a continuity audit and renders the doctor section
// that is appended to the audit text. The doctor judges narrative and structural
// problems; this module only checks the shape of the judgments and their coverage,
// then lays them out by severity. Pure functions, no I/O.

const SEVERITIES = ['high', 'medium', 'low'];
const KINDS = ['structural', 'narrative'];
const SOLUTION_TYPES = ['mechanical', 'narrative'];
const QUERIES = ['errors', 'sketches', 'unreachable', 'forgotten', 'prices'];
const QUERY_STATES = ['ran', 'missing', 'failed'];
const CHECK_RE = /^doctor\.[a-z0-9]+(-[a-z0-9]+)*$/;

function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Checks one problem; returns a list of messages (empty when valid). */
function problemErrors(problem, where) {
  const errors = [];
  if (!isMapping(problem)) return [`${where} must be a mapping`];
  if (!isText(problem.title)) errors.push(`${where}.title must be non-empty text`);
  if (!SEVERITIES.includes(problem.severity)) errors.push(`${where}.severity must be high, medium or low`);
  if (!KINDS.includes(problem.kind)) errors.push(`${where}.kind must be structural or narrative`);
  if (!Array.isArray(problem.documents) || problem.documents.length === 0 || !problem.documents.every(isText)) {
    errors.push(`${where}.documents must be a non-empty list of document titles`);
  }
  if (!isText(problem.evidence)) errors.push(`${where}.evidence must be non-empty text`);
  if (!isText(problem.subject)) errors.push(`${where}.subject must be the id of the subject concerned`);
  if (typeof problem.check !== 'string' || !CHECK_RE.test(problem.check)) {
    errors.push(`${where}.check must be doctor.<name>, lowercase, such as doctor.open-thread`);
  }
  if (!isText(problem.value)) errors.push(`${where}.value must be non-empty text (the key of the exclusion)`);
  if (!Array.isArray(problem.solutions) || problem.solutions.length === 0) {
    errors.push(`${where}.solutions must be a non-empty list`);
  } else {
    problem.solutions.forEach((solution, index) => {
      const at = `${where}.solutions[${index}]`;
      if (!isMapping(solution)) errors.push(`${at} must be a mapping with text and type`);
      else {
        if (!isText(solution.text)) errors.push(`${at}.text must be non-empty text`);
        if (!SOLUTION_TYPES.includes(solution.type)) errors.push(`${at}.type must be mechanical or narrative`);
      }
    });
  }
  return errors;
}

/**
 * Validates the doctor input. Returns { valid, errors: string[] }.
 * A "no problem found" section (empty problems) is valid only with full coverage:
 * every query ran (prices may be missing when there is no economy document) and at
 * least one chronicle page or session was read.
 */
export function validateDoctor(input) {
  if (!isMapping(input)) return { valid: false, errors: ['doctor input must be a mapping'] };
  const errors = [];

  const coverage = input.coverage;
  if (!isMapping(coverage)) {
    errors.push('coverage must be a mapping with queries and read');
  } else {
    if (!isMapping(coverage.queries)) {
      errors.push('coverage.queries must be a mapping with errors, sketches, unreachable, forgotten and prices');
    } else {
      for (const name of QUERIES) {
        const state = coverage.queries[name];
        if (!QUERY_STATES.includes(state)) errors.push(`coverage.queries.${name} must be ran, missing or failed`);
        if (name !== 'prices' && state === 'missing') errors.push(`coverage.queries.${name} cannot be missing`);
      }
    }
    if (!Array.isArray(coverage.read) || !coverage.read.every(isText)) {
      errors.push('coverage.read must be a list of the chronicle pages and sessions read');
    }
  }

  if (!Array.isArray(input.problems)) {
    errors.push('problems must be a list (empty when no problem was found)');
    return { valid: false, errors };
  }
  input.problems.forEach((problem, index) => errors.push(...problemErrors(problem, `problems[${index}]`)));

  if (input.problems.length === 0 && isMapping(coverage) && isMapping(coverage.queries)) {
    const incomplete = QUERIES.filter((name) => {
      const state = coverage.queries[name];
      return !(state === 'ran' || (name === 'prices' && state === 'missing'));
    });
    if (incomplete.length > 0) {
      errors.push(`no problem found needs every query to have run; not run: ${incomplete.join(', ')}`);
    }
    if (!Array.isArray(coverage.read) || coverage.read.length === 0) {
      errors.push('no problem found needs at least one chronicle page or session read');
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Problems ordered by severity, stable on the input order. */
function ordered(problems) {
  const rank = (severity) => SEVERITIES.indexOf(severity);
  return problems
    .map((problem, index) => ({ problem, index }))
    .sort((a, b) => rank(a.problem.severity) - rank(b.problem.severity) || a.index - b.index)
    .map((item) => item.problem);
}

/** Lines of one high or medium problem. */
function problemBlock(problem) {
  const lines = [
    `- [${problem.severity}] [${problem.kind}] ${problem.title}`,
    `  documents: ${problem.documents.join(', ')}`,
    `  evidence: ${problem.evidence}`,
    '  solutions:',
  ];
  problem.solutions.forEach((solution, index) => {
    lines.push(`    ${index + 1}. (${solution.type}) ${solution.text}`);
  });
  return lines;
}

/**
 * Renders the doctor section as text. Low problems are grouped in one line per kind.
 * @returns {string}
 */
export function renderDoctorSection(input) {
  const { queries, read } = input.coverage;
  const queryText = QUERIES.map((name) => `${name} ${queries[name]}`).join(', ');
  const readText = read.length === 0 ? 'none' : `${read.length} (${read.join(', ')})`;
  const sorted = ordered(input.problems);
  const high = sorted.filter((p) => p.severity !== 'low');
  const low = sorted.filter((p) => p.severity === 'low');

  const lines = [
    'DOCTOR',
    `coverage queries: ${queryText}`,
    `coverage read: ${readText}`,
    `problems (${input.problems.length}):`,
  ];
  if (input.problems.length === 0) {
    lines.push('- no problem found');
  }
  for (const problem of high) lines.push(...problemBlock(problem));

  for (const kind of KINDS) {
    const group = low.filter((p) => p.kind === kind);
    if (group.length === 0) continue;
    lines.push(`- low, ${kind} (${group.length}): ${group.map((p) => p.title).join('; ')}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Builds the full report: the audit text followed by the doctor section.
 * Returns { valid, errors, text }; text is empty when the input is invalid.
 */
export function buildFullReport(auditText, input) {
  const { valid, errors } = validateDoctor(input);
  if (!valid) return { valid: false, errors, text: '' };
  const base = auditText.endsWith('\n') ? auditText : `${auditText}\n`;
  return { valid: true, errors: [], text: `${base}\n${renderDoctorSection(input)}` };
}
