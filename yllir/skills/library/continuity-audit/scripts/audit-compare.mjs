#!/usr/bin/env node
// Compares the facts of a continuity audit and writes the candidates as JSON.
// Usage: node audit-compare.mjs <root> --facts <facts.json> --out <candidates.json>
// Exit codes: 0 compared, 1 compared but coverage is incomplete, 2 usage error or unreadable input.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlLite } from '../../../../scripts/lib/yaml-lite.mjs';
import { compareFacts, exclusionsFromConfig } from './lib/audit-compare.mjs';import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';


const USAGE = 'usage: node audit-compare.mjs <root> --facts <facts.json> --out <candidates.json>';

function parseArgs(argv) {
  const opts = { root: null, facts: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--facts' || arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) return null;
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
  if (opts.root === null || opts.facts === null || opts.out === null) return null;
  return opts;
}

function fail(message) {
  throw new Error(message);
}

function readCampaignExclusions(root) {
  const file = path.join(root, 'campaign.yaml');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail(`cannot read ${file}: ${err.message}`);
  }
  const { data, errors } = parseYamlLite(text);
  if (errors.length > 0) {
    fail(`${file} line ${errors[0].line}: ${errors[0].message}`);
  }
  try {
    return exclusionsFromConfig(data);
  } catch (err) {
    fail(`${file}: ${err.message}`);
  }
}

function readFacts(file) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`cannot read ${file}: ${err.message}`);
  }
  if (doc === null || typeof doc !== 'object' || !Array.isArray(doc.facts) || typeof doc.complete !== 'boolean') {
    fail(`${file}: expected an object with a "facts" list and a boolean "complete"`);
  }
  return doc;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    fail(USAGE);
  }

  const campaignRoot = path.resolve(args.root);
  const exclusions = readCampaignExclusions(campaignRoot);
  const factsDoc = readFacts(path.resolve(args.facts));

  let result;
  try {
    result = compareFacts(factsDoc.facts, exclusions);
  } catch (err) {
    fail(`${args.facts}: cannot compare facts: ${err.message}`);
  }

  const outFile = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);

  const { stats } = result;
  const lines = [];
  if (!factsDoc.complete) {
    lines.push('WARNING: coverage incomplete');
  }
  lines.push(
    `facts: ${stats.facts}, candidates: ${stats.candidates}, excluded: ${stats.excluded}, hypotheses: ${stats.hypotheses}`,
  );
  for (const c of result.candidates) {
    lines.push(`${c.cid} ${c.kind} ${c.subject} ${c.attribute} ${c.values.join(' | ')}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  exitWith(factsDoc.complete ? 0 : 1);
}

runCli(main);
