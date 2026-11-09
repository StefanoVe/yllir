#!/usr/bin/env node
// Prints the local date as YYYY-MM-DD. Takes no arguments.
// Usage: node today.mjs
// Exit codes: 0 success, 2 usage error.

import { today } from './lib/today.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node today.mjs';

function main() {
  if (process.argv.length > 2) throw new Error(USAGE);

  process.stdout.write(`${today()}\n`);
  exitWith(0);
}

runCli(main);
