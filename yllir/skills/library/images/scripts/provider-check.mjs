#!/usr/bin/env node
// Checks one campaign image provider: <campaignRoot>/.campaign/image-providers/<id>/.
// Usage: node provider-check.mjs <campaignRoot> <id>
// Exit codes: 0 valid, 1 invalid, 2 usage error. Never prints a key value.

import path from 'node:path';
import { validateCampaignProvider } from './lib/campaign-providers.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node provider-check.mjs <campaignRoot> <id>';

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args.some((arg) => arg === '' || arg.startsWith('--'))) {
    throw new Error(USAGE);
  }
  const [root, id] = args;
  const result = validateCampaignProvider(path.resolve(root), id);
  if (!result.ok) {
    for (const message of result.errors) process.stdout.write(`error: ${message}\n`);
    process.stdout.write('result: invalid\n');
    exitWith(1);
    return;
  }
  process.stdout.write(`provider: ${id}\n`);
  process.stdout.write(`kind: ${result.manifest.kind}\n`);
  process.stdout.write('result: ok\n');
  exitWith(0);
}

runCli(main);
