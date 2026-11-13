#!/usr/bin/env node
// Opens a GitHub issue on the Yllir repository on behalf of a game master.
// Command: create [root] --title T --summary S [--steps S] [--expected S] [--actual S] [--dry-run]
// Tries the gh CLI, then the browser with a prefilled form, then keeps the text in
// the campaign (.campaign/state/issues). Root defaults to the working directory.
// Exit codes: 0 done (any status: created, browser or text), 2 usage error.
// Stdout is one JSON object, and the last line is always `exit: <code>`.

import path from 'node:path';
import { exitWith, runCli } from './lib/cli-exit.mjs';
import { createIssue } from './lib/issue-report.mjs';

const USAGE =
  'usage: node issue-report.mjs create [root] --title T --summary S [--steps S] [--expected S] [--actual S] [--dry-run]';

const VALUE_OPTIONS = ['title', 'summary', 'steps', 'expected', 'actual'];
const FLAG_OPTIONS = ['dry-run'];

class UsageError extends Error {}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== 'create') throw new UsageError(`unknown or missing command '${command ?? ''}'`);

  const options = {};
  let root;
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      if (root !== undefined) throw new UsageError(`unexpected argument '${token}' for create`);
      root = token;
      continue;
    }
    const key = token.slice(2);
    if (FLAG_OPTIONS.includes(key)) {
      options[key] = true;
      continue;
    }
    if (!VALUE_OPTIONS.includes(key)) throw new UsageError(`unexpected option '${token}' for create`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${token} needs a value`);
    options[key] = value;
    i++;
  }

  for (const key of ['title', 'summary']) {
    if (!options[key]?.trim()) throw new UsageError(`--${key} is required for create`);
  }

  const fields = {};
  for (const key of VALUE_OPTIONS) if (options[key] !== undefined) fields[key] = options[key];
  return { root: path.resolve(root ?? '.'), fields, dryRun: options['dry-run'] === true };
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    exitWith(2);
    return;
  }

  const result = createIssue(parsed.root, parsed.fields, { dryRun: parsed.dryRun });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(0);
}

runCli(main);
