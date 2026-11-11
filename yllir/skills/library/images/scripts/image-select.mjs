#!/usr/bin/env node
// Chooses the image provider for one operation, or records the master's consent.
// Usage: node image-select.mjs <campaignRoot> --operation <op> [--provider <id|name>] [--exclude <id,id>] [--consent <id>]
// Exit codes: 0 provider chosen (or consent recorded), 1 no provider, 2 usage error.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadAllProviders,
  readTable,
  recordConsent,
  selectProvider,
} from './lib/providers.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node image-select.mjs <campaignRoot> --operation <op> [--provider <id>] [--exclude <id,id>] [--consent <id>]';

const VALUE_OPTIONS = new Set(['--operation', '--provider', '--exclude', '--consent']);

function parseArgs(argv) {
  const opts = { root: null, operation: null, provider: null, exclude: [], consent: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      if (arg === '--exclude') opts.exclude = value.split(',').map((s) => s.trim()).filter(Boolean);
      else opts[arg.slice(2)] = value;
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (opts.root === null) {
      opts.root = arg;
    } else {
      return null;
    }
  }
  if (opts.root === null) return null;
  if (opts.consent === null && opts.operation === null) return null;
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);
  const campaignRoot = path.resolve(args.root);

  if (args.consent !== null) {
    recordConsent(campaignRoot, args.consent);
    process.stdout.write(`consent: ${args.consent}\n`);
    exitWith(0);
    return;
  }

  // scripts/ sits in skills/library/images, so the plugin root is four levels up.
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  const { providers } = loadAllProviders(pluginRoot, campaignRoot);
  const table = readTable(campaignRoot);
  const choice = selectProvider({
    providers,
    table,
    operation: args.operation,
    requested: args.provider,
    exclude: args.exclude,
  });

  process.stdout.write(`provider: ${choice.provider ?? 'none'}\n`);
  process.stdout.write(`reason: ${choice.reason}\n`);
  process.stdout.write(`needs-consent: ${choice.needsConsent ? 'yes' : 'no'}\n`);
  exitWith(choice.provider === null ? 1 : 0);
}

runCli(main);
