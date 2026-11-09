#!/usr/bin/env node
// Validates the campaign.yaml of a campaign. Prints one line per issue, or the
// whole result as JSON with --json.
// Usage: node validate-config.mjs <campaignRoot> [--json]
// Exit codes: 0 valid, 1 errors found, 2 usage error.

import path from 'node:path';
import { validateConfig } from '../../../../scripts/lib/config.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node validate-config.mjs <campaignRoot> [--json]';

function parseArgs(argv) {
  let root = null;
  let json = false;
  for (const arg of argv) {
    if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (root === null) {
      root = arg;
    } else {
      return null;
    }
  }
  return root === null ? null : { root, json };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const result = validateConfig(path.resolve(args.root));

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    for (const issue of result.errors) {
      process.stdout.write(`error ${issue.code} ${issue.path}: ${issue.message}\n`);
    }
    for (const issue of result.warnings) {
      process.stdout.write(`warning ${issue.code} ${issue.path}: ${issue.message}\n`);
    }
    process.stdout.write(`errors: ${result.errors.length}, warnings: ${result.warnings.length}\n`);
  }

  exitWith(result.ok ? 0 : 1);
}

runCli(main);
