#!/usr/bin/env node
// Sets allow_model_imagination in a campaign's campaign.yaml and prints the result as JSON.
// Usage: node set-imagination.mjs <root> --value true|false|null
// Exit codes: 0 ok, 1 refused or failed (see errors in the JSON), 2 usage error.

import path from 'node:path';
import { setModelImagination } from './lib/set-imagination.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node set-imagination.mjs <root> --value true|false|null';
const VALUES = { true: true, false: false, null: null };

function parseArgs(argv) {
  let root = null;
  let value;
  let hasValue = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--value') {
      if (hasValue || i + 1 >= argv.length) return null;
      const text = argv[++i];
      if (!Object.hasOwn(VALUES, text)) return null;
      value = VALUES[text];
      hasValue = true;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (root === null) {
      root = arg;
    } else {
      return null;
    }
  }
  if (root === null || !hasValue) return null;
  return { root, value };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const result = setModelImagination(path.resolve(args.root), args.value);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.errors.length === 0 ? 0 : 1);
}

runCli(main);
