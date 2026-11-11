#!/usr/bin/env node
// Brings a campaign up to the installed framework version (see lib/update-campaign.mjs).
// Prints one JSON document, then `exit: <code>` as the last line.
// Usage: node update-campaign.mjs <campaignRoot> [--dry-run] [--resume] [--cancel] [--postpone]
//        node update-campaign.mjs <campaignRoot> --complete <migration-id>
//   --resume            finish an interrupted update (keeps its restore point)
//   --cancel            undo an interrupted update by restoring its restore point
//   --postpone          record that the master postponed the update notice
//   --complete <id>     finish the guided part of one pending migration
// Exit codes: 0 up-to-date, would-update, updated, cancelled, postponed, complete or
// pending; 1 known failure; 2 usage error.

import path from 'node:path';
import {
  cancelInterruptedUpdate,
  completeMigration,
  postponeNotice,
  updateCampaign,
} from './lib/update-campaign.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node update-campaign.mjs <campaignRoot> [--dry-run] [--resume] [--cancel] [--postpone] | <campaignRoot> --complete <migration-id>';
const FLAGS = ['--dry-run', '--resume', '--cancel', '--postpone'];

function parseArgs(argv) {
  const flags = new Set();
  let root = null;
  let complete = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (FLAGS.includes(arg)) {
      if (flags.has(arg)) return null;
      flags.add(arg);
    } else if (arg === '--complete') {
      const id = argv[i + 1];
      if (complete !== null || id === undefined || id.startsWith('--') || id === '') return null;
      complete = id;
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (root === null) {
      root = arg;
    } else {
      return null;
    }
  }
  if (root === null) return null;
  // --cancel, --postpone and --complete each stand alone.
  if ((flags.has('--cancel') || flags.has('--postpone')) && (flags.size > 1 || complete !== null)) return null;
  if (complete !== null && flags.size > 0) return null;
  return { root, flags, complete };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const campaignRoot = path.resolve(args.root);
  let result;
  if (args.complete !== null) {
    result = await completeMigration(campaignRoot, args.complete);
  } else if (args.flags.has('--postpone')) {
    result = postponeNotice(campaignRoot);
  } else if (args.flags.has('--cancel')) {
    result = cancelInterruptedUpdate(campaignRoot);
  } else {
    result = await updateCampaign(campaignRoot, {
      dryRun: args.flags.has('--dry-run'),
      resume: args.flags.has('--resume'),
    });
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  exitWith(result.status === 'failed' ? 1 : 0);
}

runCli(main);
