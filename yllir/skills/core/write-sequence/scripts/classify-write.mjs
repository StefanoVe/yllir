#!/usr/bin/env node
// Measures how big and risky a set of drafted campaign changes is, and writes
// the result as JSON. write-sequence reads the level to decide how many checks
// to run. Deterministic: it only reads files. The level is low, medium or high.
// Usage: node classify-write.mjs <campaignRoot> --files "a.md,b.md" --draft-dir <dir> [--subjects "id1,id2"] --out <json>
// The draft of document D is <draft-dir>/D; the existing document is <campaignRoot>/D.
// Exit codes: 0 when the computation finished (whatever the level), 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { classifyWrite } from './lib/classify-write.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node classify-write.mjs <campaignRoot> --files "a.md,b.md" --draft-dir <dir> [--subjects "id1,id2"] --out <json>';

// Every option takes one value. --subjects is optional, the others are required.
const OPTIONS = new Set(['--files', '--draft-dir', '--subjects', '--out']);
const REQUIRED = ['--files', '--draft-dir', '--out'];

function parseArgs(argv) {
  if (argv.length < 1) return null;
  const [root, ...rest] = argv;
  if (root === '' || root.startsWith('--')) return null;

  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const option = rest[i];
    if (!OPTIONS.has(option) || Object.hasOwn(opts, option)) return null;
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) return null;
    opts[option] = value;
    i++;
  }
  if (REQUIRED.some((option) => !Object.hasOwn(opts, option))) return null;
  return { root, opts };
}

/** Comma-separated list without empty items; null when it has no item. */
function parseList(value) {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return items.length === 0 ? null : items;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const files = parseList(args.opts['--files']);
  const draftDir = args.opts['--draft-dir'].trim();
  const outFile = args.opts['--out'].trim();
  if (files === null || draftDir === '' || outFile === '') throw new Error(USAGE);

  let subjects = [];
  if (args.opts['--subjects'] !== undefined) subjects = parseList(args.opts['--subjects']) ?? [];

  const result = classifyWrite(path.resolve(args.root), { files, draftDir, subjects });

  const out = path.resolve(outFile);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);

  process.stdout.write(`level: ${result.level}\n`);
  process.stdout.write(`decided by: ${result.decidedBy.join(', ')}\n`);
  for (const measure of result.measures) {
    process.stdout.write(`measure ${measure.name} ${measure.value} ${measure.level}\n`);
  }
  for (const file of result.reach) {
    process.stdout.write(`reach ${file}\n`);
  }
  process.stdout.write(`measures: ${result.measures.length}\n`);
  exitWith(0);
}

runCli(main);
