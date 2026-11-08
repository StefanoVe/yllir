#!/usr/bin/env node
// Validates the judgments of an audit and writes the audit report (JSON and text).
// Usage: node audit-report.mjs --scope s.json --facts f.json --candidates c.json --judgments j.json
//          [--coverage-review r.json] --out <report.json> --text <report.txt>
// Exit codes: 0 COMPLETE, 1 INCOMPLETE, 3 INVALID, 2 usage error or unreadable input.

import fs from 'node:fs';
import path from 'node:path';
import { buildReport } from './lib/audit-report.mjs';import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';


const USAGE =
  'usage: node audit-report.mjs --scope s.json --facts f.json --candidates c.json --judgments j.json [--coverage-review r.json] --out <report.json> --text <report.txt>';

const VALUE_OPTIONS = ['--scope', '--facts', '--candidates', '--judgments', '--coverage-review', '--out', '--text'];

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTIONS.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) return null;
      opts[arg.slice(2)] = value;
      i++;
    } else {
      return null;
    }
  }
  for (const required of ['scope', 'facts', 'candidates', 'out', 'text']) {
    if (opts[required] === undefined) return null;
  }
  return opts;
}

/** Reads and parses a JSON file; null when it is missing or unreadable. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch {
    return null;
  }
}

function fail(message) {
  throw new Error(message);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) fail(USAGE);

  const scope = readJson(args.scope);
  const facts = readJson(args.facts);
  const candidates = readJson(args.candidates);
  if (scope === null || facts === null || candidates === null) {
    fail('error: cannot read --scope, --facts or --candidates as JSON');
  }

  // --judgments may be missing only when there are no candidates.
  const candidateCount = Array.isArray(candidates.candidates) ? candidates.candidates.length : 0;
  let judgments = [];
  if (args.judgments !== undefined) {
    if (fs.existsSync(path.resolve(args.judgments))) {
      judgments = readJson(args.judgments);
      if (judgments === null) {
        fail('error: cannot read --judgments as JSON');
      }
    } else if (candidateCount > 0) {
      fail(`error: --judgments file is missing but there are ${candidateCount} candidates`);
    }
  } else if (candidateCount > 0) {
    fail('error: --judgments is required when there are candidates');
  }

  let coverageReview;
  if (args['coverage-review'] !== undefined) {
    coverageReview = readJson(args['coverage-review']);
    if (coverageReview === null) {
      fail('error: cannot read --coverage-review as JSON');
    }
  }

  const report = buildReport({ scope, facts, candidates, judgments, coverageReview });

  const outFile = path.resolve(args.out);
  const textFile = path.resolve(args.text);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.mkdirSync(path.dirname(textFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report.json, null, 2)}\n`);
  fs.writeFileSync(textFile, report.text);

  process.stdout.write(report.text);

  const EXIT_CODES = { COMPLETE: 0, INCOMPLETE: 1, INVALID: 3 };
  exitWith(EXIT_CODES[report.status]);
}

runCli(main);
