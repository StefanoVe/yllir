import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { validateConfig } from '../../../../../scripts/lib/config.mjs';
import { stripExitLine } from '../../../../../scripts/lib/cli-exit.mjs';
import { listInstalledAdapters, setSystemAdapter } from './set-system.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'set-system.mjs');

const created = [];
after(() => {
  for (const dir of created) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-system-'));
  created.push(dir);
  return dir;
}

const MINIMAL = [
  'schema: 1',
  '',
  'campaign:',
  '  name: "Le ceneri della valle"',
  '  slug: ceneri-della-valle',
  '  created: 2026-11-07',
  '',
  'language:',
  '  main: it',
  '  other: []',
  '',
  'prose:',
  '  register: plain',
  '',
  'system:',
  '  adapter: none',
  '',
].join('\n');

function campaignWith(text = MINIMAL) {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'campaign.yaml'), text);
  return dir;
}

function readConfig(dir) {
  const parsed = parseYamlLite(fs.readFileSync(path.join(dir, 'campaign.yaml'), 'utf8'));
  assert.deepEqual(parsed.errors, []);
  return parsed.data;
}

test('listInstalledAdapters returns the id and name of each installed adapter', () => {
  const adapters = listInstalledAdapters();
  assert.deepEqual(
    adapters.find((adapter) => adapter.id === 'dnd-2024'),
    { id: 'dnd-2024', name: 'D&D 2024' },
  );
});

test('setting dnd-2024 writes system.adapter, keeps the other keys and regenerates the instructions', () => {
  const dir = campaignWith();
  const instructions = path.join(dir, '.campaign', 'instructions', 'agent.md');
  fs.mkdirSync(path.dirname(instructions), { recursive: true });
  fs.writeFileSync(instructions, 'stale\n');

  const result = setSystemAdapter(dir, 'dnd-2024');
  assert.deepEqual(result, { changed: true, adapter: 'dnd-2024', errors: [] });

  const config = readConfig(dir);
  assert.equal(config.system.adapter, 'dnd-2024');
  assert.equal(config.campaign.name, 'Le ceneri della valle');
  assert.deepEqual(config.language, { main: 'it', other: [] });
  assert.deepEqual(validateConfig(dir).errors, []);
  assert.notEqual(fs.readFileSync(instructions, 'utf8'), 'stale\n');
});

test('an unknown adapter restores the campaign.yaml bytes exactly', () => {
  const dir = campaignWith();
  const before = fs.readFileSync(path.join(dir, 'campaign.yaml'));
  const result = setSystemAdapter(dir, 'non-installato');
  assert.equal(result.changed, false);
  assert.equal(result.errors[0].code, 'unknown-adapter');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'campaign.yaml')), before);
});

test('setting the adapter it already has changes nothing', () => {
  const dir = campaignWith();
  const before = fs.readFileSync(path.join(dir, 'campaign.yaml'));
  assert.deepEqual(setSystemAdapter(dir, 'none'), { changed: false, adapter: 'none', errors: [] });
  assert.deepEqual(fs.readFileSync(path.join(dir, 'campaign.yaml')), before);
});

test('none is allowed again after dnd-2024', () => {
  const dir = campaignWith();
  setSystemAdapter(dir, 'dnd-2024');
  assert.deepEqual(setSystemAdapter(dir, 'none'), { changed: true, adapter: 'none', errors: [] });
  assert.equal(readConfig(dir).system.adapter, 'none');
});

test('a missing campaign.yaml is refused', () => {
  const dir = tmp();
  const result = setSystemAdapter(dir, 'dnd-2024');
  assert.equal(result.changed, false);
  assert.equal(result.errors[0].code, 'missing-file');
  assert.equal(fs.existsSync(path.join(dir, 'campaign.yaml')), false);
});

test('CLI --list prints the installed adapters and needs no campaign.yaml', () => {
  const dir = tmp();
  const result = spawnSync(process.execPath, [CLI, dir, '--list'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const adapters = JSON.parse(stripExitLine(result.stdout)).adapters;
  assert.ok(adapters.some((adapter) => adapter.id === 'dnd-2024' && adapter.name === 'D&D 2024'));
});

test('CLI --adapter exits 0 on success, 1 on refusal and 2 on usage errors', () => {
  const dir = campaignWith();
  const ok = spawnSync(process.execPath, [CLI, dir, '--adapter', 'dnd-2024'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(stripExitLine(ok.stdout)), { changed: true, adapter: 'dnd-2024', errors: [] });

  const bad = spawnSync(process.execPath, [CLI, dir, '--adapter', 'non-installato'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(stripExitLine(bad.stdout)).errors[0].code, 'unknown-adapter');

  const noMode = spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' });
  assert.equal(noMode.status, 2);
  assert.match(noMode.stderr, /usage: node set-system\.mjs/);

  const both = spawnSync(process.execPath, [CLI, dir, '--list', '--adapter', 'none'], { encoding: 'utf8' });
  assert.equal(both.status, 2);
});
