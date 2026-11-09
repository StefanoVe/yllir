#!/usr/bin/env node
// Checks every link and image of a campaign: targets, anchors, the master-only
// privacy rule, and Markdown errors. Prints one line per error.
// Usage: node check-links.mjs <campaignRoot> [--files a.md,b.md] [--out <result.json>]
// Exit codes: 0 no errors, 1 errors found, 2 usage error or unreadable campaign.yaml.

import fs from 'node:fs';
import path from 'node:path';
import { checkLinks } from './lib/check-links.mjs';
import { readStructure } from '../../../../scripts/lib/subjects.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node check-links.mjs <campaignRoot> [--files a.md,b.md] [--out <result.json>]';

function parseArgs(argv) {
  let root = null;
  let files = null;
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--files' || arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) return null;
      if (arg === '--files') {
        files = value.split(',');
        if (files.some((file) => file === '')) return null;
      } else {
        out = value;
      }
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (root === null) {
      root = arg;
    } else {
      return null;
    }
  }
  return root === null ? null : { root, files, out };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const campaignRoot = path.resolve(args.root);
  const { structure, errors: structureErrors } = readStructure(campaignRoot);
  if (structure === null) {
    throw new Error(`${structureErrors[0].file}: ${structureErrors[0].message}`);
  }

  const result = checkLinks(campaignRoot, { files: args.files });

  for (const error of result.errors) {
    process.stdout.write(`${error.file}:${error.line}:${error.col} ${error.code} ${error.message}\n`);
  }
  process.stdout.write(
    `checked: ${result.checked.length} files, links: ${result.links}, errors: ${result.errors.length}\n`,
  );

  if (args.out !== null) {
    const outFile = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
  }

  exitWith(result.errors.length === 0 ? 0 : 1);
}

runCli(main);
