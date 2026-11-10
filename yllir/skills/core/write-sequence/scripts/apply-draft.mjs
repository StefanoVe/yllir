#!/usr/bin/env node
// Copies drafted Markdown files into a campaign and reports the result as JSON.
// Usage: node apply-draft.mjs <root> --draft-dir <dir> --files "a.md,b.md" [--out file.json]
// The draft of each file is <draft-dir>/<file>; a relative draft-dir is resolved against root.
// Exit codes: 0 written, 1 refused (nothing written, see errors in the JSON), 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { applyDraft } from './lib/apply-draft.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node apply-draft.mjs <root> --draft-dir <dir> --files "a.md,b.md" [--out file.json]';
const VALUE_FLAGS = ['--draft-dir', '--files', '--out'];

function parseArgs(argv) {
  const options = {};
  let root = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_FLAGS.includes(arg)) {
      if (i + 1 >= argv.length || Object.hasOwn(options, arg)) return null;
      options[arg] = argv[++i];
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (root === null) {
      root = arg;
    } else {
      return null;
    }
  }
  if (root === null || ['--draft-dir', '--files'].some((flag) => !Object.hasOwn(options, flag))) return null;
  return { root, draftDir: options['--draft-dir'], files: options['--files'], out: options['--out'] };
}

function prepareOutput(output) {
  if (output === undefined) return null;
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    if (fs.statSync(target).isDirectory()) throw new Error(`cannot use --out ${target} (EISDIR)`);
    fs.accessSync(target, fs.constants.W_OK);
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`cannot use --out ${target} (${err.code ?? 'error'})`);
  }
  const probe = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(probe, '', { flag: 'wx' });
    fs.unlinkSync(probe);
  } catch (err) {
    try { fs.unlinkSync(probe); } catch {}
    throw new Error(`cannot use --out ${target} (${err.code ?? 'error'})`);
  }
  return target;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);
  const output = prepareOutput(args.out);

  const files = args.files
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  const result = applyDraft(path.resolve(args.root), { draftDir: args.draftDir, files });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (output !== null) fs.writeFileSync(output, json, 'utf8');
  process.stdout.write(json);
  exitWith(result.errors.length === 0 ? 0 : 1);
}

runCli(main);
