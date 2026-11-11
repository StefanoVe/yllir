#!/usr/bin/env node
// Brings a campaign up to the installed framework version (see lib/update-campaign.mjs).
// Prints one JSON document, then `exit: <code>` as the last line.
// Usage: node update-campaign.mjs <campaignRoot> [--dry-run] [--resume] [--cancel] [--postpone]
//   --resume    finish an interrupted update (keeps its restore point)
//   --cancel    undo an interrupted update by restoring its restore point
//   --postpone  record that the master postponed the update notice
// Exit codes: 0 up-to-date, would-update, updated, cancelled or postponed;
// 1 known failure; 2 usage error.

import path from 'node:path';
import {
  cancelInterruptedUpdate,
  completeGeographicMigration,
  postponeNotice,
  updateCampaign,
} from './lib/update-campaign.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node update-campaign.mjs <campaignRoot> [--dry-run] [--resume] [--cancel] [--postpone] [--complete-geography]';
const FLAGS = ['--dry-run', '--resume', '--cancel', '--postpone', '--complete-geography'];

function parseArgs(argv) {
  const flags = new Set();
  let root = null;
  for (const arg of argv) {
    if (FLAGS.includes(arg)) {
      if (flags.has(arg)) return null;
      flags.add(arg);
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (root === null) {
      root = arg;
    } else {
      return null;
    }
  }
  if (root === null) return null;
  // --cancel and --postpone each stand alone.
  if ((flags.has('--cancel') || flags.has('--postpone') || flags.has('--complete-geography')) && flags.size > 1) return null;
  return { root, flags };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const campaignRoot = path.resolve(args.root);
  let result;
  if (args.flags.has('--postpone')) {
    result = postponeNotice(campaignRoot);
  } else if (args.flags.has('--complete-geography')) {
    result = completeGeographicMigration(campaignRoot);
  } else if (args.flags.has('--cancel')) {
    result = cancelInterruptedUpdate(campaignRoot);
  } else {
    result = updateCampaign(campaignRoot, {
      dryRun: args.flags.has('--dry-run'),
      resume: args.flags.has('--resume'),
    });
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.status === 'failed' ? 1 : 0);
}

runCli(main);
