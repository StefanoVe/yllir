#!/usr/bin/env node
// economy-v1 helper: reads or records the economy question of a campaign.
//   --status   prints { status: 'present' | 'deferred' | 'open' }
//   --defer    records the master's «later» and prints the new status
import path from 'node:path';
import { deferEconomy, economyStatus } from './lib/economy-question.mjs';
import { runCli, exitWith } from '../../../../scripts/lib/cli-exit.mjs';

function main() {
  const [campaign = '.', flag = '--status', ...rest] = process.argv.slice(2);
  const root = path.resolve(campaign);
  let result;
  if (flag === '--status' && rest.length === 0) result = { status: economyStatus(root) };
  else if (flag === '--defer' && rest.length === 0) result = deferEconomy(root);
  else throw new Error('usage: economy-question.mjs <campaignRoot> --status | --defer');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(0);
}

runCli(main);
