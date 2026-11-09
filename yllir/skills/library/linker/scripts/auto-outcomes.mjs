#!/usr/bin/env node
// Writes the APPLY outcomes of the obviously safe proposals of a plan and lists the rest.
// Usage: node auto-outcomes.mjs <campaignRoot> --plan <plan.json> --out <outcomes.json>
// Exit codes: 0 ok, 2 usage error or unreadable input.

import fs from 'node:fs';
import path from 'node:path';
import { autoOutcomes } from './lib/auto-outcomes.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';


const USAGE =
  'usage: node auto-outcomes.mjs <campaignRoot> --plan <plan.json> --out <outcomes.json>';

function parseArgs(argv) {
  const opts = { root: null, plan: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--plan' || arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) return null;
      if (opts[arg.slice(2)] !== null) return null;
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
  if (opts.root === null || opts.plan === null || opts.out === null) return null;
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

  const campaignRoot = path.resolve(args.root);
  const plan = readJson(path.resolve(args.plan));
  const { outcomes, uncertain } = autoOutcomes(campaignRoot, plan);

  const outFile = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(outcomes, null, 2)}\n`);

  const lines = [`auto: ${outcomes.length}`, `uncertain: ${uncertain.length}`];
  for (const pid of uncertain) lines.push(`uncertain ${pid}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  exitWith(0);
}

runCli(main);
