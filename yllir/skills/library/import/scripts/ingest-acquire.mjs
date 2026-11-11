#!/usr/bin/env node
// Creates the acquisition folders of the new files of an inventory.
// Usage: node ingest-acquire.mjs <campaignRoot> --inventory <inventory.json> --provenance "<text>" --date YYYY-MM-DD [--kind <kind>]
// Exit codes: 0 no errors, 1 errors, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { acquireSources } from './lib/ingest-acquire.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node ingest-acquire.mjs <campaignRoot> --inventory <inventory.json> --provenance "<text>" --date YYYY-MM-DD [--kind <kind>]';

const VALUE_OPTIONS = new Set(['--inventory', '--provenance', '--date', '--kind']);

function parseArgs(argv) {
  const opts = { root: null, inventory: null, provenance: null, date: null, kind: null };
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
  if (opts.root === null || opts.inventory === null || opts.provenance === null || opts.date === null) {
    return null;
  }
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const inventory = JSON.parse(fs.readFileSync(path.resolve(args.inventory), 'utf8'));
  const result = acquireSources({
    campaignRoot: path.resolve(args.root),
    inventory,
    provenance: args.provenance,
    date: args.date,
    kind: args.kind ?? 'other',
    baseDir: process.cwd(),
  });

  process.stdout.write(`acquired: ${result.acquired.length}, skipped: ${result.skipped.length}, errors: ${result.errors.length}\n`);
  process.stdout.write(`ids: ${result.acquired.length > 0 ? result.acquired.join(',') : 'none'}\n`);
  for (const message of result.errors) process.stdout.write(`error: ${message}\n`);
  exitWith(result.errors.length === 0 ? 0 : 1);
}

runCli(main);
