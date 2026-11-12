#!/usr/bin/env node
// Screens one downloaded artwork candidate with the deterministic anti-AI rules and
// records the result (ai_screen, ai_reasons) in the candidate file.
// Usage: node artwork-screen.mjs <root> --job <jobId> --cand <n>
// Output: one line of JSON {"ok":true|false,"reasons":[...]}, then the exit line.
// Exit codes: 0 passed, 1 rejected or not found, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { screenCandidate } from './lib/ai-screen.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node artwork-screen.mjs <root> --job <jobId> --cand <n>';

const JOB_ID = /^artwork-[a-z0-9-]+-\d+$/;
const CAND_NUMBER = /^[1-9]\d*$/;
const VALUE_OPTIONS = new Set(['--job', '--cand']);

function parseArgs(argv) {
  const opts = { root: null, job: null, cand: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      opts[arg.slice(2)] = value;
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (opts.root === null) {
      opts.root = arg;
    } else {
      return null;
    }
  }
  if (opts.root === null || opts.job === null || opts.cand === null) return null;
  if (!JOB_ID.test(opts.job) || !CAND_NUMBER.test(opts.cand)) return null;
  return opts;
}

function refuse(reasons, code) {
  process.stdout.write(`${JSON.stringify({ ok: false, reasons })}\n`);
  exitWith(code);
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const root = path.resolve(args.root);
  const stateDir = path.join(root, '.campaign', 'state', 'artwork');
  const dir = path.join(stateDir, args.job);
  if (path.relative(stateDir, dir).startsWith('..')) {
    throw new Error(USAGE);
  }
  const candPath = path.join(dir, `cand-${args.cand}.json`);

  let cand;
  try {
    cand = JSON.parse(fs.readFileSync(candPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return refuse(['not-found'], 1);
    return refuse(['bad-input'], 1);
  }
  if (typeof cand !== 'object' || cand === null || Array.isArray(cand)) return refuse(['bad-input'], 1);
  if (typeof cand.file !== 'string' || cand.file === '') return refuse(['bad-input'], 1);

  let bytes;
  try {
    bytes = fs.readFileSync(path.join(dir, path.basename(cand.file)));
  } catch (err) {
    if (err.code === 'ENOENT') return refuse(['not-found'], 1);
    return refuse(['bad-input'], 1);
  }

  const result = screenCandidate(cand, { bytes });
  const updated = { ...cand, ai_screen: result.ok ? 'passed' : 'rejected', ai_reasons: result.reasons };
  writeAtomic(candPath, `${JSON.stringify(updated, null, 2)}\n`);

  process.stdout.write(`${JSON.stringify({ ok: result.ok, reasons: result.reasons })}\n`);
  exitWith(result.ok ? 0 : 1);
}

runCli(main);
