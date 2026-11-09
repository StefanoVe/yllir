#!/usr/bin/env node
// Searches a campaign for terms and writes every subject, hit, link and scanned
// document as JSON. The judgement of what the hits mean is left to the agent.
// Usage: node research-search.mjs <campaignRoot> --terms "<t1>;<t2>;..." --out <file>
// Exit codes: 0 search done (zero hits included), 1 campaign.yaml unreadable, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { readStructure } from '../../../../scripts/lib/subjects.mjs';
import { parseTerms, searchCampaign } from './lib/research-search.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node research-search.mjs <campaignRoot> --terms "<t1>;<t2>;..." --out <file>';

function parseArgs(argv) {
  const opts = { root: null, terms: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--terms' || arg === '--out') {
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
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null || args.root === null || args.terms === null || args.out === null) {
    throw new Error(USAGE);
  }
  const terms = parseTerms(args.terms);
  if (terms.length === 0) throw new Error(USAGE);

  const campaignRoot = path.resolve(args.root);
  const { errors } = readStructure(campaignRoot);
  if (errors.length > 0) {
    for (const err of errors) process.stderr.write(`${err.file}: ${err.message}\n`);
    exitWith(1);
    return;
  }

  const search = searchCampaign(campaignRoot, terms);
  const outFile = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(search, null, 2)}\n`);

  process.stdout.write(
    `terms: ${search.terms.length}, subjects: ${search.subjects.length}, ` +
      `homonyms: ${search.homonyms.length}, hits: ${search.hits.length}, ` +
      `files with hits: ${search.files_with_hits.length}, ` +
      `documents scanned: ${search.documents.length}\n`,
  );
  exitWith(0);
}

runCli(main);
