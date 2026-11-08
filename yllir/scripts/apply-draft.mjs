#!/usr/bin/env node
// Copies drafted Markdown files into a campaign and prints the result as JSON.
// Usage: node apply-draft.mjs <root> --draft-dir <dir> --files "a.md,b.md"
// The draft of each file is <draft-dir>/<file>; a relative draft-dir is resolved against root.
// Exit codes: 0 written, 1 refused (nothing written, see errors in the JSON), 2 usage error.

import path from 'node:path';
import { applyDraft } from './lib/apply-draft.mjs';
import { exitWith, runCli } from './lib/cli-exit.mjs';

const USAGE = 'usage: node apply-draft.mjs <root> --draft-dir <dir> --files "a.md,b.md"';
const VALUE_FLAGS = ['--draft-dir', '--files'];

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
  return { root, draftDir: options['--draft-dir'], files: options['--files'] };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const files = args.files
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  const result = applyDraft(path.resolve(args.root), { draftDir: args.draftDir, files });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.errors.length === 0 ? 0 : 1);
}

runCli(main);
