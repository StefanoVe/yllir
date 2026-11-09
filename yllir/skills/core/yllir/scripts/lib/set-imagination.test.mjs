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
import { setModelImagination } from './set-imagination.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'set-imagination.mjs');

const created = [];
after(() => {
  for (const dir of created) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-imagination-'));
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

const WITH_STRUCTURE = [
  MINIMAL,
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '  - id: oggetti',
  '    folder: Oggetti',
  '    type: objects',
  '    cards: true',
  '',
  'modules:',
  '  print: false',
  '',
  'audit:',
  '  exclusions:',
  '    - subject: lago-grigio',
  '      attribute: number.depth',
  '      values: ["30"]',
  '      reason: "Il master: «va bene così»."',
  '      date: 2026-11-07',
  '',
].join('\n');

function campaignWith(text = MINIMAL, folders = []) {
  const dir = tmp();
  for (const folder of folders) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }
  if (text !== null) {
    fs.writeFileSync(path.join(dir, 'campaign.yaml'), text);
  }
  return dir;
}

function readConfig(dir) {
  const parsed = parseYamlLite(fs.readFileSync(path.join(dir, 'campaign.yaml'), 'utf8'));
  assert.deepEqual(parsed.errors, []);
  return parsed.data;
}

function bytesOf(dir) {
  return fs.readFileSync(path.join(dir, 'campaign.yaml'));
}

test('setting true writes the key, keeps the other keys and regenerates the instructions', () => {
  const dir = campaignWith();
  const instructions = path.join(dir, '.campaign', 'instructions', 'agent.md');
  fs.mkdirSync(path.dirname(instructions), { recursive: true });
  fs.writeFileSync(instructions, 'stale\n');

  assert.deepEqual(setModelImagination(dir, true), { changed: true, value: true, errors: [] });

  const config = readConfig(dir);
  assert.equal(config.allow_model_imagination, true);
  assert.equal(config.campaign.name, 'Le ceneri della valle');
  assert.deepEqual(config.language, { main: 'it', other: [] });
  assert.deepEqual(validateConfig(dir).errors, []);
  assert.notEqual(fs.readFileSync(instructions, 'utf8'), 'stale\n');
});

test('setting false and then null writes those values', () => {
  const dir = campaignWith();
  assert.deepEqual(setModelImagination(dir, false), { changed: true, value: false, errors: [] });
  assert.equal(readConfig(dir).allow_model_imagination, false);
  assert.deepEqual(setModelImagination(dir, null), { changed: true, value: null, errors: [] });
  assert.equal(readConfig(dir).allow_model_imagination, null);
  assert.deepEqual(validateConfig(dir).errors, []);
});

test('an invalid stored value such as "yes" is replaced by the value given', () => {
  const dir = campaignWith(`${MINIMAL}allow_model_imagination: "yes"\n`);
  assert.deepEqual(setModelImagination(dir, true), { changed: true, value: true, errors: [] });
  assert.equal(readConfig(dir).allow_model_imagination, true);
});

test('structure, modules and audit survive the change unchanged', () => {
  const dir = campaignWith(WITH_STRUCTURE, ['Trama', 'Oggetti']);
  const before = readConfig(dir);
  assert.deepEqual(setModelImagination(dir, true), { changed: true, value: true, errors: [] });
  const after = readConfig(dir);
  assert.equal(after.allow_model_imagination, true);
  delete after.allow_model_imagination;
  assert.deepEqual(after, before);
  assert.deepEqual(validateConfig(dir).errors, []);
});

test('setting the value it already has changes nothing, and an absent key counts as null', () => {
  const dir = campaignWith();
  const before = bytesOf(dir);
  assert.deepEqual(setModelImagination(dir, null), { changed: false, value: null, errors: [] });
  assert.deepEqual(bytesOf(dir), before);

  setModelImagination(dir, true);
  const withTrue = bytesOf(dir);
  assert.deepEqual(setModelImagination(dir, true), { changed: false, value: true, errors: [] });
  assert.deepEqual(bytesOf(dir), withTrue);
});

test('a missing campaign.yaml is refused and nothing is created', () => {
  const dir = campaignWith(null);
  const result = setModelImagination(dir, true);
  assert.equal(result.changed, false);
  assert.equal(result.errors[0].code, 'missing-file');
  assert.equal(fs.existsSync(path.join(dir, 'campaign.yaml')), false);
});

test('a campaign.yaml that is not valid YAML is refused and left as it was', () => {
  const dir = campaignWith(`${MINIMAL}\tbroken: x\n`);
  const before = bytesOf(dir);
  const result = setModelImagination(dir, true);
  assert.equal(result.changed, false);
  assert.equal(result.errors[0].code, 'yaml');
  assert.deepEqual(bytesOf(dir), before);
});

test('a value other than true, false or null is refused and nothing is written', () => {
  const dir = campaignWith();
  const before = bytesOf(dir);
  const result = setModelImagination(dir, 'yes');
  assert.equal(result.changed, false);
  assert.equal(result.errors[0].code, 'bad-input');
  assert.deepEqual(bytesOf(dir), before);
});

test('when the new config does not validate, the previous bytes are restored', () => {
  // The declared folder Trama does not exist, so the config is invalid before and after.
  const dir = campaignWith(`${MINIMAL}structure:\n  - id: trama\n    folder: Trama\n    type: plot\n`);
  const before = bytesOf(dir);
  const result = setModelImagination(dir, true);
  assert.equal(result.changed, false);
  assert.deepEqual(result.errors.map((error) => error.code), ['missing-folder']);
  assert.deepEqual(bytesOf(dir), before);
});

test('CLI --value exits 0 on success, 1 on refusal and 2 on usage errors', () => {
  const dir = campaignWith();
  const ok = spawnSync(process.execPath, [CLI, dir, '--value', 'true'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(stripExitLine(ok.stdout)), { changed: true, value: true, errors: [] });

  const empty = tmp();
  const missing = spawnSync(process.execPath, [CLI, empty, '--value', 'false'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(stripExitLine(missing.stdout)).errors[0].code, 'missing-file');

  const usage = [
    [dir, '--value', 'yes'],
    [dir, '--value'],
    [dir],
    [dir, '--value', 'true', '--value', 'false'],
    [dir, '--value', 'null', '--mode', 'x'],
  ];
  for (const args of usage) {
    const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /usage: node set-imagination\.mjs/);
  }

  const nullValue = spawnSync(process.execPath, [CLI, dir, '--value', 'null'], { encoding: 'utf8' });
  assert.equal(nullValue.status, 0, nullValue.stderr);
  assert.equal(readConfig(dir).allow_model_imagination, null);
});
