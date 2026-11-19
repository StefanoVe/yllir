#!/usr/bin/env node
import path from 'node:path';
import { markChunkDone, prepareProseStyle, recordMasterAnswer } from './lib/prose-style.mjs';
import { runCli, exitWith } from '../../../../scripts/lib/cli-exit.mjs';

async function main() {
  const [campaign = '.', flag = '--prepare', ...args] = process.argv.slice(2);
  const root = path.resolve(campaign);
  let result;
  if (flag === '--prepare' && args.length === 0) result = prepareProseStyle(root);
  else if (flag === '--done' && args.length === 1) result = markChunkDone(root, args[0]);
  else if (flag === '--master-answer' && args.length === 1) result = recordMasterAnswer(root, args[0]);
  else throw new Error('usage: prose-style.mjs <root> --prepare | --done <chunkId> | --master-answer <yes|no>');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.status === 'failed' ? 1 : 0);
}

runCli(main);
