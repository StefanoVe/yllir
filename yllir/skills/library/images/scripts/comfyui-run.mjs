#!/usr/bin/env node
// Runs one image job on a local ComfyUI server and writes result.png and run.json into the job folder.
// Usage: node comfyui-run.mjs <jobDir> --checkpoint <name> [--url <url>] [--timeout-seconds <n>]
// Exit codes: 0 result written, 1 run failed (unavailable, timeout or failed), 2 usage error.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_URL, runComfyui } from './lib/comfyui.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node comfyui-run.mjs <jobDir> --checkpoint <name> [--url <url>] [--timeout-seconds <n>]';

const TEMPLATES_RELATIVE = '../../../../modules/image-providers/comfyui';
const VALUE_OPTIONS = new Set(['--checkpoint', '--url', '--timeout-seconds']);

function parseArgs(argv) {
  const opts = { jobDir: null, checkpoint: null, url: DEFAULT_URL, timeoutSeconds: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      if (arg === '--checkpoint') opts.checkpoint = value;
      else if (arg === '--url') opts.url = value;
      else opts.timeoutSeconds = Number(value);
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (opts.jobDir === null) {
      opts.jobDir = arg;
    } else {
      return null;
    }
  }
  if (opts.jobDir === null || opts.checkpoint === null) return null;
  if (opts.timeoutSeconds !== null && !(Number.isFinite(opts.timeoutSeconds) && opts.timeoutSeconds > 0)) return null;
  return opts;
}

const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const jobDir = path.resolve(args.jobDir);
  const templatesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), TEMPLATES_RELATIVE);
  const result = await runComfyui({
    jobDir,
    url: args.url,
    checkpoint: args.checkpoint,
    templatesDir,
    timeoutMs: args.timeoutSeconds === null ? undefined : args.timeoutSeconds * 1000,
  });

  if (result.ok) {
    process.stdout.write('result: ok\n');
    process.stdout.write(`file: ${path.join(jobDir, 'result.png')}\n`);
    exitWith(0);
    return;
  }
  process.stdout.write('result: failed\n');
  process.stdout.write(`error: ${result.error}\n`);
  process.stdout.write(`message: ${oneLine(result.message)}\n`);
  exitWith(1);
}

runCli(main);
