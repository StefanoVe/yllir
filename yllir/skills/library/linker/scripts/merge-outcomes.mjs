#!/usr/bin/env node
// Merge a saved reviewer response with existing outcomes.
// Usage: node merge-outcomes.mjs <root> --plan <plan.json> --base <outcomes.json> --response <response.json> --out <outcomes.json> --mode all|scoped [--pids P001,P002]
import path from 'node:path';
import { mergeFiles } from './lib/merge-outcomes.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node merge-outcomes.mjs <root> --plan <plan.json> --base <outcomes.json> --response <response.json> --out <outcomes.json> --mode all|scoped [--pids P001,P002]';

function parseArgs(argv) {
  const opts = { root: null, plan: null, base: null, response: null, out: null, mode: null, pids: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--plan', '--base', '--response', '--out', '--mode', '--pids'].includes(arg)) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--') || opts[key] !== null) return null;
      opts[key] = value;
      i++;
    } else if (arg.startsWith('--') || arg === '') return null;
    else if (opts.root === null) opts.root = arg;
    else return null;
  }
  if (!opts.root || !opts.plan || !opts.base || !opts.response || !opts.out || !opts.mode) return null;
  if (opts.mode === 'scoped' && !opts.pids) return null;
  if (opts.mode === 'all' && opts.pids !== null) return null;
  if (!['all', 'scoped'].includes(opts.mode)) return null;
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) throw new Error(USAGE);
  const pids = args.pids === null ? [] : args.pids.split(',');
  const merged = mergeFiles(path.resolve(args.root), path.resolve(args.plan), path.resolve(args.base), path.resolve(args.response), path.resolve(args.out), { mode: args.mode, pids });
  process.stdout.write(`outcomes: ${merged.length}\n`);
  exitWith(0);
}

runCli(main);
