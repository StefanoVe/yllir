import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BUILTIN_IDS,
  PLACEHOLDERS,
  campaignProvidersDir,
  fillPlaceholders,
  findSecrets,
  loadCampaignProviders,
  readKey,
  validateCampaignProvider,
} from './campaign-providers.mjs';

const CLI = fileURLToPath(new URL('../provider-check.mjs', import.meta.url));
const roots = [];

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function newRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-campaign-providers-'));
  roots.push(root);
  return root;
}

/** Writes one provider folder and returns its path. */
function writeProvider(root, id, files) {
  const dir = path.join(campaignProvidersDir(root), id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text, 'utf8');
  }
  return dir;
}

function commandYaml({
  id = 'local-sd',
  command = ['"sd-cli"', '"--prompt"', '"{PROMPT}"', '"--out"', '"{OUTPUT}"'],
  added = '2026-11-11T10:00:00Z',
} = {}) {
  return [
    `id: ${id}`,
    'name: Local SD',
    'kind: command',
    'operations:',
    '  - generate',
    'command:',
    ...command.map((arg) => `  - ${arg}`),
    'probe:',
    '  - sd-cli',
    '  - --version',
    'external: true',
    `added: ${added}`,
  ].join('\n') + '\n';
}

function httpYaml({ id = 'example-image', keyEnv = 'EXAMPLE_API_KEY', added = '2026-11-11T10:00:00Z' } = {}) {
  const lines = [
    `id: ${id}`,
    'name: Example',
    'kind: http',
    'operations:',
    '  - generate',
  ];
  if (keyEnv !== null) lines.push(`key_env: ${keyEnv}`);
  lines.push('external: true', `added: ${added}`);
  return lines.join('\n') + '\n';
}

function httpRequest(overrides = {}) {
  return JSON.stringify({
    method: 'POST',
    url: 'https://example.com/v1/images',
    headers: { 'x-api-key': '{KEY}', 'content-type': 'application/json' },
    body: { prompt: '{PROMPT}' },
    response: { base64: 'data.image' },
    ...overrides,
  }, null, 2);
}

const LITERAL_GOOGLE_KEY = 'AIzaSy' + 'x'.repeat(34);

test('valid command provider is accepted', () => {
  const root = newRoot();
  writeProvider(root, 'local-sd', { 'provider.yaml': commandYaml() });
  const result = validateCampaignProvider(root, 'local-sd', {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.manifest.kind, 'command');
  assert.equal(result.manifest.external, true);
  assert.equal(result.manifest.timeout_seconds, 600);
  assert.deepEqual(result.manifest.operations, ['generate']);
});

test('command without {OUTPUT} is rejected', () => {
  const root = newRoot();
  writeProvider(root, 'local-sd', {
    'provider.yaml': commandYaml({ command: ['"sd-cli"', '"{PROMPT}"'] }),
  });
  const result = validateCampaignProvider(root, 'local-sd', {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('{OUTPUT}')), result.errors.join('\n'));
});

test('{KEY} in a command is rejected', () => {
  const root = newRoot();
  writeProvider(root, 'local-sd', {
    'provider.yaml': commandYaml({ command: ['"sd-cli"', '"--key"', '"{KEY}"', '"{OUTPUT}"'] }),
  });
  const result = validateCampaignProvider(root, 'local-sd', {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('{KEY}')), result.errors.join('\n'));
});

test('built-in id is rejected', () => {
  assert.deepEqual(BUILTIN_IDS, ['comfyui', 'codex', 'photoshop', 'upload']);
  const root = newRoot();
  writeProvider(root, 'codex', { 'provider.yaml': commandYaml({ id: 'codex' }) });
  const result = validateCampaignProvider(root, 'codex', {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('built-in')), result.errors.join('\n'));
});

test('id that differs from the folder name is rejected', () => {
  const root = newRoot();
  writeProvider(root, 'local-sd', { 'provider.yaml': commandYaml({ id: 'other-sd' }) });
  const result = validateCampaignProvider(root, 'local-sd', {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('folder name local-sd')), result.errors.join('\n'));
});

test('mcp provider without instructions.md is rejected, with it accepted', () => {
  const root = newRoot();
  const mcpYaml = [
    'id: gemini-mcp',
    'name: Gemini',
    'kind: mcp',
    'operations:',
    '  - generate',
    'tool: mcp__gemini__generate_image',
    'external: true',
    'added: 2026-11-11T10:00:00Z',
  ].join('\n') + '\n';
  writeProvider(root, 'gemini-mcp', { 'provider.yaml': mcpYaml });
  const missing = validateCampaignProvider(root, 'gemini-mcp', {});
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.includes('instructions.md')), missing.errors.join('\n'));

  writeProvider(root, 'gemini-mcp', { 'instructions.md': 'Call the tool with the prompt.\n' });
  const present = validateCampaignProvider(root, 'gemini-mcp', {});
  assert.equal(present.ok, true, present.errors.join('\n'));
  assert.equal(present.manifest.tool, 'mcp__gemini__generate_image');
});

test('valid http provider with key_env and {KEY} in a header is accepted', () => {
  const root = newRoot();
  writeProvider(root, 'example-image', {
    'provider.yaml': httpYaml(),
    'request.json': httpRequest(),
  });
  const result = validateCampaignProvider(root, 'example-image', { EXAMPLE_API_KEY: 'from-env-value' });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.manifest.key_env, 'EXAMPLE_API_KEY');
  assert.equal(result.manifest.request.method, 'POST');
});

