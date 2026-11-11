#!/usr/bin/env node
// Creates one image job from the public part of a campaign document.
// Usage: node image-prompt.mjs <root> --document <relPath> --operation generate|remove_background [--request "<text>"] [--image <relPath>]
// Exit codes: 0 job created, 1 refused (error: and message: lines), 2 usage error.
// The prompt is never printed: it stays in job.json.

import path from 'node:path';
import { buildJob } from './lib/image-job.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node image-prompt.mjs <root> --document <relPath> --operation generate|remove_background [--request "<text>"] [--image <relPath>]';

const VALUE_OPTIONS = new Set(['--document', '--operation', '--request', '--image']);

function parseArgs(argv) {
  const opts = { root: null, document: null, operation: null, request: null, image: null };
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
  if (opts.root === null || opts.document === null || opts.operation === null) return null;
  if (opts.operation !== 'generate' && opts.operation !== 'remove_background') return null;
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const result = buildJob({
    root: path.resolve(args.root),
    document: args.document,
    operation: args.operation === 'generate' ? 'generate' : 'remove_background',
    request: args.request ?? '',
    image: args.image,
  });

  if (!result.ok) {
    process.stdout.write(`error: ${result.error}\n`);
    process.stdout.write(`message: ${result.message}\n`);
    exitWith(1);
    return;
  }
  process.stdout.write(`job: ${result.jobId}\n`);
  process.stdout.write(`folder: ${result.jobDir}\n`);
  exitWith(0);
}

runCli(main);
