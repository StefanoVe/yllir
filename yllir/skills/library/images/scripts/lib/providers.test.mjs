import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadAllProviders,
  loadProviders,
  ORDER,
  readTable,
  recordConsent,
  selectProvider,
  writeTable,
} from './providers.mjs';

// lib -> scripts -> images -> library -> skills -> yllir
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '../../../../..');
const SELECT_CLI = path.resolve(here, '../image-select.mjs');

const providers = loadProviders(pluginRoot);

function allAvailable(extra = {}) {
  return {
    providers: {
      comfyui: { available: true, removeBackground: true },
      codex: { available: true, consent: true },
      photoshop: { available: true },
      ...extra,
    },
  };
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('loadProviders reads the five real manifests in ORDER', () => {
  assert.deepEqual(
    providers.map((p) => p.id),
    ['comfyui', 'codex', 'generate2dmedia', 'photoshop', 'upload'],
  );
  assert.deepEqual(providers.map((p) => p.id), ORDER);
  const codex = providers.find((p) => p.id === 'codex');
  assert.deepEqual(codex, { id: 'codex', kind: 'script', operations: ['generate'], external: true });
  const g2d = providers.find((p) => p.id === 'generate2dmedia');
  assert.deepEqual(g2d, { id: 'generate2dmedia', kind: 'script', operations: ['generate'], external: true });
});

test('loadProviders throws naming the file on an invalid manifest', () => {
  const root = tempDir('yllir-providers-');
  const dir = path.join(root, 'skills', 'library', 'images', 'providers', 'broken');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'provider.yaml');
  fs.writeFileSync(file, 'id: broken\nkind: spaceship\noperations: [generate]\nexternal: false\n');
  assert.throws(() => loadProviders(root), (err) => err.message.includes(file));
});

test('all available: automatic choice is comfyui', () => {
  const r = selectProvider({ providers, table: allAvailable(), operation: 'generate' });
  assert.equal(r.provider, 'comfyui');
  assert.equal(r.reason, 'automatic');
  assert.equal(r.needsConsent, false);
});

test('comfyui unavailable: automatic choice is codex', () => {
  const table = allAvailable({ comfyui: { available: false, removeBackground: true } });
  const r = selectProvider({ providers, table, operation: 'generate' });
  assert.equal(r.provider, 'codex');
  assert.equal(r.reason, 'automatic');
});

test('remove_background without comfyui removeBackground: photoshop if available', () => {
  const table = allAvailable({ comfyui: { available: true, removeBackground: false } });
  const r = selectProvider({ providers, table, operation: 'remove_background' });
  assert.equal(r.provider, 'photoshop');
  assert.equal(r.reason, 'automatic');
});

test('remove_background without comfyui removeBackground and photoshop: upload', () => {
  const table = {
    providers: {
      comfyui: { available: true, removeBackground: false },
      codex: { available: true, consent: true },
    },
  };
  const r = selectProvider({ providers, table, operation: 'remove_background' });
  assert.equal(r.provider, 'upload');
  assert.equal(r.reason, 'automatic');
});

test('nothing in the table: upload is chosen', () => {
  const r = selectProvider({ providers, table: { providers: {} }, operation: 'generate' });
  assert.equal(r.provider, 'upload');
  assert.equal(r.needsConsent, false);
});

test('exclude comfyui and codex: photoshop for remove_background is not reached, upload for generate', () => {
  const generate = selectProvider({
    providers,
    table: allAvailable(),
    operation: 'generate',
    exclude: ['comfyui', 'codex'],
  });
  assert.equal(generate.provider, 'photoshop');

  const removeBg = selectProvider({
    providers,
    table: { providers: {} },
    operation: 'remove_background',
    exclude: ['comfyui', 'codex', 'photoshop'],
  });
  assert.equal(removeBg.provider, 'upload');

  const onlyExcludedLeft = selectProvider({
    providers,
    table: allAvailable(),
    operation: 'generate',
    exclude: ['comfyui', 'codex', 'photoshop', 'upload'],
  });
  assert.equal(onlyExcludedLeft.provider, null);
  assert.equal(onlyExcludedLeft.reason, 'none-available');
});

