#!/usr/bin/env node
// Checks one acquisition folder of import.
// Usage: node ingest-check.mjs <campaignRoot> --id <id> [--final] [--out <check.json>]
// Exit codes: 0 no errors, 1 errors, 2 usage error (or no folder for the id).

import fs from 'node:fs';
import path from 'node:path';
import { checkAcquisition, checkJson } from './lib/ingest-check.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node ingest-check.mjs <campaignRoot> --id <id> [--final] [--out <check.json>]';

function parseArgs(argv) {
  const opts = { root: null, id: null, final: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--final') {
      opts.final = true;
    } else if (arg === '--id' || arg === '--out') {
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
  if (opts.root === null || opts.id === null) return null;
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const result = checkAcquisition({
    campaignRoot: path.resolve(args.root),
    id: args.id,
    final: args.final,
  });

  if (args.out !== null) {
    const outFile = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(checkJson(result), null, 2)}\n`);
  }

  const { claims } = result;
  const uncovered = result.warnings.filter((warning) => warning.startsWith('uncovered: ')).length;
  process.stdout.write(`errors: ${result.errors.length}\n`);
  process.stdout.write(`warnings: ${result.warnings.length}\n`);
  process.stdout.write(
    `claims: ${claims.total} (open ${claims.open}, verified ${claims.verified}, conflict ${claims.conflict}, integrated ${claims.integrated}, excluded ${claims.excluded})\n`,
  );
  process.stdout.write(`open questions: ${result.open_questions.length}\n`);
  process.stdout.write(`uncovered: ${uncovered}\n`);
  for (const message of result.errors) process.stdout.write(`error: ${message}\n`);
  for (const message of result.warnings) process.stdout.write(`warning: ${message}\n`);
  exitWith(result.errors.length === 0 ? 0 : 1);
}

runCli(main);
