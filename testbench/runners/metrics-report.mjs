#!/usr/bin/env node
// Prints the metrics of the testbench results as one Markdown table: one row per group of runs
// (case, model, instructions hash). Read-only.
//
// Usage: node testbench/runners/metrics-report.mjs [--results <dir>] [--case <substring>] [--json]
// Exit codes: 0 always; 2 usage error (bad argument, unreadable results folder).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RESULTS_DIR, readResults, summarize } from './lib/results.mjs';

const USAGE = 'usage: node testbench/runners/metrics-report.mjs [--results <dir>] [--case <substring>] [--json]';
const HEADER = ['case', 'model', 'hash', 'runs', 'pass', 'stability', 'failing checks', 'time over', 'calls over', 'median min', 'cost $'];

class UsageError extends Error {}

/**
 * Reads the command line. Throws UsageError on an unknown argument or a missing value.
 * @param {string[]} argv the arguments after the script name
 * @returns {{ results: string, caseFilter: string | null, json: boolean }}
 */
export function parseArgs(argv) {
  const options = { results: DEFAULT_RESULTS_DIR, caseFilter: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--results' || arg === '--case') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      i++;
      if (arg === '--results') options.results = path.resolve(value);
      else options.caseFilter = value;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  return options;
}

/**
 * The Markdown table of the summary groups (as returned by summarize): a header, the separator
 * and one row per group. Unknown values print as '-'.
 * @param {object[]} groups
 * @returns {string}
 */
export function formatTable(groups) {
  const lines = [row(HEADER), row(HEADER.map(() => '---')), ...groups.map((group) => row(formatCells(group)))];
  return lines.join('\n');
}

/** The table cells of one group, in the order of HEADER. */
export function formatCells(group) {
  return [
    group.case,
    show(group.model),
    show(group.instructions_hash),
    group.runs,
    `${group.passed}/${group.runs} (${percent(group.pass_rate)})`,
    percent(group.stability),
    formatFailingChecks(group.failing_checks),
    group.time_overruns,
    group.call_overruns,
    group.median_duration_ms === null || group.median_duration_ms === undefined
      ? '-'
      : (group.median_duration_ms / 60000).toFixed(1),
    group.total_cost_usd === null || group.total_cost_usd === undefined ? '-' : group.total_cost_usd.toFixed(3),
  ];
}

/** 'A1×2, L-time×1', sorted by count (highest first) then by id; '-' when no check failed. */
export function formatFailingChecks(counts) {
  const entries = Object.entries(counts ?? {}).filter(([, count]) => count > 0);
  if (entries.length === 0) return '-';
  entries.sort(([idA, a], [idB, b]) => b - a || (idA < idB ? -1 : idA > idB ? 1 : 0));
  return entries.map(([id, count]) => `${id}×${count}`).join(', ');
}

function row(cells) {
  return `| ${cells.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`;
}

function show(value) {
  return value === null || value === undefined || value === 'unknown' ? '-' : value;
}

function percent(rate) {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Runs the report. Writes the table (or the JSON summary) to out, and the count of skipped bad
 * lines to err.
 * @param {string[]} argv the arguments after the script name
 * @param {{ out?: { write: (text: string) => void }, err?: { write: (text: string) => void } }} [streams]
 * @returns {number} the exit code
 */
export function main(argv, { out = process.stdout, err = process.stderr } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }
  let read;
  try {
    read = readResults(options.results);
  } catch (error) {
    err.write(`cannot read the results folder ${options.results}: ${error.message}\n`);
    return 2;
  }
  const groups = summarize(read.records).filter(
    (group) => options.caseFilter === null || group.case.includes(options.caseFilter),
  );
  out.write(`${options.json ? JSON.stringify(groups, null, 2) : formatTable(groups)}\n`);
  if (read.bad.length > 0) err.write(`${read.bad.length} bad line(s) skipped\n`);
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on('error', (error) => {
    if (error.code !== 'EPIPE') throw error;
  });
  process.exitCode = main(process.argv.slice(2));
}
