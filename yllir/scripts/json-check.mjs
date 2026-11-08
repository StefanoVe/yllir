#!/usr/bin/env node
// Checks that a file is valid JSON, optionally an array or a plain object.
// Usage: node json-check.mjs <file> [--array|--object]
// Prints "json: ok" (exit 0) or "json: invalid (<reason>)" (exit 1).
// Exit code 2 is a usage error.

import fs from 'node:fs';
import path from 'node:path';
import { exitWith, runCli } from './lib/cli-exit.mjs';

const USAGE = 'usage: node json-check.mjs <file> [--array|--object]';

function usage(message) {
  throw new Error(message ? `${message}\n${USAGE}` : USAGE);
}

/** Returns { file, shape }; a usage error throws. */
function parseArgs(argv) {
  let file = null;
  let shape = null;
  for (const arg of argv) {
    if (arg === '--array' || arg === '--object') {
      if (shape !== null) usage('use only one of --array and --object');
      shape = arg.slice(2);
    } else if (arg.startsWith('--') || arg === '') {
      usage(`unknown option: ${arg}`);
    } else if (file === null) {
      file = arg;
    } else {
      usage('only one file can be checked');
    }
  }
  if (file === null) usage();
  return { file, shape };
}

function invalid(reason) {
  process.stdout.write(`json: invalid (${reason})\n`);
  exitWith(1);
}

function check(file, shape) {
  let text;
  try {
    text = fs.readFileSync(path.resolve(file), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return invalid('missing file');
    }
    return invalid(`cannot read file: ${err.code ?? 'unknown error'}`);
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return invalid(String(err.message).replace(/\s+/g, ' ').trim());
  }

  if (shape === 'array' && !Array.isArray(value)) {
    return invalid('not an array');
  }
  if (shape === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    return invalid('not an object');
  }
  process.stdout.write('json: ok\n');
  exitWith(0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  check(args.file, args.shape);
}

runCli(main);
