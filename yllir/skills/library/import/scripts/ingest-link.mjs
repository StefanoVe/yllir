#!/usr/bin/env node
// Link sidestep: lists the inventory files that are already complete campaign
// documents (candidates), and in link mode creates a symlink to each chosen
// original in the canon category folder.
// Usage: node ingest-link.mjs <campaignRoot> --mode candidates --inventory <inventory.json>
//        node ingest-link.mjs <campaignRoot> --mode link --inventory <inventory.json>
//          --category-folder <folder> --inputs "<in1>,<in2>" --out <links.json>
// Exit codes: 0 ok (refusals are not errors), 1 errors (inventory, category folder), 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { readInventory, findCandidates, resolveCategoryFolder, linkInputs } from './lib/ingest-link.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node ingest-link.mjs <campaignRoot> --mode candidates|link --inventory <inventory.json> [--category-folder <folder>] [--inputs "<in1>,<in2>"] [--out <links.json>]';

const VALUE_OPTIONS = new Set(['--mode', '--inventory', '--category-folder', '--inputs', '--out']);

function parseArgs(argv) {
  const opts = {
    root: null,
    mode: null,
    inventory: null,
    'category-folder': null,
    inputs: null,
    out: null,
  };
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
  if (opts.root === null || opts.mode === null || opts.inventory === null) return null;
  if (opts.mode !== 'candidates' && opts.mode !== 'link') return null;
  if (opts.mode === 'link' && (opts['category-folder'] === null || opts.inputs === null || opts.out === null)) {
    return null;
  }
  return opts;
}

function fail(messages) {
  for (const message of messages) process.stdout.write(`error: ${message}\n`);
  exitWith(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const campaignRoot = path.resolve(args.root);
  const baseDir = process.cwd();
  const inventoryFile = path.resolve(args.inventory);
  const { inventory, errors } = readInventory(inventoryFile);
  if (inventory === null) {
    fail(errors);
    return;
  }

  if (args.mode === 'candidates') {
    const candidates = findCandidates(inventory, baseDir);
    process.stdout.write(`candidates: ${candidates.length}\n`);
    for (const entry of candidates) process.stdout.write(`candidate: ${entry.input}\n`);
    exitWith(0);
    return;
  }

  const inputs = args.inputs.split(',').map((item) => item.trim()).filter((item) => item !== '');
  if (inputs.length === 0) throw new Error(USAGE);

  const folder = resolveCategoryFolder(campaignRoot, args['category-folder']);
  if (folder.error !== null) {
    fail([folder.error]);
    return;
  }

  const { links, refused } = linkInputs({
    campaignRoot,
    categoryFolder: folder.folder,
    inputs,
    inventory,
    baseDir,
  });

  if (links.length > 0) {
    fs.writeFileSync(inventoryFile, `${JSON.stringify(inventory, null, 2)}\n`);
  }

  const outFile = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify({ links, refused }, null, 2)}\n`);

  const externals = links.filter((link) => link.external);
  process.stdout.write(`linked: ${links.length}, external: ${externals.length}, refused: ${refused.length}\n`);
  for (const item of refused) process.stdout.write(`refused: ${item.input}: ${item.reason}\n`);
  for (const link of externals) process.stdout.write(`external: ${link.path}\n`);
  exitWith(0);
}

runCli(main);
