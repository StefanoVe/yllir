#!/usr/bin/env node
// Generates a campaign's agent instructions (.campaign/instructions/agent.md
// and CLAUDE.md) and records their fingerprints, or checks those files
// for hand edits with --check.
// Usage: node generate-instructions.mjs <campaignRoot> [--check]
// Exit codes: 0 written or fingerprints ok, 1 errors or changed files, 2 usage error.

import path from 'node:path';
import { checkFingerprints, generateInstructions } from '../../../../scripts/lib/instructions.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node generate-instructions.mjs <campaignRoot> [--check]';

function parseArgs(argv) {
  let root = null;
  let check = false;
  for (const arg of argv) {
    if (arg === '--check') {
      if (check) return null;
      check = true;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (root === null) {
      root = arg;
    } else {
      return null;
    }
  }
  return root === null ? null : { root, check };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const campaignRoot = path.resolve(args.root);

  if (args.check) {
    const result = checkFingerprints(campaignRoot);
    if (result.ok) {
      process.stdout.write('fingerprints: ok\n');
    } else if (result.missing_version_file) {
      process.stdout.write('fingerprints: missing .campaign/version.yaml\n');
    } else {
      process.stdout.write(`changed: ${result.changed.join(', ')}\n`);
    }
    exitWith(result.ok ? 0 : 1);
  } else {
    const result = generateInstructions(campaignRoot);
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        const where = error.line === null ? error.file : `${error.file}:${error.line}`;
        process.stdout.write(`${where} ${error.code} ${error.message}\n`);
      }
      exitWith(1);
    } else {
      process.stdout.write(`written: ${result.written.join(', ')}\n`);
      exitWith(0);
    }
  }
}

runCli(main);
