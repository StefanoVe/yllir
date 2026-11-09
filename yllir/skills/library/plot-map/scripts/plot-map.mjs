#!/usr/bin/env node
// Builds the plot map of a campaign: one line per session (played, ready or
// waiting, with its prerequisites), a summary, and one line per error. With
// --out, also writes the whole result as JSON. With --write-session-maps, also
// rewrites the generated main file of each session where it differs.
// Usage: node plot-map.mjs <campaignRoot> [--out <file>] [--write-session-maps]
// Exit codes: 0 no errors, 1 errors found, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { plotMap } from './lib/plot-map.mjs';
import { writeSessionMaps } from './lib/session-map.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node plot-map.mjs <campaignRoot> [--out <file>] [--write-session-maps]';

function parseArgs(argv) {
  let root = null;
  let out = null;
  let writeSessionMapsFlag = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) return null;
      out = value;
      i++;
    } else if (arg === '--write-session-maps') {
      writeSessionMapsFlag = true;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (root === null) {
      root = arg;
    } else {
      return null;
    }
  }
  return root === null ? null : { root, out, writeSessionMaps: writeSessionMapsFlag };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const root = path.resolve(args.root);
  const result = plotMap(root);

  if (args.writeSessionMaps) {
    const written = writeSessionMaps(root, result.sessions);
    process.stdout.write(
      `session maps written: ${written.written.length}, unchanged: ${written.unchanged.length}\n`,
    );
  }

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
