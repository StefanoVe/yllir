#!/usr/bin/env node
// Runs one image job through the OpenAI Images API.
// Usage: node openai-run.mjs <campaignRoot> <jobDir> [--timeout-seconds <n>] [--model <id>]
//        node openai-run.mjs <campaignRoot> --set-model <id>
//        node openai-run.mjs --list-models
// Exit codes: 0 image produced, 1 failed, 2 usage error.

import path from 'node:path';
import { OPENAI_MODELS, runOpenai, setOpenaiModel } from './lib/openai.mjs';
import { exitWith, runCli } from '../../../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node openai-run.mjs <campaignRoot> <jobDir> [--timeout-seconds <n>] [--model <id>]\n' +
  '       node openai-run.mjs <campaignRoot> --set-model <id>\n' +
  '       node openai-run.mjs --list-models';

const VALUE_OPTIONS = new Set(['--timeout-seconds', '--model', '--set-model']);

function parseArgs(argv) {
  const opts = { campaignRoot: null, jobDir: null, timeoutSeconds: null, model: null, setModel: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--') || value === '') return null;
      if (arg === '--model') {
        opts.model = value;
      } else if (arg === '--set-model') {
        opts.setModel = value;
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
  if (opts.campaignRoot === null) return null;
  if (opts.setModel !== null) {
    // --set-model takes no job and no run options.
    return opts.jobDir === null && opts.model === null && opts.timeoutSeconds === null ? opts : null;
  }
  return opts.jobDir === null ? null : opts;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--list-models') {
    process.stdout.write(OPENAI_MODELS.map((entry) => `${entry.id}\t${entry.label}\n`).join(''));
    exitWith(0);
    return;
  }

  const args = parseArgs(argv);
  if (args === null) throw new Error(USAGE);

  if (args.setModel !== null) {
    try {
      setOpenaiModel(path.resolve(args.campaignRoot), args.setModel);
    } catch (err) {
      if (err.message !== 'unknown model') throw err;
      const shown = String(args.setModel).replace(/\s+/g, ' ');
      process.stdout.write(`result: failed\nerror: unknown-model\nmessage: ${shown} is not in the list; run --list-models\n`);
      exitWith(1);
      return;
    }
    process.stdout.write(`result: ok\nmodel: ${args.setModel}\n`);
    exitWith(0);
    return;
  }

  const options = {
    campaignRoot: path.resolve(args.campaignRoot),
    jobDir: path.resolve(args.jobDir),
    model: args.model,
  };
  if (args.timeoutSeconds !== null) options.timeoutMs = args.timeoutSeconds * 1000;

  const result = await runOpenai(options);
  if (result.ok) {
    process.stdout.write(`result: ok\nfile: ${path.join(options.jobDir, 'result.png')}\n`);
    exitWith(0);
    return;
  }
  process.stdout.write(`result: failed\nerror: ${result.error}\nmessage: ${result.message}\n`);
  exitWith(1);
}

runCli(main);
