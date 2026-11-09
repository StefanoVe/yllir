#!/usr/bin/env node
// Plans the links of a campaign and writes the plan as JSON.
// Usage: node plan-links.mjs <campaignRoot> [--files a.md,b.md] [--subjects id1,id2] --out <plan.json>
// Exit codes: 0 plan written without errors, 1 the plan has errors, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { planLinks } from './lib/link-plan.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';


const USAGE =
  'usage: node plan-links.mjs <campaignRoot> [--files a.md,b.md] [--subjects id1,id2] --out <plan.json>';

function parseArgs(argv) {
  const opts = { root: null, files: null, subjects: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // An empty --subjects is the same as omitting it: no subjects.
    if (arg === '--subjects' && argv[i + 1] === '') {
      i++;
      continue;
    }
    if (arg === '--files' || arg === '--subjects' || arg === '--out') {
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
  if (opts.root === null || opts.out === null) return null;
  return opts;
}

/** Comma-separated list; null when it has no item. */
function parseList(value) {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return items.length === 0 ? null : items;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = args === null || args.files === null ? null : parseList(args.files);
  const subjects = args === null || args.subjects === null ? null : parseList(args.subjects);
  if (args === null || (args.files !== null && files === null) || (args.subjects !== null && subjects === null)) {
    throw new Error(USAGE);
  }

  const campaignRoot = path.resolve(args.root);
  const plan = planLinks(campaignRoot, { files, subjects });

  const outFile = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(plan, null, 2)}\n`);

  process.stdout.write(
    `proposals: ${plan.proposals.length}, review: ${plan.review.length}, scope: ${plan.scope.length} files, errors: ${plan.errors.length}\n`,
  );
  exitWith(plan.errors.length === 0 ? 0 : 1);
}

runCli(main);
