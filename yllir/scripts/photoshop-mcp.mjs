#!/usr/bin/env node
// The MCP server command of the Photoshop integration. Runs the pinned server when it is
// installed; otherwise starts the installation in the background and serves an empty
// MCP server, so the host shows no failed server. Only MCP JSON goes to stdout.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from './lib/data-dir.mjs';
import { loadManifest, findPhotoshop, readReady, emptyServer } from './lib/photoshop-mcp.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setupScript = path.join(pluginRoot, 'scripts', 'photoshop-setup.mjs');

async function main() {
  const dataDir = resolveDataDir(process.env.YLLIR_DATA_DIR);
  if (findPhotoshop() === null) {
    await emptyServer(process.stdin, process.stdout);
    return;
  }

  const ready = readReady(dataDir, loadManifest(pluginRoot));
  if (ready) {
    const child = spawn(process.execPath, [ready.entry], { stdio: 'inherit' });
    const forward = (signal) => () => child.kill(signal);
    process.on('SIGTERM', forward('SIGTERM'));
    process.on('SIGINT', forward('SIGINT'));
    child.on('exit', (code) => process.exit(code ?? 1));
    return;
  }

  process.stderr.write('yllir: installing the Photoshop server in the background\n');
  spawn(process.execPath, [setupScript, '--data-dir', dataDir], { detached: true, stdio: 'ignore' }).unref();
  await emptyServer(process.stdin, process.stdout);
}

main().catch((err) => {
  process.stderr.write(`${err?.message ?? String(err)}\n`);
  process.exit(1);
});
