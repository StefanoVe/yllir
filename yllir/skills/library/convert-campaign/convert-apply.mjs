#!/usr/bin/env node
// CLI of the structured convert apply: node convert-apply.mjs <campaign root> --plan <plan file> --out <result file>
// The full result goes to the --out file; stdout gets a compact summary (the first 50 errors and the counts).
// Exit 0 when ok, 1 when the plan has errors (nothing written), 2 on a usage error or an unreadable plan file.

import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from './lib/convert-apply.mjs';
import { exitWith, runCli } from '../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node convert-apply.mjs <campaign root> --plan <plan file> --out <result file>';
const MAX_ERRORS = 50;

/** Value of an option (`--name value`), or undefined. */
function optionValue(args, name) {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}

/** Compact summary printed on stdout: the first errors, the counts, and the file holding the full result. */
function summarise(result, out) {
  const uncovered = result.uncovered ?? [];
  return {
    ok: result.ok,
    errors: (result.errors ?? []).slice(0, MAX_ERRORS),
    counts: {
      files: (result.files ?? []).length,
      sources: (result.sources ?? []).length,
      plainLinks: (result.plainLinks ?? []).length,
      droppedKeys: (result.droppedKeys ?? []).length,
      features: (result.features ?? []).length,
      uncoveredFiles: uncovered.length,
      uncoveredLines: uncovered.reduce((sum, u) => sum + u.lines.length, 0),
      unrouted: (result.unrouted ?? []).length,
      textParts: (result.textParts ?? []).length,
    },
    masterBlocks: result.masterBlocks ?? { moved: 0, fixed: 0 },
    out,
  };
}

function main() {
  const args = process.argv.slice(2);
  const planFile = optionValue(args, '--plan');
  const outFile = optionValue(args, '--out');
  const planIndex = args.indexOf('--plan');
  const outIndex = args.indexOf('--out');
  const positional = args.filter((arg, i) => arg !== '--plan' && arg !== '--out'
    && i !== planIndex + 1 && i !== outIndex + 1);
  if (positional.length !== 1 || planFile === undefined || outFile === undefined) {
    process.stderr.write(`missing campaign root, --plan or --out\n${USAGE}\n`);
    exitWith(2);
    return;
  }

  const [root] = positional;
  let text;
  try {
    text = fs.readFileSync(planFile, 'utf8');
  } catch (err) {
    process.stderr.write(`cannot read plan: ${err.message}\n${USAGE}\n`);
    exitWith(2);
    return;
  }
  let result;
  try {
    result = applyPlan(root, JSON.parse(text));
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    result = { ok: false, errors: [{ code: 'bad-plan', message: `plan is not valid JSON: ${err.message}` }] };
  }

  const target = path.resolve(outFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summarise(result, outFile), null, 2)}\n`);
  exitWith(result.ok ? 0 : 1);
}

runCli(main);
