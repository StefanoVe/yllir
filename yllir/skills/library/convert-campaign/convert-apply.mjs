#!/usr/bin/env node
// CLI of the structured convert apply: node convert-apply.mjs <campaign root> --plan <plan file>
// Prints the result object as JSON. Exit 0 when ok, 1 when the plan has errors (nothing written),
// 2 on a usage error or an unreadable plan file.

import fs from 'node:fs';
import { applyPlan } from './lib/convert-apply.mjs';

function usage(message) {
  process.stderr.write(`${message}\nusage: node convert-apply.mjs <campaign root> --plan <plan file>\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
const planIndex = args.indexOf('--plan');
const positional = args.filter((arg, i) => arg !== '--plan' && (planIndex < 0 || i !== planIndex + 1));
if (positional.length !== 1 || planIndex < 0 || args[planIndex + 1] === undefined) {
  usage('missing campaign root or --plan');
}

const [root] = positional;
let plan;
try {
  plan = JSON.parse(fs.readFileSync(args[planIndex + 1], 'utf8'));
} catch (err) {
  if (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'EACCES') usage(`cannot read plan: ${err.message}`);
  const result = {
    ok: false,
    errors: [{ code: 'bad-plan', message: `plan is not valid JSON: ${err.message}` }],
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(1);
}

const result = applyPlan(root, plan);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.ok ? 0 : 1);
