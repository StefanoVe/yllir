#!/usr/bin/env node
// Inventories the files given to document-ingest and writes inventory.json.
// Usage: node ingest-inventory.mjs <campaignRoot> --inputs "<p1>,<p2>" --out <inventory.json>
// Exit codes: 0 no errors, 1 errors, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { buildInventory } from './lib/ingest-inventory.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node ingest-inventory.mjs <campaignRoot> --inputs "<p1>,<p2>" --out <inventory.json>';

function parseArgs(argv) {
  const opts = { root: null, inputs: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--inputs' || arg === '--out') {
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
  if (opts.root === null || opts.inputs === null || opts.out === null) return null;
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);
  const inputs = args.inputs.split(',').filter((item) => item !== '');
  if (inputs.length === 0) throw new Error(USAGE);

  const baseDir = process.cwd();
  const inventory = buildInventory({
    campaignRoot: path.resolve(args.root),
    inputs,
    baseDir,
  });

  const outFile = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(inventory, null, 2)}\n`);

  const count = (status) => inventory.files.filter((file) => file.status === status).length;
  const duplicates = count('duplicate-input') + count('duplicate-acquired');
  process.stdout.write(
    `files: ${inventory.files.length}, new: ${count('new')}, duplicates: ${duplicates}, errors: ${inventory.errors.length}\n`,
  );
  for (const message of inventory.errors) process.stdout.write(`error: ${message}\n`);
  exitWith(inventory.errors.length === 0 ? 0 : 1);
}

runCli(main);
