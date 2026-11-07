#!/usr/bin/env node
// Builds the subject index of a campaign, scans its text for mentions, and
// writes the result as JSON.
// Usage: node scan-mentions.mjs <campaignRoot> [--out <file>]
// Exit codes: 0 scan done (bare mentions do not change the code), 1 the index
// has errors, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { buildSubjectIndex } from './lib/subjects.mjs';
import { scanMentions } from './lib/mentions.mjs';

const USAGE = 'usage: node scan-mentions.mjs <campaignRoot> [--out <file>]';
const SUMMARY_ORDER = [
  'bare',
  'linked',
  'linked-elsewhere',
  'ambiguous',
  'self',
  'excluded-title',
  'excluded-italic',
  'excluded-code',
  'excluded-comment',
  'excluded-image',
  'excluded-diagram',
];

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
const scan = scanMentions(campaignRoot, index);

const report = {
  index_errors: index.errors,
  homonyms: index.homonyms,
  ...scan,
};

const outFile =
  args.out === null
    ? path.join(campaignRoot, '.campaign', 'cache', 'mentions.json')
    : path.resolve(args.out);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);

const line = SUMMARY_ORDER.map((state) => `${state}: ${scan.summary[state]}`).join(', ');
process.stdout.write(`${line}\n`);
process.exitCode = index.errors.length === 0 ? 0 : 1;
