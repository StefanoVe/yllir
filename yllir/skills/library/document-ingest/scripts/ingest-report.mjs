#!/usr/bin/env node
// Writes the INGEST REPORT of a run: runs the check (without --final) on each id.
// Usage: node ingest-report.mjs <campaignRoot> --ids a,b --out <report.txt> [--duplicates N]
//        [--write-report <file>] [--audit-report <file>] [--continue-with "<text>"] [--status-reason "<text>"]
// Exit codes: 0 report written (whatever its status), 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { buildReport } from './lib/ingest-report.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node ingest-report.mjs <campaignRoot> --ids a,b --out <report.txt> [--duplicates N] [--write-report <file>] [--audit-report <file>] [--continue-with "<text>"] [--status-reason "<text>"]';

const VALUE_OPTIONS = new Set([
  '--ids',
  '--out',
  '--duplicates',
  '--write-report',
  '--audit-report',
  '--continue-with',
  '--status-reason',
]);

function parseArgs(argv) {
  const opts = {
    root: null,
    ids: null,
    out: null,
    duplicates: '0',
    'write-report': null,
    'audit-report': null,
    'continue-with': null,
    'status-reason': null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
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
  if (opts.root === null || opts.ids === null || opts.out === null) return null;
  if (!/^\d+$/.test(opts.duplicates)) return null;
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const ids = args.ids.split(',').map((item) => item.trim()).filter((item) => item !== '');

  const readOptional = (file) => (file === null ? null : fs.readFileSync(path.resolve(file), 'utf8'));
  const { status, text } = buildReport({
    campaignRoot: path.resolve(args.root),
    ids,
    duplicates: Number(args.duplicates),
    writeText: readOptional(args['write-report']),
    auditText: readOptional(args['audit-report']),
    continueWith: args['continue-with'],
    statusReason: args['status-reason'],
  });

  const outFile = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, text);

  process.stdout.write(`status: ${status}\n`);
  exitWith(0);
}

runCli(main);
