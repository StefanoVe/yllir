#!/usr/bin/env node
// Applies the approved links of a plan and reports what is left.
// Usage: node apply-links.mjs <campaignRoot> --plan <plan.json> --outcomes <outcomes.json> [--out <result.json>]
// Exit codes: 0 ok, 1 not ok (see the printed counts), 2 usage error or unreadable input.

import fs from 'node:fs';
import path from 'node:path';
import { applyLinks } from './lib/apply-links.mjs';import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';


const USAGE =
  'usage: node apply-links.mjs <campaignRoot> --plan <plan.json> --outcomes <outcomes.json> [--out <result.json>]';

function parseArgs(argv) {
  const opts = { root: null, plan: null, outcomes: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--plan' || arg === '--outcomes' || arg === '--out') {
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
  if (opts.root === null || opts.plan === null || opts.outcomes === null) return null;
  return opts;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read ${file}: ${err.message}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const plan = readJson(path.resolve(args.plan));
  if (
    plan === null ||
    typeof plan !== 'object' ||
    !Array.isArray(plan.proposals) ||
    !Array.isArray(plan.scope)
  ) {
    throw new Error(`${path.resolve(args.plan)} is not a link plan`);
  }

  const outcomes = readJson(path.resolve(args.outcomes));
  if (!Array.isArray(outcomes)) {
    throw new Error(`${path.resolve(args.outcomes)} must contain a JSON array`);
  }

  const campaignRoot = path.resolve(args.root);
  const result = applyLinks(campaignRoot, plan, outcomes);

  if (args.out !== null) {
    const outFile = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
  }

  process.stdout.write(
    `applied: ${result.applied.length}, skipped: ${result.skipped.length}, rejected: ${result.rejected.length}, ` +
      `missing: ${result.missing_outcome.length}, omit/ask/fix: ${result.omit.length}/${result.ask.length}/${result.fix.length}, ` +
      `residual unexplained: ${result.residual_unexplained.length}, ok: ${result.ok}\n`,
  );
  exitWith(result.ok ? 0 : 1);
}

runCli(main);
