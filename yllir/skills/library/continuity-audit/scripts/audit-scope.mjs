#!/usr/bin/env node
// Computes the scope of a continuity audit and writes it as JSON.
// Usage: node audit-scope.mjs <campaignRoot> --mode pre|full [--files a.md,b.md] [--subjects x,y] --out <scope.json> [--reset]
// --reset first deletes <campaignRoot>/.campaign/state/audit and recreates its facts folder.
// Exit codes: 0 scope written without errors, 1 scope written with errors, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { computeScope } from './lib/audit-scope.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node audit-scope.mjs <campaignRoot> --mode pre|full [--files a.md,b.md] [--subjects x,y] --out <scope.json> [--reset]';
const VALUE_OPTIONS = new Set(['--mode', '--files', '--subjects', '--out']);

function parseArgs(argv) {
  const opts = { root: null, mode: null, files: null, subjects: null, out: null, reset: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reset') {
      opts.reset = true;
    } else if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) return null;
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
  return opts;
}

/** Comma-separated list; null when it has no item. */
function parseList(value) {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return items.length === 0 ? null : items;
}

function usage(message) {
  throw new Error(message ? `${message}\n${USAGE}` : USAGE);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null || args.root === null || args.out === null) usage();
  if (args.mode !== 'pre' && args.mode !== 'full') usage('--mode must be pre or full');

  const files = args.files === null ? [] : parseList(args.files);
  const subjects = args.subjects === null ? [] : parseList(args.subjects);
  if (files === null || subjects === null) usage('--files and --subjects need at least one item');
  if (args.mode === 'full' && (files.length > 0 || subjects.length > 0)) {
    usage('--files and --subjects are only used with --mode pre');
  }
  if (args.mode === 'pre' && files.length === 0 && subjects.length === 0) {
    usage('--mode pre needs --files or --subjects');
  }

  const campaignRoot = path.resolve(args.root);
  if (!fs.statSync(campaignRoot, { throwIfNoEntry: false })?.isDirectory()) {
    usage(`campaign folder not found: ${args.root}`);
  }

  if (args.reset) {
    if (!fs.existsSync(path.join(campaignRoot, 'campaign.yaml'))) {
      usage(`--reset needs a campaign folder with campaign.yaml: ${args.root}`);
    }
    const auditDir = path.join(campaignRoot, '.campaign', 'state', 'audit');
    fs.rmSync(auditDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(auditDir, 'facts'), { recursive: true });
  }

  const scope = computeScope(campaignRoot, { mode: args.mode, files, subjects });

  const outFile = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(scope, null, 2)}\n`);

  const external = scope.files.filter((file) => file.external).length;
  process.stdout.write(
    `mode: ${scope.mode}, subjects: ${scope.subjects.length}, documents: ${scope.files.length} (external, read-only: ${external}), errors: ${scope.errors.length}\n`,
  );
  for (const error of scope.errors) {
    process.stdout.write(`error: ${error.file}: ${error.message}\n`);
  }
  exitWith(scope.errors.length === 0 ? 0 : 1);
}

runCli(main);
