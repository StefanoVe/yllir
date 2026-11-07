#!/usr/bin/env node
// Builds the subject index of a campaign and writes it as JSON.
// Usage: node build-index.mjs <campaignRoot> [--out <file>]
// Exit codes: 0 no index errors, 1 index errors, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { buildSubjectIndex } from './lib/subjects.mjs';

const USAGE = 'usage: node build-index.mjs <campaignRoot> [--out <file>]';

function parseArgs(argv) {
  let root = null;
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) return null;
      out = value;
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (root === null) {
      root = arg;
    } else {
      return null;
    }
  }
  return root === null ? null : { root, out };
}

const args = parseArgs(process.argv.slice(2));
if (args === null) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

const campaignRoot = path.resolve(args.root);
const index = buildSubjectIndex(campaignRoot);

const outFile =
  args.out === null
    ? path.join(campaignRoot, '.campaign', 'cache', 'subjects.json')
    : path.resolve(args.out);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(index, null, 2)}\n`);

process.stdout.write(
  `subjects: ${index.subjects.length}, homonyms: ${index.homonyms.length}, errors: ${index.errors.length}\n`,
);
process.exitCode = index.errors.length === 0 ? 0 : 1;
