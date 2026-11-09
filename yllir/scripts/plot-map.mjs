#!/usr/bin/env node
// Builds the plot map of a campaign: one line per session (played, ready or
// waiting, with its prerequisites), a summary, and one line per error. With
// --out, also writes the whole result as JSON.
// Usage: node plot-map.mjs <campaignRoot> [--out <file>]
// Exit codes: 0 no errors, 1 errors found, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { plotMap } from './lib/plot-map.mjs';
import { exitWith, runCli } from './lib/cli-exit.mjs';

const USAGE = 'usage: node plot-map.mjs <campaignRoot> [--out <file>]';

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const result = plotMap(path.resolve(args.root));

  for (const session of result.sessions) {
    const status = session.played ? 'played' : session.ready ? 'ready' : 'waiting';
    const deps = session.depends_on.length > 0 ? session.depends_on.join(', ') : '-';
    process.stdout.write(`${session.id} ${status} deps: ${deps}\n`);
  }

  const played = result.sessions.filter((s) => s.played).length;
  const ready = result.sessions.filter((s) => s.ready).length;
  process.stdout.write(
    `sessions: ${result.sessions.length}, played: ${played}, ready: ${ready}, errors: ${result.errors.length}\n`,
  );
  for (const error of result.errors) {
    process.stdout.write(`error ${error.code} ${error.file}: ${error.message}\n`);
  }

  if (args.out !== null) {
    const target = path.resolve(args.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
  }

  exitWith(result.errors.length === 0 ? 0 : 1);
}

runCli(main);
