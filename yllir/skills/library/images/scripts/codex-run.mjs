#!/usr/bin/env node
// Runs one image job through the Codex CLI.
// Usage: node codex-run.mjs <jobDir> [--timeout-seconds <n>] [--command <path>]
// Exit codes: 0 image produced, 1 failed, 2 usage error.

import path from 'node:path';
import { runCodex } from './lib/codex.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node codex-run.mjs <jobDir> [--timeout-seconds <n>] [--command <path>]';

const VALUE_OPTIONS = new Set(['--timeout-seconds', '--command']);

function parseArgs(argv) {
  const opts = { jobDir: null, timeoutSeconds: null, command: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      if (arg === '--command') {
        opts.command = value;
      } else {
        if (!/^[1-9]\d*$/.test(value)) return null;
        opts.timeoutSeconds = Number(value);
      }
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (opts.jobDir === null) {
      opts.jobDir = arg;
    } else {
      return null;
    }
  }
  return opts.jobDir === null ? null : opts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const jobDir = path.resolve(args.jobDir);
  const options = { jobDir };
  if (args.timeoutSeconds !== null) options.timeoutMs = args.timeoutSeconds * 1000;
  if (args.command !== null) options.command = args.command;

  const result = await runCodex(options);
  if (result.ok) {
    process.stdout.write(`result: ok\nfile: ${path.join(jobDir, 'result.png')}\n`);
    exitWith(0);
    return;
  }
  process.stdout.write(`result: failed\nerror: ${result.error}\nmessage: ${result.message}\n`);
  exitWith(1);
}

runCli(main);
