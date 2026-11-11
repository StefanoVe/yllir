// Probes which image services are available on this machine and stores the result
// in the campaign's probe table (see providers.mjs). Scripts cannot see the Photoshop
// tools or the MCP tools, so the agent tells whether they are visible. Consent is
// never lost here.

import { spawn } from 'node:child_process';
import { ORDER, readTable, writeTable } from './providers.mjs';
import { loadCampaignProviders, readKey } from './campaign-providers.mjs';
import { DEFAULT_URL, probeComfyui } from './comfyui.mjs';
import { probeCodex } from './codex.mjs';

const PROBE_TIMEOUT_MS = 5000;

/**
 * Runs a campaign command provider's probe argv. Available only when it exits 0.
 * Never uses a shell, and never throws.
 */
function runProbe(argv, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      finish({ available: false, reason: 'probe-failed' });
      return;
    }

    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ available: false, reason: 'timeout' });
    }, timeoutMs);

    child.stdout.resume();
    child.stderr.resume();
    child.on('error', (err) => {
      finish({ available: false, reason: err.code === 'ENOENT' ? 'not-installed' : 'probe-failed' });
    });
    child.on('close', (code) => {
      if (code === 0) finish({ available: true, reason: null });
      else finish({ available: false, reason: 'probe-failed' });
    });
  });
}

/** Probes one valid campaign provider. Returns the table entry without consent. */
async function probeCampaignProvider(campaignRoot, manifest, { mcpTools, env }) {
  if (manifest.kind === 'command') {
    const result = await runProbe(manifest.probe);
    return { available: result.available, reason: result.reason };
  }
  if (manifest.kind === 'http') {
    if (manifest.key_env === null || manifest.key_env === undefined) {
      return { available: true, reason: null };
    }
    const key = readKey(campaignRoot, manifest, env);
    return key !== null ? { available: true, reason: null } : { available: false, reason: 'no-key' };
  }
  // mcp: the assistant reports which MCP tools it can see.
  return mcpTools.includes(manifest.tool)
    ? { available: true, reason: null }
    : { available: false, reason: 'tool-not-visible' };
}

/**
 * Probes ComfyUI and Codex in parallel, the campaign providers, takes Photoshop from
 * the flag, writes the table and returns it. Consent recorded by an earlier table is
 * kept. Campaign providers that fail validation are listed in `invalid` and left out
 * of `providers`, so they are never chosen.
 */
export async function probeAll({
  campaignRoot,
  photoshop,
  comfyuiUrl,
  codexCommand = 'codex',
  fetchImpl,
  mcpTools = [],
  env = process.env,
  now = () => new Date().toISOString(),
}) {
  const previous = readTable(campaignRoot);
  const previousEntry = (id) => previous.providers[id] ?? {};

  const url = comfyuiUrl ?? previousEntry('comfyui').url ?? DEFAULT_URL;
  const campaign = loadCampaignProviders(campaignRoot, env);
  const [comfy, codex, campaignEntries] = await Promise.all([
    probeComfyui({ url, fetchImpl }),
    probeCodex({ command: codexCommand }),
    Promise.all(campaign.providers.map((manifest) => probeCampaignProvider(campaignRoot, manifest, { mcpTools, env }))),
  ]);

  const providers = {};
  campaign.providers.forEach((manifest, index) => {
    providers[manifest.id] = campaignEntries[index];
  });
  providers.comfyui = {
    available: comfy.available,
    url: comfy.url,
    checkpoint: comfy.checkpoint,
    removeBackground: comfy.removeBackground,
    reason: comfy.reason ?? null,
  };
  providers.codex = { available: codex.available, version: codex.version, reason: codex.reason };
  providers.photoshop = { available: photoshop === 'yes' };
  providers.upload = { available: true };

  for (const id of [...campaign.providers.map((manifest) => manifest.id), ...ORDER]) {
    const consent = previousEntry(id).consent;
    if (consent !== undefined) providers[id].consent = consent;
  }

  const table = { checked: now(), providers, invalid: campaign.errors.map((entry) => entry.id) };
  writeTable(campaignRoot, table);
  return table;
}
