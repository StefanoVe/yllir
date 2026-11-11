// Tests for the probe. No real network and no real Codex: fetch is always injected,
// and the Codex command points to a path that does not exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeAll } from './image-probe.mjs';
import { readTable, writeTable } from './providers.mjs';

const CAMPAIGN_ADDED = '2026-11-11T10:00:00Z';

function writeCampaignProvider(root, id, files) {
  const dir = path.join(root, '.campaign', 'image-providers', id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text, 'utf8');
}

function commandFiles(id, probe) {
  const lines = [
    `id: ${id}`,
    'name: Local tool',
    'kind: command',
    'operations:',
    '  - generate',
    'command:',
    '  - "tool"',
    '  - "{OUTPUT}"',
    'probe:',
    ...probe.map((arg) => `  - ${JSON.stringify(arg)}`),
    'external: true',
    `added: ${CAMPAIGN_ADDED}`,
  ];
  return { 'provider.yaml': `${lines.join('\n')}\n` };
}

function mcpFiles(id, tool) {
  return {
    'provider.yaml': [
      `id: ${id}`,
      'name: Tool service',
      'kind: mcp',
      'operations:',
      '  - generate',
      `tool: ${tool}`,
      'external: true',
      `added: ${CAMPAIGN_ADDED}`,
    ].join('\n') + '\n',
    'instructions.md': 'Use the tool to make one image.\n',
  };
}

function httpFiles(id, keyEnv = null) {
  const lines = [`id: ${id}`, 'name: Gemini', 'kind: http', 'operations:', '  - generate'];
  if (keyEnv !== null) lines.push(`key_env: ${keyEnv}`);
  lines.push('external: true', `added: ${CAMPAIGN_ADDED}`);
  const request = {
    method: 'POST',
    url: 'https://example.invalid/v1/images',
    body: { prompt: '{PROMPT}' },
    response: { base64: 'data.0.b64' },
  };
  if (keyEnv !== null) request.headers = { 'x-api-key': '{KEY}' };
  return { 'provider.yaml': `${lines.join('\n')}\n`, 'request.json': JSON.stringify(request) };
}

/** probeAll options with no network, no Codex and an empty environment. */
const offline = (root, extra = {}) => ({
  campaignRoot: root,
  photoshop: 'no',
  codexCommand: MISSING_CODEX,
  fetchImpl: unreachableFetch,
  env: {},
  ...extra,
});

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '../image-probe.mjs');
const MISSING_CODEX = '/nonexistent/codex';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const unreachableFetch = async () => {
  throw new TypeError('fetch failed');
};

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-probe-'));
}

test('comfyui unreachable and codex missing: both unavailable, upload available, photoshop per flag', async () => {
  const root = tempRoot();
  const table = await probeAll({
    campaignRoot: root,
    photoshop: 'yes',
    codexCommand: MISSING_CODEX,
    fetchImpl: unreachableFetch,
    now: () => '2026-11-11T10:00:00.000Z',
  });
  assert.equal(table.checked, '2026-11-11T10:00:00.000Z');
  assert.equal(table.providers.comfyui.available, false);
  assert.equal(table.providers.comfyui.reason, 'unreachable');
  assert.equal(table.providers.codex.available, false);
  assert.equal(table.providers.codex.reason, 'not-installed');
  assert.equal(table.providers.photoshop.available, true);
  assert.equal(table.providers.upload.available, true);

  const stored = readTable(root);
  assert.deepEqual(stored, table);

  const noPhotoshop = await probeAll({
    campaignRoot: root,
    photoshop: 'no',
    codexCommand: MISSING_CODEX,
    fetchImpl: unreachableFetch,
  });
  assert.equal(noPhotoshop.providers.photoshop.available, false);
});

test('comfyui serving one checkpoint: available with that checkpoint', async () => {
  const root = tempRoot();
  const fetchImpl = async (url) => {
    if (url.endsWith('/system_stats')) return json({});
    if (url.endsWith('/object_info/CheckpointLoaderSimple')) {
      return json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['model-a.safetensors']] } } } });
    }
    return new Response('not found', { status: 404 });
  };
  const table = await probeAll({ campaignRoot: root, photoshop: 'no', codexCommand: MISSING_CODEX, fetchImpl });
  assert.equal(table.providers.comfyui.available, true);
  assert.equal(table.providers.comfyui.checkpoint, 'model-a.safetensors');
  assert.equal(table.providers.comfyui.removeBackground, false);
  assert.equal(table.providers.comfyui.reason, null);
});

