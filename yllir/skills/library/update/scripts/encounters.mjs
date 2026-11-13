#!/usr/bin/env node
// encounters-v1 helper: the fights of the event files (plot scenes) that have a creature among their characters.
//   --prepare                  refreshes the inventory and prints the pending events
//   --no-fight <file>          marks an event as having no fight, so it is never proposed again
//   --complete <files>         marks the events complete whose current text has a valid enemies block
import path from 'node:path';
import { completeEncounters, markNoFight, prepareEncounters } from './lib/encounters.mjs';
import { runCli, exitWith } from '../../../../scripts/lib/cli-exit.mjs';

async function main() {
  const [campaign = '.', flag = '--prepare', ...args] = process.argv.slice(2);
  const root = path.resolve(campaign);
  let result;
  if (flag === '--prepare' && args.length === 0) result = await prepareEncounters(root);
  else if (flag === '--no-fight' && args.length === 1) result = await markNoFight(root, args[0]);
  else if (flag === '--complete' && args.length === 1) result = await completeEncounters(root, args[0].split(',').filter(Boolean));
  else throw new Error('usage: encounters.mjs <campaignRoot> --prepare | --no-fight <file> | --complete <files>');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.status === 'failed' ? 1 : 0);
}

runCli(main);