test('requested codex and available: codex with reason requested', () => {
  const r = selectProvider({ providers, table: allAvailable(), operation: 'generate', requested: 'codex' });
  assert.equal(r.provider, 'codex');
  assert.equal(r.reason, 'requested');
});

test('requested codex and unavailable: no silent replacement', () => {
  const table = allAvailable({ codex: { available: false, consent: true } });
  const r = selectProvider({ providers, table, operation: 'generate', requested: 'codex' });
  assert.deepEqual(r, { provider: null, reason: 'requested-unavailable', needsConsent: false });
});

test('requested codex for remove_background: requested-unsupported', () => {
  const r = selectProvider({ providers, table: allAvailable(), operation: 'remove_background', requested: 'codex' });
  assert.equal(r.provider, null);
  assert.equal(r.reason, 'requested-unsupported');
});

test('requested comfyui for remove_background without removeBackground: requested-unsupported', () => {
  const table = allAvailable({ comfyui: { available: true, removeBackground: false } });
  const r = selectProvider({ providers, table, operation: 'remove_background', requested: 'comfyui' });
  assert.deepEqual(r, { provider: null, reason: 'requested-unsupported', needsConsent: false });
});

test('requested midjourney: unknown-provider', () => {
  const r = selectProvider({ providers, table: allAvailable(), operation: 'generate', requested: 'midjourney' });
  assert.equal(r.provider, null);
  assert.equal(r.reason, 'unknown-provider');
});

test('unknown operation is reported', () => {
  const r = selectProvider({ providers, table: allAvailable(), operation: 'upscale' });
  assert.equal(r.provider, null);
  assert.equal(r.reason, 'unknown-operation');
});

test('needsConsent: true for codex without consent, false after recordConsent', () => {
  const campaignRoot = tempDir('yllir-campaign-');
  const table = { providers: { codex: { available: true } } };
  const before = selectProvider({ providers, table, operation: 'generate', requested: 'codex' });
  assert.equal(before.provider, 'codex');
  assert.equal(before.needsConsent, true);

  recordConsent(campaignRoot, 'codex');
  const stored = readTable(campaignRoot);
  assert.equal(stored.providers.codex.consent, true);
  assert.equal(stored.providers.codex.available, undefined);

  const after = selectProvider({ providers, table: stored, operation: 'generate', requested: 'codex' });
  assert.equal(after.needsConsent, false);
});

test('readTable on a missing file returns an empty table', () => {
  const campaignRoot = tempDir('yllir-empty-');
  assert.deepEqual(readTable(campaignRoot), { providers: {} });
});

// ---- campaign providers merged with the built-in ones ----

const CAMPAIGN_ADDED = '2026-11-11T10:00:00Z';

/** Files of a minimal valid http campaign provider (no key unless keyEnv is given). */
function httpProviderFiles(id, { name = 'Gemini', added = CAMPAIGN_ADDED, keyEnv = null } = {}) {
  const lines = [`id: ${id}`, `name: ${name}`, 'kind: http', 'operations:', '  - generate'];
  if (keyEnv !== null) lines.push(`key_env: ${keyEnv}`);
  lines.push('external: true', `added: ${added}`);
  const request = {
    method: 'POST',
    url: 'https://example.invalid/v1/images',
    body: { prompt: '{PROMPT}' },
    response: { base64: 'data.0.b64' },
  };
  if (keyEnv !== null) request.headers = { 'x-api-key': '{KEY}' };
  return { 'provider.yaml': `${lines.join('\n')}\n`, 'request.json': JSON.stringify(request) };
}

function writeCampaignProvider(root, id, files) {
  const dir = path.join(root, '.campaign', 'image-providers', id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text, 'utf8');
}

