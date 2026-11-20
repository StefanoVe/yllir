#!/usr/bin/env node
import path from 'node:path';
import { placeKindCandidates, markReviewed } from './lib/place-kinds.mjs';
import { runCli, exitWith } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: place-kinds.mjs <root> --list | --done';

async function main() {
  const [campaign, flag, ...rest] = process.argv.slice(2);
  if (!campaign || rest.length > 0 || (flag !== '--list' && flag !== '--done')) throw new Error(USAGE);
  const root = path.resolve(campaign);
  let result;
  if (flag === '--list') {
    const candidates = placeKindCandidates(root);
    result = { status: candidates.length > 0 ? 'pending' : 'complete', candidates };
  } else {
    result = markReviewed(root);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.status === 'failed' ? 1 : 0);
}

runCli(main);
