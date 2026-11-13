#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { completeCombatSheets, prepareCombatStatistics, refreshChangedSheet, stageCombatDraft, verifyCombatDrafts } from './lib/combat-statistics.mjs';
import { runCli, exitWith } from '../../../../scripts/lib/cli-exit.mjs';

async function main() {
  const [campaign = '.', flag = '--prepare', ...args] = process.argv.slice(2);
  const root = path.resolve(campaign);
  let result;
  if (flag === '--prepare' && args.length === 0) result = await prepareCombatStatistics(root);
  else if (flag === '--stage' && args.length === 2) result = await stageCombatDraft(root, args[0], fs.readFileSync(path.resolve(root, args[1]), 'utf8'));
  else if (flag === '--verify' && args.length === 1) result = await verifyCombatDrafts(root, args[0].split(',').filter(Boolean));
  else if (flag === '--complete' && args.length === 1) result = await completeCombatSheets(root, args[0] === '-' ? [] : args[0].split(',').filter(Boolean));
  else if (flag === '--refresh' && args.length === 1) result = await refreshChangedSheet(root, args[0]);
  else throw new Error('usage: combat-statistics.mjs <root> --prepare | --stage <file> <draft-file> | --verify <files> | --complete <files|-> | --refresh <file>');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.status === 'failed' ? 1 : 0);
}

runCli(main);
