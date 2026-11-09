#!/usr/bin/env node
// Adds a document category to a campaign and prints the result as JSON.
// Usage: node add-category.mjs <root> --id <slug> --folder "<folder>" --type <type> [--source "<absolute path>"]
// With --source (only for type external) the folder is a symbolic link to that existing folder.
// Exit codes: 0 added or already present, 1 refused or failed (see errors in the JSON), 2 usage error.

import path from 'node:path';
import { addCategory } from './lib/config-write.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node add-category.mjs <root> --id <slug> --folder "<folder>" --type <type> [--source "<absolute path>"]';
const REQUIRED_FLAGS = ['--id', '--folder', '--type'];
const VALUE_FLAGS = [...REQUIRED_FLAGS, '--source'];

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
  if (root === null || REQUIRED_FLAGS.some((flag) => !Object.hasOwn(options, flag))) return null;
  return {
    root,
    id: options['--id'],
    folder: options['--folder'],
    type: options['--type'],
    source: options['--source'],
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const result = addCategory(path.resolve(args.root), {
    id: args.id,
    folder: args.folder,
    type: args.type,
    source: args.source,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.errors.length === 0 ? 0 : 1);
}

runCli(main);
