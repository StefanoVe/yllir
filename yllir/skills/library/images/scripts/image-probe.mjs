#!/usr/bin/env node
// Probes the image services and stores the result in the campaign's probe table.
// Usage: node image-probe.mjs <campaignRoot> --photoshop yes|no [--comfyui-url <url>] [--mcp-tools "<a,b>"]
// Exit codes: 0 probe written, 2 usage error.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeAll } from './lib/image-probe.mjs';
import { loadAllProviders, ORDER } from './lib/providers.mjs';
import { exitWith, runCli } from '../../../../scripts/lib/cli-exit.mjs';

const USAGE =
  'usage: node image-probe.mjs <campaignRoot> --photoshop yes|no [--comfyui-url <url>] [--mcp-tools "<a,b>"]';

function parseArgs(argv) {
  const opts = { root: null, photoshop: null, comfyuiUrl: null, mcpTools: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--photoshop' || arg === '--comfyui-url' || arg === '--mcp-tools') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return null;
      if (arg === '--photoshop') opts.photoshop = value;
      else if (arg === '--comfyui-url') opts.comfyuiUrl = value;
      else opts.mcpTools = value.split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (arg.startsWith('--') || arg === '') {
      return null;
    } else if (opts.root === null) {
      opts.root = arg;
    } else {
      return null;
    }
  }
  if (opts.root === null || (opts.photoshop !== 'yes' && opts.photoshop !== 'no')) return null;
  return opts;
}

const yesNo = (value) => (value ? 'yes' : 'no');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) throw new Error(USAGE);
  const campaignRoot = path.resolve(args.root);
  const table = await probeAll({
    campaignRoot,
    photoshop: args.photoshop,
    comfyuiUrl: args.comfyuiUrl ?? undefined,
    mcpTools: args.mcpTools,
  });
  const { providers } = table;

  // scripts/ sits in skills/library/images, so the plugin root is four levels up.
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  const merged = loadAllProviders(pluginRoot, campaignRoot).providers.map((p) => p.id);
  const order = [...new Set([...merged, ...ORDER])];

  const word = (available) => (available ? 'available' : 'unavailable');
  const lines = order.map((id) => `${id}: ${word(providers[id]?.available === true)}`);
  lines.push(`remove-background-comfyui: ${yesNo(providers.comfyui.available && providers.comfyui.removeBackground)}`);
  lines.push(`invalid: ${table.invalid.length > 0 ? table.invalid.join(', ') : 'none'}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  exitWith(0);
}

runCli(main);
