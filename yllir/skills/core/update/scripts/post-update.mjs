#!/usr/bin/env node
// Post-update table migration planner. `--prepare` creates only write-sequence
// drafts; it never edits a campaign sheet. `--complete` verifies canonical
// files and clears the pending marker only after the full scan is clean.
import path from 'node:path';
import { completePostUpdate, preparePostUpdate, verifyPostUpdateDrafts } from './lib/post-update.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1 || argv.length > 3) throw new Error('usage: node post-update.mjs <campaignRoot> [--dry-run|--prepare|--verify <files>|--complete]');
  const root = path.resolve(argv[0]);
  const flag = argv[1] ?? '--dry-run';
  if (flag === '--verify' ? argv.length !== 3 : argv.length !== 2 && argv.length !== 1) {
    throw new Error('usage: node post-update.mjs <campaignRoot> [--dry-run|--prepare|--verify <files>|--complete]');
  }
  let result;
  if (flag === '--dry-run') result = preparePostUpdate(root);
  else if (flag === '--prepare') result = preparePostUpdate(root, { writeDrafts: true });
  else if (flag === '--complete') result = completePostUpdate(root);
  else if (flag === '--verify' && argv[2]) result = verifyPostUpdateDrafts(root, argv[2].split(',').filter(Boolean));
  else throw new Error('usage: node post-update.mjs <campaignRoot> [--dry-run|--prepare|--verify <files>|--complete]');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.status === 'failed' ? 1 : 0);
}

runCli(main);
