#!/usr/bin/env node
// Runs exactly one allowed map tool inside one map job folder of a campaign.
// Usage: node maps-run.mjs <campaignRoot> --job <jobId> [--data-dir <path>] -- <tool> <args...>
// Exit codes: 0 tool succeeded, 1 refused or failed, 2 usage error.

import path from 'node:path';
import { runTool } from './lib/run.mjs';
import { exitWith, runCli } from '../../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node maps-run.mjs <campaignRoot> --job <jobId> [--data-dir <path>] -- <tool> <args...>';

function parseArgs(argv) {
  const sep = argv.indexOf('--');
  if (sep < 0) return null;
  const [tool, ...toolArgs] = argv.slice(sep + 1);
  if (!tool) return null;

  const head = argv.slice(0, sep);
  const opts = { campaignRoot: null, job: null, dataDir: undefined };
  for (let i = 0; i < head.length; i++) {
    const arg = head[i];
    if (arg === '--job' || arg === '--data-dir') {
      const value = head[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      if (arg === '--job') opts.job = value;
      else opts.dataDir = value;
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (opts.campaignRoot === null) {
      opts.campaignRoot = arg;
    } else {
      return null;
    }
  }
  if (opts.campaignRoot === null || opts.job === null) return null;
  return { ...opts, tool, toolArgs };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const result = await runTool({
    campaignRoot: path.resolve(args.campaignRoot),
    jobId: args.job,
    dataDir: args.dataDir,
    tool: args.tool,
    args: args.toolArgs,
    onStdout: (chunk) => process.stdout.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
  });

  if (result.ok) {
    process.stdout.write('result: ok\n');
    exitWith(0);
    return;
  }
  if (result.error === 'not-installed') {
    process.stdout.write('result: unavailable\nerror: not-installed\n');
    exitWith(1);
    return;
  }
  if (result.code !== undefined) {
    process.stdout.write(`result: failed\ncode: ${result.code}\n`);
    exitWith(1);
    return;
  }
  process.stdout.write(`result: failed\nerror: ${result.error}\n`);
  exitWith(1);
}

runCli(main);
