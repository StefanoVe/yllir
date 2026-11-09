#!/usr/bin/env node
// Command line tools of the NPC manager. plot-cast checks the characters that
// plot events declare and lists name candidates without a sheet; check-sheets
// checks NPC and vendor sheets against the sheet model; find lists the subjects
// that match a name; gaps says whether each sheet is usable at the table.
// Deterministic: it reports, the agent judges.
// Usage: node npc-manager.mjs <campaignRoot> <command> [options]
//   plot-cast    [--files a.md,b.md] --out <json>
//   check-sheets [--files a.md,b.md]
//   find         --name "<text>"
//   gaps         --files "a.md,b.md" [--base <folder>]
// Exit codes: 0 no errors, 1 errors found (plot-cast, check-sheets), 2 usage error.
// Candidates of plot-cast never change the exit code. gaps exits 0 whenever the
// files were read: a sheet to complete is reported, not an error.

import fs from 'node:fs';
import path from 'node:path';
import { plotCast } from './lib/plot-cast.mjs';
import { checkSheets } from './lib/sheet-check.mjs';
import { findSubject } from './lib/find-subject.mjs';
import { sheetGaps } from './lib/sheet-gaps.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node npc-manager.mjs <campaignRoot> <plot-cast [--files a.md,b.md] --out <json> | check-sheets [--files a.md,b.md] | find --name "<text>" | gaps --files "a.md,b.md" [--base <folder>]>';

// Options each command accepts (all of them take one value).
const OPTIONS = {
  'plot-cast': new Set(['--files', '--out']),
  'check-sheets': new Set(['--files']),
  find: new Set(['--name']),
  gaps: new Set(['--files', '--base']),
};

function parseArgs(argv) {
  if (argv.length < 2) return null;
  const [root, command, ...rest] = argv;
  if (root === '' || root.startsWith('--')) return null;
  if (!Object.hasOwn(OPTIONS, command)) return null;

  const allowed = OPTIONS[command];
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const option = rest[i];
    if (!allowed.has(option) || Object.hasOwn(opts, option)) return null;
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) return null;
    opts[option] = value;
    i++;
  }
  return { root, command, opts };
}

/** Comma-separated list without empty items; null when it has no item. */
function parseList(value) {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return items.length === 0 ? null : items;
}

function plotCastCommand(root, opts) {
  if (opts['--out'] === undefined || opts['--out'] === '') throw new Error(USAGE);
  let files = null;
  if (opts['--files'] !== undefined) {
    files = parseList(opts['--files']);
    if (files === null) throw new Error(USAGE);
  }

  const result = plotCast(root, { files });

  const outFile = path.resolve(opts['--out']);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);

  process.stdout.write(`events: ${result.events}\n`);
  process.stdout.write(`declared: ${result.declared}\n`);
  for (const error of result.errors) {
    process.stdout.write(`error ${error.code} ${error.file}: ${error.message}\n`);
  }
  process.stdout.write(`errors: ${result.errors.length}\n`);
  for (const candidate of result.candidates) {
    process.stdout.write(`candidate ${candidate.file}:${candidate.line} ${candidate.text}\n`);
  }
  process.stdout.write(`candidates: ${result.candidates.length}\n`);
  exitWith(result.errors.length === 0 ? 0 : 1);
}

function checkSheetsCommand(root, opts) {
  let files = null;
  if (opts['--files'] !== undefined) {
    files = parseList(opts['--files']);
    if (files === null) throw new Error(USAGE);
  }

  const result = checkSheets(root, { files });

  process.stdout.write(`checked: ${result.checked.length}\n`);
  process.stdout.write(`skipped: ${result.skipped.length}\n`);
  for (const error of result.errors) {
    process.stdout.write(`error ${error.code} ${error.file}: ${error.message}\n`);
  }
  process.stdout.write(`errors: ${result.errors.length}\n`);
  exitWith(result.errors.length === 0 ? 0 : 1);
}

function findCommand(root, opts) {
  const name = opts['--name'];
  if (name === undefined || name.trim() === '') throw new Error(USAGE);

  const { matches } = findSubject(root, name.trim());
  for (const match of matches) {
    process.stdout.write(`match ${match.id} ${match.sheet} ${match.form} ${match.kind} ${match.match}\n`);
  }
  process.stdout.write(`matches: ${matches.length}\n`);
  exitWith(0);
}

function gapsCommand(root, opts) {
  if (opts['--files'] === undefined) throw new Error(USAGE);
  const files = parseList(opts['--files']);
  if (files === null) throw new Error(USAGE);
  let base = null;
  if (opts['--base'] !== undefined) {
    base = opts['--base'].trim();
    if (base === '') throw new Error(USAGE);
  }

  const { sheets } = sheetGaps(root, { files, base });
  for (const sheet of sheets) {
    for (const gap of sheet.gaps) {
      process.stdout.write(`gap ${sheet.file}: ${gap.code} ${gap.section} ${gap.message}\n`);
    }
    process.stdout.write(`sheet ${sheet.file}: ${sheet.status}\n`);
  }
  exitWith(0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const root = path.resolve(args.root);
  if (args.command === 'plot-cast') plotCastCommand(root, args.opts);
  else if (args.command === 'check-sheets') checkSheetsCommand(root, args.opts);
  else if (args.command === 'gaps') gapsCommand(root, args.opts);
  else findCommand(root, args.opts);
}

runCli(main);
