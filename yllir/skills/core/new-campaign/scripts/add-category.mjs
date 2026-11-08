#!/usr/bin/env node
// Adds a document category to a campaign and prints the result as JSON.
// Usage: node add-category.mjs <root> --id <slug> --folder "<folder>" --type <type>
// Exit codes: 0 added or already present, 1 refused or failed (see errors in the JSON), 2 usage error.

import path from 'node:path';
import { addCategory } from './lib/config-write.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node add-category.mjs <root> --id <slug> --folder "<folder>" --type <type>';
const VALUE_FLAGS = ['--id', '--folder', '--type'];

function parseArgs(argv) {
  const options = {};
  let root = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_FLAGS.includes(arg)) {
      if (i + 1 >= argv.length || Object.hasOwn(options, arg)) return null;
      options[arg] = argv[++i];
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (root === null) {
      root = arg;
    } else {
      return null;
    }
  }
  if (root === null || VALUE_FLAGS.some((flag) => !Object.hasOwn(options, flag))) return null;
  return { root, id: options['--id'], folder: options['--folder'], type: options['--type'] };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const result = addCategory(path.resolve(args.root), { id: args.id, folder: args.folder, type: args.type });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.errors.length === 0 ? 0 : 1);
}

runCli(main);
