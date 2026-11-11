#!/usr/bin/env node
// Runs one image job with a command provider added to the campaign.
// Usage: node command-run.mjs <campaignRoot> <jobDir> --provider <id>
// Exit codes: 0 image produced, 1 failed, 2 usage error.

import path from 'node:path';
import { runCommandProvider } from './lib/custom-run.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node command-run.mjs <campaignRoot> <jobDir> --provider <id>';

function parseArgs(argv) {
  const opts = { root: null, jobDir: null, provider: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--provider') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      opts.provider = value;
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2 || opts.provider === null) return null;
  [opts.root, opts.jobDir] = positional;
  return opts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const jobDir = path.resolve(args.jobDir);
  const result = await runCommandProvider({
    root: path.resolve(args.root),
    jobDir,
    id: args.provider,
  });
  if (result.ok) {
    process.stdout.write(`result: ok\nfile: ${path.join(jobDir, 'result.png')}\n`);
    exitWith(0);
    return;
  }
  process.stdout.write(`result: failed\nerror: ${result.error}\nmessage: ${result.message}\n`);
  exitWith(1);
}

runCli(main);
