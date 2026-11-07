#!/usr/bin/env node
// Validates the facts written by the extractor agents for an audit scope, and
// writes the checked facts, the coverage and the discards as JSON.
// Usage: node audit-validate.mjs <campaignRoot> --scope <scope.json> --facts-dir <dir> --out <facts.json>
// Exit codes: 0 complete (every scope document was read), 1 not complete or
// with errors, 2 usage error or unreadable input.

import fs from 'node:fs';
import path from 'node:path';
import { validateFacts } from './lib/audit-facts.mjs';
import { loadVocabulary } from './lib/audit-vocabulary.mjs';

const USAGE =
  'usage: node audit-validate.mjs <campaignRoot> --scope <scope.json> --facts-dir <dir> --out <facts.json>';
const VALUE_OPTIONS = new Set(['--scope', '--facts-dir', '--out']);

function parseArgs(argv) {
  const opts = { root: null, scope: null, 'facts-dir': null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTIONS.has(arg)) {
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

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
if (args === null || args.root === null || args.scope === null || args['facts-dir'] === null || args.out === null) {
  usage();
}

const campaignRoot = path.resolve(args.root);
if (!fs.statSync(campaignRoot, { throwIfNoEntry: false })?.isDirectory()) {
  usage(`campaign folder not found: ${args.root}`);
}

let scope;
try {
  scope = JSON.parse(fs.readFileSync(path.resolve(args.scope), 'utf8'));
} catch (err) {
  usage(`cannot read scope file: ${err.message}`);
}
const validScope =
  scope !== null &&
  typeof scope === 'object' &&
  Array.isArray(scope.files) &&
  scope.files.every((f) => f && typeof f.fid === 'string' && typeof f.document === 'string');
if (!validScope) usage('scope file is not a scope written by audit-scope');

let vocab;
try {
  vocab = loadVocabulary();
} catch (err) {
  usage(`cannot load vocabulary: ${err.message}`);
}

const result = validateFacts(campaignRoot, scope, path.resolve(args['facts-dir']), vocab);

const outFile = path.resolve(args.out);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);

const count = (status) => result.coverage.filter((c) => c.status === status).length;
process.stdout.write(
  `documents: ${result.coverage.length}, extracted: ${count('extracted')}, read: ${count('read')}, to-read: ${count('to-read')}, facts: ${result.facts.length}, discarded: ${result.discarded.length}, ignored (frontmatter): ${result.ignored_frontmatter.length}, complete: ${result.complete}\n`,
);
for (const entry of result.discarded) {
  process.stdout.write(`${entry.fid}#${entry.index + 1} ${entry.reason}\n`);
}
for (const error of result.errors) {
  process.stdout.write(`error ${error.fid} ${error.document}: ${error.message}\n`);
}
process.exitCode = result.complete ? 0 : 1;
