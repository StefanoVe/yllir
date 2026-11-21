#!/usr/bin/env node
// Blocks a release when a case gets worse than its previous measurement. For each case and model,
// the latest group of runs (by instructions hash, ordered by its newest run) is compared with the
// group before it. Author decision: blocked when the pass rate drops by more than one run in three
// (a drop greater than 0.34), so one unstable run is tolerated. Read-only.
//
// Usage: node testbench/runners/regression-gate.mjs [--results <dir>] [--tolerance <0..1>]
// Exit codes: 0 no case blocked; 1 some case blocked; 2 usage error.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RESULTS_DIR, compareText, readResults, summarize } from './lib/results.mjs';

export const TOLERANCE = 0.34;
// Float noise must not turn an exactly-at-tolerance drop into a block.
const EPSILON = 1e-9;
const USAGE = 'usage: node testbench/runners/regression-gate.mjs [--results <dir>] [--tolerance <0..1>]';

class UsageError extends Error {}

/**
 * Compares the latest group of each case and model with the one before it.
 * @param {object[]} groups summary groups, as returned by summarize
 * @param {number} [tolerance] the largest drop of pass rate that is not blocked
 * @returns {Array<{ case: string, model: string, current_hash: string, previous_hash: string | null,
 *   current_rate: number, previous_rate: number | null, drop: number | null, status: 'blocked' | 'ok' | 'no-baseline' }>}
 */
export function compare(groups, tolerance = TOLERANCE) {
  const series = new Map();
  for (const group of groups) {
    const key = `${group.case}\u0000${group.model}`;
    if (!series.has(key)) series.set(key, []);
    series.get(key).push(group);
  }
  return [...series.values()].map((list) => {
    const ordered = [...list].sort((a, b) => compareText(a.last_date ?? '', b.last_date ?? ''));
    const current = ordered[ordered.length - 1];
    const previous = ordered.length >= 2 ? ordered[ordered.length - 2] : null;
    if (previous === null) {
      return {
        case: current.case,
        model: current.model,
        current_hash: current.instructions_hash,
        previous_hash: null,
        current_rate: current.pass_rate,
        previous_rate: null,
        drop: null,
        status: 'no-baseline',
      };
    }
    const drop = previous.pass_rate - current.pass_rate;
    return {
      case: current.case,
      model: current.model,
      current_hash: current.instructions_hash,
      previous_hash: previous.instructions_hash,
      current_rate: current.pass_rate,
      previous_rate: previous.pass_rate,
      drop,
      status: drop > tolerance + EPSILON ? 'blocked' : 'ok',
    };
  });
}

/**
 * Reads the command line. Throws UsageError on an unknown argument, a missing value or a
 * tolerance outside 0..1.
 * @param {string[]} argv
 * @returns {{ results: string, tolerance: number }}
 */
export function parseArgs(argv) {
  const options = { results: DEFAULT_RESULTS_DIR, tolerance: TOLERANCE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--results' || arg === '--tolerance') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      i++;
      if (arg === '--results') {
        options.results = path.resolve(value);
      } else {
        const tolerance = Number(value);
        if (value.trim() === '' || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) {
          throw new UsageError('--tolerance must be a number from 0 to 1');
        }
        options.tolerance = tolerance;
      }
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  return options;
}

/** One printed line for a comparison. */
export function formatLine(item) {
  const label = { blocked: 'BLOCKED', ok: 'ok', 'no-baseline': 'no baseline' }[item.status];
  const head = `${label.padEnd(11)} ${item.case} [${item.model}]`;
  if (item.status === 'no-baseline') {
    return `${head}  now ${percent(item.current_rate)} (${show(item.current_hash)}), no earlier group`;
  }
  return `${head}  was ${percent(item.previous_rate)} (${show(item.previous_hash)}), now ${percent(item.current_rate)} (${show(item.current_hash)})`;
}

function show(value) {
  return value === null || value === undefined || value === 'unknown' ? '-' : value;
}

function percent(rate) {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Runs the gate. Prints one line per case and model to out, and the count of skipped bad lines to err.
 * @param {string[]} argv
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
  const items = compare(summarize(read.records), options.tolerance);
  for (const item of items) out.write(`${formatLine(item)}\n`);
  if (items.length === 0) out.write('no cases with results\n');
  if (read.bad.length > 0) err.write(`${read.bad.length} bad line(s) skipped\n`);
  return items.some((item) => item.status === 'blocked') ? 1 : 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on('error', (error) => {
    if (error.code !== 'EPIPE') throw error;
  });
  process.exitCode = main(process.argv.slice(2));
}
