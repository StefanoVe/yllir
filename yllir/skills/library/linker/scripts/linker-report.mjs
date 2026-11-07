#!/usr/bin/env node
// Writes the LINKER REPORT of a linker run as a deterministic text file.
// Usage: node linker-report.mjs <root> --plan <plan.json> [--outcomes <outcomes.json>]
//          [--result <result.json>] [--check-exit <0|1|other|none>]
//          [--status-reason "<text>"] --continue-with "<text>" --out <report.txt>
// Exit codes: 0 report written, 2 usage error.

import path from 'node:path';
import { writeLinkerReport } from './lib/linker-report.mjs';

const USAGE =
  'usage: node linker-report.mjs <root> --plan <plan.json> [--outcomes <outcomes.json>] [--result <result.json>] ' +
  '[--check-exit <0|1|other|none>] [--status-reason "<text>"] --continue-with "<text>" --out <report.txt>';

const VALUE_FLAGS = new Set([
  '--plan',
  '--outcomes',
  '--result',
  '--check-exit',
  '--status-reason',
  '--continue-with',
  '--out',
]);

function parseArgs(argv) {
  const opts = {
    root: null,
    plan: null,
    outcomes: null,
    result: null,
    'check-exit': null,
    'status-reason': null,
    'continue-with': null,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) return null;
      opts[arg.slice(2)] = value;
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (opts.root === null) {
      opts.root = arg;
    } else {
      return null;
    }
  }
  if (opts.root === null || opts.plan === null || opts['continue-with'] === null || opts.out === null) {
    return null;
  }
  return opts;
}

const args = parseArgs(process.argv.slice(2));
if (args === null) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

const { status, outFile } = writeLinkerReport({
  root: path.resolve(args.root),
  planFile: path.resolve(args.plan),
  outcomesFile: args.outcomes === null ? null : path.resolve(args.outcomes),
  resultFile: args.result === null ? null : path.resolve(args.result),
  checkExit: args['check-exit'],
  statusReason: args['status-reason'],
  continueWith: args['continue-with'],
  outFile: path.resolve(args.out),
});

process.stdout.write(`report: ${outFile}, status: ${status}\n`);
process.exitCode = 0;
