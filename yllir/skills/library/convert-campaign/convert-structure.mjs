#!/usr/bin/env node
// Writes the structure report of a campaign source folder as JSON and prints its summary line.
// Usage: node convert-structure.mjs <INPUT> --out <file> [--survey <file>] [--snapshot <dir>]
// Exit codes: 0 ok, 2 usage error or unreadable INPUT (message on stderr).

import fs from 'node:fs';
import path from 'node:path';
import { buildReport, buildSnapshotReport, buildSurvey } from './lib/convert-structure.mjs';
import { exitWith, runCli } from '../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node convert-structure.mjs <INPUT> --out <file> [--survey <file>] [--snapshot <dir>]';

function parseArgs(argv) {
  const opts = { input: null, out: null, survey: null, snapshot: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      opts.out = value;
      i++;
    } else if (arg === '--survey') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      opts.survey = value;
      i++;
    } else if (arg === '--snapshot') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      opts.snapshot = value;
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (opts.input === null) {
      opts.input = arg;
    } else {
      return null;
    }
  }
  if (opts.input === null || opts.out === null) return null;
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const report = args.snapshot === null
    ? buildReport(args.input)
    : buildSnapshotReport(args.input, args.snapshot);
  const outFile = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  if (args.survey !== null) {
    const surveyFile = path.resolve(args.survey);
    fs.mkdirSync(path.dirname(surveyFile), { recursive: true });
    fs.writeFileSync(surveyFile, `${JSON.stringify(buildSurvey(report), null, 2)}\n`);
  }

  const markdown = report.files.length;
  const images = report.images.length;
  process.stdout.write(
    `files: ${markdown + images}, markdown: ${markdown}, images: ${images}, `
    + `excluded: ${report.excluded.length}, conventions: ${report.conventions.length}, `
    + `missing-links: ${report.links.missing.length}\n`,
  );
  exitWith(0);
}

runCli(main);
