// Tests of the image-select command line for the bake operation. The probe table is
// written by hand, so no Codex is run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeTable } from './lib/providers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELECT_CLI = path.join(HERE, 'image-select.mjs');

function tempCampaign() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-select-bake-'));
}

function select(root, ...extra) {
  return spawnSync(process.execPath, [SELECT_CLI, root, ...extra], { encoding: 'utf8' });
}

test('bake: codex is chosen and needs consent until the master gives it', () => {
  const root = tempCampaign();
  writeTable(root, { providers: { codex: { available: true } } });

  const asked = select(root, '--operation', 'bake');
  assert.equal(asked.status, 0);
  assert.equal(asked.stdout, 'provider: codex\nreason: automatic\nneeds-consent: yes\nexit: 0\n');

  const recorded = select(root, '--consent', 'codex');
  assert.equal(recorded.status, 0);
  assert.equal(recorded.stdout, 'consent: codex\nexit: 0\n');

  const chosen = select(root, '--operation', 'bake');
  assert.equal(chosen.stdout, 'provider: codex\nreason: automatic\nneeds-consent: no\nexit: 0\n');
});

test('bake: no codex in the probe table means no provider', () => {
  const root = tempCampaign();
  writeTable(root, { providers: { codex: { available: false, reason: 'not-installed' } } });

  const result = select(root, '--operation', 'bake');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'provider: none\nreason: none-available\nneeds-consent: no\nexit: 1\n');
});

test('bake: a requested provider that does not list bake is unsupported', () => {
  const root = tempCampaign();
  writeTable(root, { providers: { comfyui: { available: true }, codex: { available: true, consent: true } } });

  const result = select(root, '--operation', 'bake', '--provider', 'comfyui');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'provider: none\nreason: requested-unsupported\nneeds-consent: no\nexit: 1\n');
});

test('bake: the requested codex is chosen with its consent', () => {
  const root = tempCampaign();
  writeTable(root, { providers: { codex: { available: true, consent: true } } });

  const result = select(root, '--operation', 'bake', '--provider', 'codex');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'provider: codex\nreason: requested\nneeds-consent: no\nexit: 0\n');
});
