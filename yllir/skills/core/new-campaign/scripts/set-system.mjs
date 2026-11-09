#!/usr/bin/env node
// Sets the game-rules adapter of a campaign, or lists the installed adapters, and prints the result as JSON.
// Usage: node set-system.mjs <root> --list
//        node set-system.mjs <root> --adapter <id>
// Exit codes: 0 ok, 1 refused or failed (see errors in the JSON), 2 usage error.

import path from 'node:path';
import { listInstalledAdapters, setSystemAdapter } from './lib/set-system.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node set-system.mjs <root> --list | node set-system.mjs <root> --adapter <id>';
const VALUE_FLAGS = ['--adapter'];

function parseArgs(argv) {
  const options = {};
  let root = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') {
      if (Object.hasOwn(options, '--list')) return null;
      options['--list'] = true;
    } else if (VALUE_FLAGS.includes(arg)) {
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
  if (root === null) return null;
  const list = Object.hasOwn(options, '--list');
  const hasAdapter = Object.hasOwn(options, '--adapter');
  if (list === hasAdapter) return null; // exactly one of --list and --adapter
  return { root, list, adapter: options['--adapter'] };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  if (args.list) {
    process.stdout.write(`${JSON.stringify({ adapters: listInstalledAdapters() }, null, 2)}\n`);
    exitWith(0);
    return;
  }

  const result = setSystemAdapter(path.resolve(args.root), args.adapter);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.errors.length === 0 ? 0 : 1);
}

runCli(main);