test('literal Google-style key in request.json is rejected without echoing it', () => {
  const root = newRoot();
  writeProvider(root, 'example-image', {
    'provider.yaml': httpYaml(),
    'request.json': httpRequest({ headers: { 'x-api-key': '{KEY}', 'x-note': LITERAL_GOOGLE_KEY } }),
  });
  const result = validateCampaignProvider(root, 'example-image', {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('request.json') && e.includes('line')), result.errors.join('\n'));
  assert.ok(!result.errors.join('\n').includes(LITERAL_GOOGLE_KEY));
});

test('stored key value found in request.json is rejected without echoing it', () => {
  const root = newRoot();
  const stored = 'abc123secretvalue';
  fs.mkdirSync(path.join(root, '.campaign', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.campaign', 'state', 'keys.json'), JSON.stringify({ 'example-image': stored }));
  writeProvider(root, 'example-image', {
    'provider.yaml': httpYaml(),
    'request.json': httpRequest({ headers: { 'x-api-key': '{KEY}', 'x-copy': stored } }),
  });
  const result = validateCampaignProvider(root, 'example-image', {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('stored API key')), result.errors.join('\n'));
  assert.ok(!result.errors.join('\n').includes(stored));
});

test('readKey prefers the environment over keys.json, and falls back to keys.json', () => {
  const root = newRoot();
  fs.mkdirSync(path.join(root, '.campaign', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.campaign', 'state', 'keys.json'), JSON.stringify({ example: 'from-file' }));
  const manifest = { id: 'example', key_env: 'EXAMPLE_API_KEY' };
  assert.equal(readKey(root, manifest, { EXAMPLE_API_KEY: 'from-env' }), 'from-env');
  assert.equal(readKey(root, manifest, {}), 'from-file');
  assert.equal(readKey(root, { id: 'other', key_env: null }, {}), null);
});

test('findSecrets flags key-like text but not Bearer {KEY}', () => {
  assert.deepEqual(findSecrets('"Authorization": "Bearer {KEY}"'), []);
  const found = findSecrets(`first line\nkey: ${LITERAL_GOOGLE_KEY}`);
  assert.ok(found.length >= 1);
  assert.ok(found.includes('line 2: looks like an API key'));
  assert.ok(found.every((text) => text.startsWith('line 2: ')));
  assert.ok(!found.join('\n').includes(LITERAL_GOOGLE_KEY));
});

test('findSecrets ignores official URLs and long paths', () => {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';
  assert.deepEqual(findSecrets(url), []);
  const path = '/Users/someone/Library/Application Support/very-long-folder-name-here/bin/tool';
  assert.deepEqual(findSecrets(path), []);
});

test('findSecrets flags a random mixed 40-char token', () => {
  const token = 'Zq81kLmP0aXr7Tt2Bv9cNd4Ew6Fy3Gh5Jk1Lm8Qp';
  assert.equal(token.length, 40);
  const found = findSecrets(`value ${token} end`);
  assert.deepEqual(found, ['line 1: looks like a long secret string']);
  assert.ok(!found.join('\n').includes(token));
});

test('loadCampaignProviders sorts newest first and reports invalid ones', () => {
  const root = newRoot();
  writeProvider(root, 'a-old', { 'provider.yaml': commandYaml({ id: 'a-old', added: '2026-01-01T00:00:00Z' }) });
  writeProvider(root, 'b-new', { 'provider.yaml': commandYaml({ id: 'b-new', added: '2026-11-11T10:00:00Z' }) });
  writeProvider(root, 'c-bad', {
    'provider.yaml': commandYaml({ id: 'c-bad', command: ['"sd"', '"{PROMPT}"'] }),
  });
  const loaded = loadCampaignProviders(root, {});
  assert.deepEqual(loaded.providers.map((p) => p.id), ['b-new', 'a-old']);
  assert.equal(loaded.errors.length, 1);
  assert.equal(loaded.errors[0].id, 'c-bad');
  assert.ok(loaded.errors[0].errors.length > 0);
});

test('loadCampaignProviders gives empty lists when the folder is missing', () => {
  const root = newRoot();
  assert.deepEqual(loadCampaignProviders(root, {}), { providers: [], errors: [] });
});

test('fillPlaceholders replaces known names once and leaves the rest', () => {
  assert.equal(
    fillPlaceholders('run {PROMPT} into {OUTPUT} {UNKNOWN}', { PROMPT: 'a cat', OUTPUT: '/x/y.png' }),
    'run a cat into /x/y.png {UNKNOWN}',
  );
  assert.equal(fillPlaceholders('{PROMPT} {PROMPT}', { PROMPT: 'cat' }), 'cat cat');
  assert.equal(fillPlaceholders('{PROMPT}', { PROMPT: '{OUTPUT}', OUTPUT: 'x' }), '{OUTPUT}');
  assert.ok(PLACEHOLDERS.includes('KEY'));
});

test('CLI exits 0 for a valid provider, 1 for an invalid one, 2 on usage error', () => {
  const root = newRoot();
  writeProvider(root, 'local-sd', { 'provider.yaml': commandYaml() });
  writeProvider(root, 'broken', { 'provider.yaml': commandYaml({ id: 'broken', command: ['"sd"'] }) });

  const ok = spawnSync(process.execPath, [CLI, root, 'local-sd'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /provider: local-sd/);
  assert.match(ok.stdout, /kind: command/);
  assert.match(ok.stdout, /result: ok/);

  const invalid = spawnSync(process.execPath, [CLI, root, 'broken'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.match(invalid.stdout, /^error: /m);
  assert.match(invalid.stdout, /result: invalid/);

  const usage = spawnSync(process.execPath, [CLI, root], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: node provider-check\.mjs/);
});
