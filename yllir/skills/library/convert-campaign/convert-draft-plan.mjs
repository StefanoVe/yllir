#!/usr/bin/env node
// Drafts the structured plan of a campaign convert from the structure report, the rules and the
// overrides (spec issue #138, section 8.2), and writes the plan and a small summary.
// Usage: node convert-draft-plan.mjs <campaign root> --report <structure.json> --rules <rules.json>
//          [--overrides <overrides.json>] --out <plan.json> --summary <summary.json>
// Exit codes: 0 ok, 1 invalid rules or overrides (errors on stdout, nothing written), 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { draftPlan } from './lib/convert-draft-plan.mjs';
import { exitWith, runCli } from '../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node convert-draft-plan.mjs <campaign root> --report <structure.json> --rules <rules.json> '
  + '[--overrides <overrides.json>] --out <plan.json> --summary <summary.json>';
const FLAGS = new Set(['--report', '--rules', '--overrides', '--out', '--summary']);

function parseArgs(argv) {
  const opts = { root: null, report: null, rules: null, overrides: null, out: null, summary: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (FLAGS.has(arg)) {
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
  if (opts.root === null || opts.report === null || opts.rules === null || opts.out === null || opts.summary === null) {
    return null;
  }
  return opts;
}

/** Reads a JSON file. A missing file is a usage error (exit 2); a broken one is returned as an error. */
function readJson(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${label}: ${err.message}`);
  }
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { error: { code: 'bad-rules', message: `${label} is not valid JSON: ${err.message}` } };
  }
}

function printErrors(errors) {
  process.stdout.write(`${JSON.stringify({ ok: false, errors }, null, 2)}\n`);
  exitWith(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const report = readJson(args.report, 'report');
  if (report.error) throw new Error(report.error.message);
  const rules = readJson(args.rules, 'rules');
  if (rules.error) {
    printErrors([rules.error]);
    return;
  }
  let overrides = {};
  if (args.overrides !== null) {
    const parsed = readJson(args.overrides, 'overrides');
    if (parsed.error) {
      printErrors([{ code: 'bad-overrides', message: parsed.error.message }]);
      return;
    }
    overrides = parsed.value;
  }

  const result = draftPlan({
    campaignRoot: path.resolve(args.root),
    report: report.value,
    rules: rules.value,
    overrides,
  });
  if (!result.ok) {
    printErrors(result.errors);
    return;
  }

  for (const [file, value] of [[args.out, result.plan], [args.summary, result.summary]]) {
    const target = path.resolve(file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  }
  const { counts, exceptions } = result.summary;
  process.stdout.write(
    `documents: ${result.plan.documents.length}, move: ${counts.move}, plot: ${counts.plot}, `
    + `scenes: ${counts.scenes}, source: ${counts.source}, skip: ${counts.skip}, full: ${counts.full}, `
    + `exceptions: ${exceptions.length}\n`,
  );
  exitWith(0);
}

runCli(main);
