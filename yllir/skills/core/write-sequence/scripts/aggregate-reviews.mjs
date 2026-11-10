#!/usr/bin/env node
// Validate and aggregate ordered per-document reviewer JSON files.
// Usage: node aggregate-reviews.mjs --out review.json review-1.json review-2.json

import fs from 'node:fs';
import path from 'node:path';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node aggregate-reviews.mjs --out review.json review-1.json [review-2.json ...]';

function parseArgs(argv) {
  if (argv[0] !== '--out' || !argv[1] || argv.length < 3 || argv.some((arg) => arg === '')) {
    throw new Error(USAGE);
  }
  return { out: path.resolve(argv[1]), inputs: argv.slice(2).map((file) => path.resolve(file)) };
}

function validateReview(value, file) {
  const fail = (reason) => { throw new Error(`${file}: ${reason}`); };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('expected an object');
  if (Object.keys(value).some((key) => !['outcome', 'items', 'question', 'escalate'].includes(key))) fail('contains an unknown field');
  if (!['APPLY', 'FIX', 'ASK'].includes(value.outcome)) fail('outcome must be APPLY, FIX or ASK');
  if (!Array.isArray(value.items)) fail('items must be an array');
  for (const [index, item] of value.items.entries()) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some((key) => !['document', 'problem', 'evidence'].includes(key))
      || ['document', 'problem', 'evidence'].some((key) => typeof item[key] !== 'string' || item[key].trim() === '')) {
      fail(`items[${index}] must have non-empty document, problem and evidence strings`);
    }
  }
  if (value.outcome === 'FIX' && value.items.length === 0) fail('FIX requires at least one item');
  if (value.outcome === 'ASK' && (typeof value.question !== 'string' || value.question.trim() === '')) {
    fail('ASK requires a non-empty question');
  }
  if (value.outcome !== 'ASK' && value.question !== undefined) fail('question is only valid with ASK');
  if (value.escalate !== undefined && typeof value.escalate !== 'boolean') fail('escalate must be a boolean');
  return value;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reviews = args.inputs.map((file) => {
    let value;
    try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { throw new Error(`${file}: invalid or unreadable JSON (${error.message})`); }
    return validateReview(value, file);
  });
  const ask = reviews.find((review) => review.outcome === 'ASK');
  const outcome = ask ? 'ASK' : reviews.some((review) => review.outcome === 'FIX') ? 'FIX' : 'APPLY';
  const aggregate = { outcome, items: reviews.flatMap((review) => review.items) };
  if (ask) aggregate.question = ask.question;
  const json = `${JSON.stringify(aggregate, null, 2)}\n`;
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(json);
  exitWith(0);
}

runCli(main);
