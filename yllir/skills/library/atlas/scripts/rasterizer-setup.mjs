#!/usr/bin/env node
// Installs the rasterizer of the atlas rasterizer (@resvg/resvg-js and @jsquash/webp, pinned in assets/rasterizer-tools.json) outside every
// campaign, on first use. Idempotent: an installed pinned version is only checked.
// Usage: node rasterizer-setup.mjs [--data-dir <path>]
// Exit codes: 0 ready, 1 unavailable, 2 usage error.

import { spawn } from 'node:child_process';
import { installRasterizer, resolveDataDir } from './lib/rasterize.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE = 'usage: node rasterizer-setup.mjs [--data-dir <path>]';

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

/** Runs a command without a shell (on Windows through the shell, for npm.cmd). Never rejects. */
function defaultRunner(cmd, args, { cwd, env } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    } catch (err) {
      resolve({ code: 127, stdout: '', stderr: err.message });
      return;
    }
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => resolve({ code: err.code === 'ENOENT' ? 127 : 1, stdout, stderr: stderr + err.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);

  const result = await installRasterizer({
    dataDir: resolveDataDir(args.dataDir),
    runner: defaultRunner,
  });
  if (!result.ok) {
    process.stdout.write(`unavailable: ${result.reason}\nmessage: ${result.message}\n`);
    exitWith(1);
    return;
  }
  process.stdout.write('ready\n');
  exitWith(0);
}

runCli(main);
