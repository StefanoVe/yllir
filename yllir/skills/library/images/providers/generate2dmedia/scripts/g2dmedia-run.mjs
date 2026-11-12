#!/usr/bin/env node
// Runs one image job through the generate2dmedia route (third-party route_media.py).
// Usage: node g2dmedia-run.mjs <campaignRoot> <jobDir> [--data-dir <path>] [--timeout-seconds <n>] [--route <name>]
// --route is one of: gemini, openai, xai, byteplus, fal (absent means automatic choice).
// Exit codes: 0 image produced, 1 failed, 2 usage error.

import path from 'node:path';
import { G2D_ROUTES, isValidRoute, readReady, runG2dmedia } from './lib/g2dmedia.mjs';
import { exitWith, runCli } from '../../../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node g2dmedia-run.mjs <campaignRoot> <jobDir> [--data-dir <path>] [--timeout-seconds <n>] [--route <name>]';

const VALUE_OPTIONS = new Set(['--data-dir', '--timeout-seconds', '--route']);

function parseArgs(argv) {
  const opts = { campaignRoot: null, jobDir: null, dataDir: null, timeoutSeconds: null, route: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      if (arg === '--data-dir') {
        opts.dataDir = value;
      } else if (arg === '--route') {
        if (!G2D_ROUTES.includes(value)) return null;
        opts.route = value;
      } else {
        if (!/^[1-9]\d*$/.test(value)) return null;
        opts.timeoutSeconds = Number(value);
      }
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (opts.campaignRoot === null) {
      opts.campaignRoot = arg;
    } else if (opts.jobDir === null) {
      opts.jobDir = arg;
    } else {
      return null;
    }
  }
  return opts.campaignRoot === null || opts.jobDir === null ? null : opts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const options = {
    campaignRoot: path.resolve(args.campaignRoot),
    jobDir: path.resolve(args.jobDir),
    ready: readReady(args.dataDir),
  };
  if (args.timeoutSeconds !== null) options.timeoutMs = args.timeoutSeconds * 1000;
  if (args.route !== null) options.route = args.route;

  const result = await runG2dmedia(options);
  if (result.ok) {
    process.stdout.write(`result: ok\nfile: ${path.join(options.jobDir, 'result.png')}\nroute: ${result.route}\n`);
    exitWith(0);
    return;
  }
  process.stdout.write(`result: failed\nerror: ${result.error}\nmessage: ${result.message}\n`);
  exitWith(1);
}

runCli(main);
