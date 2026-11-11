#!/usr/bin/env node
// Places a finished image next to its campaign document and writes its sidecar;
// for generate and upload also prepares the draft of the document that links it.
// Usage: node image-place.mjs <root> --document <relPath> --alt "<text>" --provider <id> (--job <jobId> | --file <absPath>) [--review "<text>"]
// Exit codes: 0 placed, 1 refused (error: and message: lines), 2 usage error.

import path from 'node:path';
import { placeImage } from './lib/image-job.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node image-place.mjs <root> --document <relPath> --alt "<text>" --provider <id> (--job <jobId> | --file <absPath>) [--review "<text>"]';

const VALUE_OPTIONS = new Set(['--document', '--alt', '--provider', '--job', '--file', '--review']);

function parseArgs(argv) {
  const opts = { root: null, document: null, alt: null, provider: null, job: null, file: null, review: null };
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
  if (opts.root === null || opts.document === null || opts.alt === null || opts.provider === null) return null;
  if ((opts.job === null) === (opts.file === null)) return null;
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const result = placeImage({
    root: path.resolve(args.root),
    document: args.document,
    alt: args.alt,
    jobId: args.job,
    file: args.file === null ? null : path.resolve(args.file),
    provider: args.provider,
    review: args.review ?? '',
  });

  if (!result.ok) {
    process.stdout.write(`error: ${result.error}\n`);
    process.stdout.write(`message: ${result.message}\n`);
    exitWith(1);
    return;
  }
  process.stdout.write(`image: ${result.image}\n`);
  process.stdout.write(`sidecar: ${result.sidecar}\n`);
  process.stdout.write(`draft: ${result.draft ?? 'none'}\n`);
  exitWith(0);
}

runCli(main);
