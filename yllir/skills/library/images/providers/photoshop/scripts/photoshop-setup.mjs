#!/usr/bin/env node
// Command line: installs the pinned Photoshop MCP server outside the campaigns.
// Usage: node photoshop-setup.mjs [--data-dir <path>]
// Prints the state of Photoshop and of the server, then `exit: <code>` (see cli-exit.mjs).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from '../../../../../../scripts/lib/data-dir.mjs';
import { findPhotoshop, ensureInstalled } from './lib/photoshop-mcp.mjs';
import { exitWith, runCli } from '../../../../../../scripts/lib/cli-exit.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--data-dir') {
      args.dataDir = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = resolveDataDir(args.dataDir ?? process.env.YLLIR_DATA_DIR);

  if (findPhotoshop() === null) {
    process.stdout.write('photoshop: missing\nserver: unavailable\nreason: no-photoshop\n');
    exitWith(1);
    return;
  }
  process.stdout.write('photoshop: installed\n');

  const result = await ensureInstalled({ pluginRoot, dataDir });
  if (result.ok) {
    process.stdout.write('server: ready\n');
    exitWith(0);
    return;
  }
  process.stdout.write(`server: unavailable\nreason: ${result.reason}\n`);
  process.stderr.write(`${result.message}\n`);
  exitWith(1);
}

runCli(main);
