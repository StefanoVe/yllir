#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { coverageReviewKey, readCoverageReviewCache, storeCoverageReviewCache } from './lib/coverage-review-cache.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

function main() {
  const [operation, rootArg, ...args] = process.argv.slice(2);
  const options = {};
  const allowed = new Set(['--facts', '--scope', '--review', '--out', '--vocab', '--instructions', '--key-out', '--key-file']);
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(options, args[i].slice(2))) throw new Error('usage: coverage-review-cache.mjs lookup|store <root> --facts <file> --scope <file> --review <file> --out <dir> --vocab <file> --instructions <file> [--key-out <file>|--key-file <file>]');
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!['lookup', 'store'].includes(operation) || !rootArg || !['facts', 'scope', 'review', 'out', 'vocab', 'instructions'].every((key) => options[key]) ||
      (operation === 'lookup' && !options['key-out']) || (operation === 'store' && !options['key-file'])) throw new Error('invalid coverage cache arguments');
  const root = path.resolve(rootArg);
  const facts = JSON.parse(fs.readFileSync(options.facts, 'utf8'));
  const scope = JSON.parse(fs.readFileSync(options.scope, 'utf8'));
  const key = coverageReviewKey({ root, factsFile: options.facts, scopeFile: options.scope, vocabularyFile: options.vocab, instructionsFile: options.instructions });
  if (operation === 'lookup') {
    fs.mkdirSync(path.dirname(options['key-out']), { recursive: true });
    fs.writeFileSync(options['key-out'], `${key}\n`);
    const review = facts.complete === true && facts.coverage?.every((entry) => entry.status === 'read' || entry.status === 'extracted') && facts.discarded?.length === 0
      ? readCoverageReviewCache(options.out, key) : null;
    if (review) {
      fs.mkdirSync(path.dirname(options.review), { recursive: true });
      fs.writeFileSync(options.review, `${JSON.stringify(review, null, 2)}\n`);
      process.stdout.write('coverage review: reused\n');
    } else process.stdout.write('coverage review: run reviewer\n');
  } else {
    const review = JSON.parse(fs.readFileSync(options.review, 'utf8'));
    const expectedKey = fs.readFileSync(options['key-file'], 'utf8').trim();
    const saved = storeCoverageReviewCache({ cacheDir: options.out, key, facts, review, expectedKey });
    process.stdout.write(`coverage review: ${saved ? 'cached' : 'not cached'}\n`);
  }
  exitWith(0);
}
runCli(main);
