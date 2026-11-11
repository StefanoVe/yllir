#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { acceptUnchangedItem, completeItemDescriptions, prepareItemDescriptions, refreshChangedItem, stageItemDescriptionDraft, verifyItemDescriptionDrafts } from './lib/item-descriptions.mjs';
import { runCli, exitWith } from '../../../../scripts/lib/cli-exit.mjs';
function main() {
  const [campaign = '.', flag = '--prepare', ...args] = process.argv.slice(2);
  const root = path.resolve(campaign); let result;
  if (flag === '--prepare' && args.length === 0) result = prepareItemDescriptions(root);
  else if (flag === '--stage' && args.length === 2) result = stageItemDescriptionDraft(root, args[0], fs.readFileSync(path.resolve(root, args[1]), 'utf8'));
  else if (flag === '--verify' && args.length === 1) result = verifyItemDescriptionDrafts(root, args[0].split(',').filter(Boolean));
  else if (flag === '--complete' && args.length === 1) result = completeItemDescriptions(root, args[0] === '-' ? [] : args[0].split(',').filter(Boolean));
  else if (flag === '--refresh' && args.length === 1) result = refreshChangedItem(root, args[0]);
  else if (flag === '--accept-unchanged' && args.length === 2) result = acceptUnchangedItem(root, args[0], args[1]);
  else throw new Error('usage: item-descriptions.mjs <root> --prepare | --stage <file> <draft-file> | --verify <files> | --complete <files|-> | --refresh <file> | --accept-unchanged <file> <review-reason>');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); exitWith(result.status === 'failed' ? 1 : 0);
}
runCli(main);
