#!/usr/bin/env node
// Validates a reviewer's answer against a search result and writes the RESEARCH
// REPORT as plain text. The report is written in every case, also when the
// answer is missing or broken.
// Usage: node research-report.mjs <campaignRoot> --search <search.json> --answer <answer.json>
//          --continue-with "<text>" --out <report.txt>
// Exit codes: 0 DONE, 1 NEEDS_ATTENTION, 2 usage error, 3 FAILED.

import path from 'node:path';
import { writeResearchReport } from './lib/research-report.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node research-report.mjs <campaignRoot> --search <search.json> --answer <answer.json> ' +
  '--continue-with "<text>" --out <report.txt>';

const EXIT_BY_STATUS = { DONE: 0, NEEDS_ATTENTION: 1, FAILED: 3 };

const FLAGS = new Set(['--search', '--answer', '--continue-with', '--out']);

function parseArgs(argv) {
  const opts = { root: null, search: null, answer: null, 'continue-with': null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (FLAGS.has(arg)) {
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
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (
    args === null ||
    args.root === null ||
    args.search === null ||
    args.answer === null ||
    args['continue-with'] === null ||
    args.out === null
  ) {
    throw new Error(USAGE);
  }

  const { status, outFile, problems } = writeResearchReport({
    root: path.resolve(args.root),
    searchFile: path.resolve(args.search),
    answerFile: path.resolve(args.answer),
    continueWith: args['continue-with'],
    outFile: path.resolve(args.out),
  });

  process.stdout.write(`${outFile}\n`);
  process.stdout.write(`status: ${status}\n`);
  for (const problem of problems) process.stdout.write(`- ${problem}\n`);
  exitWith(EXIT_BY_STATUS[status]);
}

runCli(main);