test('loadAllProviders lists the campaign provider first, then the built-ins in ORDER', () => {
  const root = tempDir('yllir-merge-');
  writeCampaignProvider(root, 'gemini', httpProviderFiles('gemini'));
  const { providers: all, errors } = loadAllProviders(pluginRoot, root);
  assert.deepEqual(errors, []);
  assert.deepEqual(all.map((p) => p.id), ['gemini', ...ORDER]);
});

test('loadAllProviders without campaign providers equals the built-ins', () => {
  const root = tempDir('yllir-merge-none-');
  assert.deepEqual(loadAllProviders(pluginRoot, root), { providers: providers, errors: [] });
});

test('campaign providers come newest first', () => {
  const root = tempDir('yllir-newest-');
  writeCampaignProvider(root, 'alpha', httpProviderFiles('alpha', { name: 'Alpha', added: '2026-11-10T10:00:00Z' }));
  writeCampaignProvider(root, 'beta', httpProviderFiles('beta', { name: 'Beta', added: '2026-11-11T10:00:00Z' }));
  const { providers: all } = loadAllProviders(pluginRoot, root);
  assert.deepEqual(all.slice(0, 2).map((p) => p.id), ['beta', 'alpha']);
});

test('automatic choice takes the campaign provider first, and it needs consent until given', () => {
  const root = tempDir('yllir-auto-');
  writeCampaignProvider(root, 'gemini', httpProviderFiles('gemini'));
  const { providers: all } = loadAllProviders(pluginRoot, root);
  const first = selectProvider({ providers: all, table: allAvailable({ gemini: { available: true } }), operation: 'generate' });
  assert.equal(first.provider, 'gemini');
  assert.equal(first.reason, 'automatic');
  assert.equal(first.needsConsent, true);

  const consented = selectProvider({
    providers: all,
    table: allAvailable({ gemini: { available: true, consent: true } }),
    operation: 'generate',
  });
  assert.deepEqual(consented, { provider: 'gemini', reason: 'automatic', needsConsent: false });
});

test('requested accepts the name of a campaign provider in any case and returns the id', () => {
  const root = tempDir('yllir-name-');
  writeCampaignProvider(root, 'gemini', httpProviderFiles('gemini'));
  const { providers: all } = loadAllProviders(pluginRoot, root);
  const table = { providers: { gemini: { available: true, consent: true } } };
  for (const name of ['Gemini', 'GEMINI', 'gemini']) {
    const r = selectProvider({ providers: all, table, operation: 'generate', requested: name });
    assert.deepEqual(r, { provider: 'gemini', reason: 'requested', needsConsent: false });
  }
});

test('invalid campaign provider is reported, left out of the list and never chosen', () => {
  const root = tempDir('yllir-invalid-');
  writeCampaignProvider(root, 'broken', {
    'provider.yaml': 'id: broken\nname: Broken\nkind: spaceship\noperations: [generate]\nexternal: true\nadded: 2026-11-11T10:00:00Z\n',
  });
  const { providers: all, errors } = loadAllProviders(pluginRoot, root);
  assert.deepEqual(all.map((p) => p.id), ORDER);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].id, 'broken');
  assert.ok(errors[0].errors.length > 0);

  const r = selectProvider({
    providers: all,
    table: { providers: { broken: { available: true, consent: true } } },
    operation: 'generate',
    requested: 'broken',
  });
  assert.deepEqual(r, { provider: null, reason: 'unknown-provider', needsConsent: false });
});

test('image-select CLI accepts a campaign provider name for --provider', () => {
  const root = tempDir('yllir-select-cli-');
  writeCampaignProvider(root, 'gemini', httpProviderFiles('gemini'));
  writeTable(root, { providers: { gemini: { available: true, consent: true } } });
  const result = spawnSync(process.execPath, [SELECT_CLI, root, '--operation', 'generate', '--provider', 'Gemini'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'provider: gemini\nreason: requested\nneeds-consent: no\nexit: 0\n');
});