test('consent recorded earlier is kept by a new probe', async () => {
  const root = tempRoot();
  writeTable(root, { checked: 'old', providers: { codex: { available: false, consent: true } } });
  const table = await probeAll({ campaignRoot: root, photoshop: 'no', codexCommand: MISSING_CODEX, fetchImpl: unreachableFetch });
  assert.equal(table.providers.codex.consent, true);
  assert.equal(table.providers.codex.available, false);
  assert.equal(readTable(root).providers.codex.consent, true);
});

test('custom comfyui url is stored and reused without the option', async () => {
  const root = tempRoot();
  const seen = [];
  const recordingFetch = async (url) => {
    seen.push(url);
    throw new TypeError('fetch failed');
  };
  const first = await probeAll({
    campaignRoot: root,
    photoshop: 'no',
    comfyuiUrl: 'http://10.0.0.5:9999',
    codexCommand: MISSING_CODEX,
    fetchImpl: recordingFetch,
  });
  assert.equal(first.providers.comfyui.url, 'http://10.0.0.5:9999');

  seen.length = 0;
  const second = await probeAll({ campaignRoot: root, photoshop: 'no', codexCommand: MISSING_CODEX, fetchImpl: recordingFetch });
  assert.equal(second.providers.comfyui.url, 'http://10.0.0.5:9999');
  assert.ok(seen.length > 0);
  assert.ok(seen.every((url) => url.startsWith('http://10.0.0.5:9999/')));
});

test('CLI without arguments prints usage and exit 2', () => {
  const result = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: node image-probe\.mjs/);
  assert.match(result.stdout, /exit: 2\n$/);
});

test('CLI with invalid --photoshop prints usage and exit 2', () => {
  const result = spawnSync(process.execPath, [CLI, tempRoot(), '--photoshop', 'maybe'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /exit: 2\n$/);
});

test('CLI with --mcp-tools and no value prints usage and exit 2', () => {
  const result = spawnSync(process.execPath, [CLI, tempRoot(), '--photoshop', 'no', '--mcp-tools'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: node image-probe\.mjs/);
});

test('campaign command provider: available when its probe exits 0, unavailable when the program is missing', async () => {
  const root = tempRoot();
  writeCampaignProvider(root, 'local-ok', commandFiles('local-ok', [process.execPath, '-e', 'process.exit(0)']));
  writeCampaignProvider(root, 'local-missing', commandFiles('local-missing', ['/nonexistent/x']));
  const table = await probeAll(offline(root));
  assert.equal(table.providers['local-ok'].available, true);
  assert.equal(table.providers['local-missing'].available, false);
  assert.equal(table.providers['local-missing'].reason, 'not-installed');
  assert.deepEqual(table.invalid, []);
});

test('campaign mcp provider: available only when its tool is among the visible MCP tools', async () => {
  const root = tempRoot();
  writeCampaignProvider(root, 'mcp-maker', mcpFiles('mcp-maker', 'mcp__image__make'));
  const hidden = await probeAll(offline(root, { mcpTools: ['mcp__other__x'] }));
  assert.equal(hidden.providers['mcp-maker'].available, false);
  assert.equal(hidden.providers['mcp-maker'].reason, 'tool-not-visible');

  const visible = await probeAll(offline(root, { mcpTools: ['mcp__other__x', 'mcp__image__make'] }));
  assert.equal(visible.providers['mcp-maker'].available, true);
});

test('campaign http provider: without key_env it is available; with key_env and no key it is no-key', async () => {
  const root = tempRoot();
  writeCampaignProvider(root, 'plain', httpFiles('plain'));
  writeCampaignProvider(root, 'gemini', httpFiles('gemini', 'PROBE_TEST_IMAGE_KEY'));

  const without = await probeAll(offline(root));
  assert.equal(without.providers.plain.available, true);
  assert.equal(without.providers.gemini.available, false);
  assert.equal(without.providers.gemini.reason, 'no-key');

  const withKey = await probeAll(offline(root, { env: { PROBE_TEST_IMAGE_KEY: 'test-value' } }));
  assert.equal(withKey.providers.gemini.available, true);
});

test('consent recorded for a campaign provider is kept by a new probe', async () => {
  const root = tempRoot();
  writeCampaignProvider(root, 'gemini', httpFiles('gemini'));
  writeTable(root, { checked: 'old', providers: { gemini: { available: false, consent: true } } });
  const table = await probeAll(offline(root));
  assert.equal(table.providers.gemini.consent, true);
  assert.equal(readTable(root).providers.gemini.consent, true);
});

test('invalid campaign provider is listed under invalid and absent from providers', async () => {
  const root = tempRoot();
  writeCampaignProvider(root, 'broken', { 'provider.yaml': 'id: broken\nkind: spaceship\n' });
  const table = await probeAll(offline(root));
  assert.deepEqual(table.invalid, ['broken']);
  assert.equal(table.providers.broken, undefined);
  assert.deepEqual(readTable(root).invalid, ['broken']);
});
