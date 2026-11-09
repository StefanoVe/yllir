#!/usr/bin/env node
// Fills the facts folder of an audit scope from the extraction cache, and stores
// validated facts in the cache.
// Usage:
//   node audit-cache.mjs fill <campaignRoot> --scope <scope.json> --facts-dir <dir> --cache-dir <dir> [--vocab <file>]
//   node audit-cache.mjs store <campaignRoot> --facts <facts.json> --cache-dir <dir> [--vocab <file>]
// Exit codes: 0 done, 2 usage error or unreadable input.

import fs from 'node:fs';
import path from 'node:path';
import { fillFromCache, storeToCache } from './lib/audit-cache.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = [
  'usage: node audit-cache.mjs fill <campaignRoot> --scope <scope.json> --facts-dir <dir> --cache-dir <dir> [--vocab <file>]',
  '       node audit-cache.mjs store <campaignRoot> --facts <facts.json> --cache-dir <dir> [--vocab <file>]',
].join('\n');

const OPTIONS = {
  fill: new Set(['--scope', '--facts-dir', '--cache-dir', '--vocab']),
  store: new Set(['--facts', '--cache-dir', '--vocab']),
};

function usage(message) {
  throw new Error(message ? `${message}\n${USAGE}` : USAGE);
}

/** Parses `<command> <root> --opt value ...`. Returns null on a usage error. */
function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!Object.hasOwn(OPTIONS, command)) return null;
  const opts = { command, root: null, scope: null, 'facts-dir': null, facts: null, 'cache-dir': null, vocab: null };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      if (!OPTIONS[command].has(arg)) return null;
      const value = rest[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) return null;
      opts[arg.slice(2)] = value;
      i++;
    } else if (arg === '') {
      return null;
    } else if (opts.root === null) {
      opts.root = arg;
    } else {
      return null;
    }
  }
  return opts;
}

function readJson(file, what) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (err) {
    usage(`cannot read ${what}: ${err.message}`);
  }
  return null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null || args.root === null) usage();
  if (args.command === 'fill' && (args.scope === null || args['facts-dir'] === null || args['cache-dir'] === null)) {
    usage();
  }
  if (args.command === 'store' && (args.facts === null || args['cache-dir'] === null)) usage();

  const campaignRoot = path.resolve(args.root);
  if (!fs.statSync(campaignRoot, { throwIfNoEntry: false })?.isDirectory()) {
    usage(`campaign folder not found: ${args.root}`);
  }

  const vocabPath = args.vocab === null ? undefined : path.resolve(args.vocab);
  const cacheDir = path.resolve(args['cache-dir'] ?? '.');

  if (args.command === 'fill') {
    const scope = readJson(args.scope, 'scope file');
    const validScope =
      isPlainObject(scope) &&
      Array.isArray(scope.files) &&
      scope.files.every((f) => f && typeof f.fid === 'string' && typeof f.document === 'string');
    if (!validScope) usage('scope file is not a scope written by audit-scope');

    let result;
    try {
      result = fillFromCache(campaignRoot, {
        scope,
        factsDir: path.resolve(args['facts-dir']),
        cacheDir,
        vocabPath,
      });
    } catch (err) {
      usage(`cannot fill from cache: ${err.message}`);
    }

    const documentOf = new Map(scope.files.map((f) => [f.fid, f.document]));
    const lines = [`cache: ${result.hits.length} hits, ${result.misses.length} to extract`];
    for (const fid of result.misses) lines.push(`${fid} ${documentOf.get(fid)}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    exitWith(0);
  } else {
    const factsJson = readJson(args.facts, 'facts file');
    const validFacts =
      isPlainObject(factsJson) &&
      Array.isArray(factsJson.coverage) &&
      Array.isArray(factsJson.facts) &&
      Array.isArray(factsJson.discarded);
    if (!validFacts) usage('facts file is not a facts result written by audit-validate');

    let result;
    try {
      result = storeToCache(campaignRoot, { factsJson, cacheDir, vocabPath });
    } catch (err) {
      usage(`cannot store in cache: ${err.message}`);
    }
    process.stdout.write(`cache: ${result.stored.length} stored, ${result.skipped.length} skipped\n`);
    exitWith(0);
  }
}

runCli(main);
