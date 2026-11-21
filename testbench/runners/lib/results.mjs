// Reads the result records of the testbench (testbench/results/*.jsonl) and summarises them
// per group of runs: one case, one model and one instructions hash. Read-only; the records
// are written by the runners. A field missing from an old record is treated as unknown.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_RESULTS_DIR = path.resolve(import.meta.dirname, '../../results');

/**
 * Reads every *.jsonl file of dir (in name order). A blank line is skipped; a line that is
 * not a JSON object is skipped and listed in bad.
 * @param {string} [dir] the results folder
 * @returns {{ records: object[], bad: Array<{file: string, line: number, reason: string}> }}
 */
export function readResults(dir = DEFAULT_RESULTS_DIR) {
  const records = [];
  const bad = [];
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name)
    .sort();
  for (const file of files) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
    lines.forEach((text, index) => {
      if (text.trim() === '') return;
      const line = index + 1;
      let value;
      try {
        value = JSON.parse(text);
      } catch (err) {
        bad.push({ file, line, reason: err.message });
        return;
      }
      if (!isPlainObject(value)) {
        bad.push({ file, line, reason: 'not a JSON object' });
        return;
      }
      records.push(value);
    });
  }
  return { records, bad };
}

/** The group of a record: its case, its model and its instructions hash ('unknown' when missing). */
export function groupKey(record) {
  return `${record.case ?? 'unknown'}|${record.model ?? 'unknown'}|${record.instructions_hash ?? 'unknown'}`;
}

/**
 * Groups the records by groupKey and summarises each group. The result is sorted by case,
 * then model, then the newest date of the group, newest first.
 * Each summary: { case, model, instructions_hash, runs, passed, pass_rate, first_date, last_date,
 * failing_checks, time_overruns, call_overruns, median_duration_ms, median_tool_calls,
 * total_cost_usd, stability }. Unknown values are null (or 'unknown' for case, model and hash).
 * stability is the share of runs whose pass equals the majority outcome of the group.
 * @param {object[]} records
 * @returns {object[]}
 */
export function summarize(records) {
  const groups = new Map();
  for (const record of records) {
    const key = groupKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.values()].map(summarizeGroup).sort(compareSummaries);
}

function summarizeGroup(group) {
  const first = group[0];
  const runs = group.length;
  const passed = group.filter((record) => record.pass === true).length;
  const dates = group.map((record) => record.date).filter((date) => typeof date === 'string').sort();
  return {
    case: first.case ?? 'unknown',
    model: first.model ?? 'unknown',
    instructions_hash: first.instructions_hash ?? 'unknown',
    runs,
    passed,
    pass_rate: passed / runs,
    first_date: dates[0] ?? null,
    last_date: dates[dates.length - 1] ?? null,
    failing_checks: countFailingChecks(group),
    time_overruns: countFalse(group, 'L-time'),
    call_overruns: countFalse(group, 'L-calls'),
    median_duration_ms: median(numbers(group, 'duration_ms')),
    median_tool_calls: median(numbers(group, 'tool_calls')),
    total_cost_usd: sum(numbers(group, 'cost_usd')),
    stability: Math.max(passed, runs - passed) / runs,
  };
}

function compareSummaries(a, b) {
  return compareText(a.case, b.case) || compareText(a.model, b.model) || compareText(b.last_date ?? '', a.last_date ?? '');
}

/** -1, 0 or 1 for two strings, by code unit. */
export function compareText(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function countFailingChecks(group) {
  const counts = {};
  for (const record of group) {
    for (const [id, value] of Object.entries(checksOf(record))) {
      if (value === false) counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  return counts;
}

function countFalse(group, id) {
  return group.filter((record) => checksOf(record)[id] === false).length;
}

function checksOf(record) {
  return isPlainObject(record.checks) ? record.checks : {};
}

function numbers(group, field) {
  return group.map((record) => record[field]).filter((value) => typeof value === 'number' && Number.isFinite(value));
}

/** The median of a list of numbers, or null when the list is empty. */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sum(values) {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
