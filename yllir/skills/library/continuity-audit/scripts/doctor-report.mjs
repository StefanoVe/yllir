#!/usr/bin/env node
// Adds the doctor section to the continuity audit report: validates the doctor judgments
// and writes the full report (audit text + doctor section) to a new file.
// Usage: node doctor-report.mjs --audit report.txt --input doctor.json --out report-full.txt
// Exit codes: 0 written, 3 INVALID doctor input (problems printed), 2 usage error or unreadable input.

import fs from 'node:fs';
import path from 'node:path';
import { buildFullReport } from './lib/doctor-report.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node doctor-report.mjs --audit report.txt --input doctor.json --out report-full.txt';
const VALUE_OPTIONS = ['--audit', '--input', '--out'];

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!VALUE_OPTIONS.includes(arg)) return null;
    const value = argv[i + 1];
    if (value === undefined || value === '' || value.startsWith('--')) return null;
    opts[arg.slice(2)] = value;
    i++;
  }
  for (const required of ['audit', 'input', 'out']) {
    if (opts[required] === undefined) return null;
  }
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  let auditText;
  let input;
  try {
    auditText = fs.readFileSync(path.resolve(args.audit), 'utf8');
  } catch {
    throw new Error('error: cannot read --audit');
  }
  try {
    input = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
  } catch {
    throw new Error('error: cannot read --input as JSON');
  }

  const result = buildFullReport(auditText, input);
  if (!result.valid) {
    process.stdout.write('DOCTOR INVALID\n');
    for (const message of result.errors) process.stdout.write(`- ${message}\n`);
    exitWith(3);
    return;
  }
  const outFile = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, result.text);
  process.stdout.write(result.text);
  exitWith(0);
}

runCli(main);
