#!/usr/bin/env node
// Installs the map tools on first use, outside every campaign. Idempotent.
// Usage: node maps-setup.mjs [--data-dir <path>]
// Exit codes: 0 ready, 1 unavailable, 2 usage error.

import {
  defaultDownload,
  defaultRunner,
  ensureInstalled,
  loadManifest,
  resolveDataDir,
} from './lib/install.mjs';
import { exitWith, runCli } from '../../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node maps-setup.mjs [--data-dir <path>]';

function parseArgs(argv) {
  const opts = { dataDir: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--data-dir') return null;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return null;
    opts.dataDir = value;
    i++;
  }
  return opts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const result = await ensureInstalled({
    dataDir: resolveDataDir(args.dataDir),
    manifest: loadManifest(),
    runner: defaultRunner,
    download: defaultDownload,
  });

  if (!result.ok) {
    process.stdout.write(`result: unavailable\nreason: ${result.reason}\nmessage: ${result.message}\n`);
    exitWith(1);
    return;
  }
  const { ready } = result;
  process.stdout.write(
    `result: ok\npython: ${ready.python}\ngenerate2dmap: ${ready.generate2dmap}\ngenerate2dmedia: ${ready.generate2dmedia}\n`,
  );
  exitWith(0);
}

runCli(main);
