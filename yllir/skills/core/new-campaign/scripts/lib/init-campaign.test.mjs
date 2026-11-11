import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initCampaign } from './init-campaign.mjs';
import { parseYamlLite } from '../../../../../scripts/lib/yaml-lite.mjs';
import { validateConfig } from '../../../../../scripts/lib/config.mjs';
import { stripExitLine } from '../../../../../scripts/lib/cli-exit.mjs';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'init-campaign.mjs');

const created = [];
after(() => {
  for (const dir of created) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-init-'));
  created.push(dir);
  return dir;
}

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

const GOOD = {
  name: "Le isole d'ambra",
  language: 'it',
  register: 'plain',
  world: "Arcipelago d'Ambra",
  today: '2026-11-07',
};

test('creates a campaign in an empty folder with a git repository and no commit yet', () => {
  const dir = tmp();
  const result = initCampaign(dir, GOOD);
  assert.deepEqual(result.errors, []);
  assert.equal(result.slug, 'le-isole-d-ambra');
  for (const item of ['campaign.yaml', '.gitignore', 'CLAUDE.md', 'AGENTS.md', '.campaign/version.yaml', '.git']) {
    assert.ok(result.created.includes(item), `${item} is reported as created`);
  }
  for (const file of ['campaign.yaml', '.gitignore', 'CLAUDE.md', 'AGENTS.md', '.campaign/version.yaml']) {
    assert.ok(fs.existsSync(path.join(dir, file)), `${file} exists`);
  }
  assert.equal(git(dir, 'rev-parse', '--is-inside-work-tree'), 'true');
  assert.equal(git(dir, 'rev-list', '--all'), '');

  const config = parseYamlLite(fs.readFileSync(path.join(dir, 'campaign.yaml'), 'utf8')).data;
  assert.deepEqual(config, {
    schema: 1,
    campaign: {
      name: "Le isole d'ambra",
      slug: 'le-isole-d-ambra',
      world: "Arcipelago d'Ambra",
      created: '2026-11-07',
    },
    language: { main: 'it', other: [] },
    prose: { register: 'plain' },
    system: { adapter: 'none' },
  });

  const check = validateConfig(dir);
  assert.equal(check.ok, true);
  assert.deepEqual(
    check.warnings.map((warning) => warning.code),
    ['no-structure'],
  );
});

test('--adapter dnd-2024 is written to system.adapter and the campaign validates', () => {
  const dir = tmp();
  const result = initCampaign(dir, { ...GOOD, adapter: 'dnd-2024' });
  assert.deepEqual(result.errors, []);
  const config = parseYamlLite(fs.readFileSync(path.join(dir, 'campaign.yaml'), 'utf8')).data;
  assert.equal(config.system.adapter, 'dnd-2024');
  assert.deepEqual(validateConfig(dir).errors, []);
});

test('an adapter that is not installed is refused before anything is written', () => {
  const dir = tmp();
  const result = initCampaign(dir, { ...GOOD, adapter: 'non-installato' });
  assert.equal(result.errors[0].code, 'unknown-adapter');
  assert.deepEqual(result.created, []);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('optional world and description are left out when not given', () => {
  const dir = tmp();
  const result = initCampaign(dir, { name: 'Cenere', language: 'it', register: 'mixed', today: '2026-11-07' });
  assert.deepEqual(result.errors, []);
  const config = parseYamlLite(fs.readFileSync(path.join(dir, 'campaign.yaml'), 'utf8')).data;
  assert.equal(Object.hasOwn(config.campaign, 'world'), false);
  assert.equal(Object.hasOwn(config.campaign, 'description'), false);
});

test('--seed is written as campaign.seed without creating the seed file and never writes an imagination key', () => {
  const dir = tmp();
  const result = initCampaign(dir, { ...GOOD, seed: 'Seme del mondo.md' });
  assert.deepEqual(result.errors, []);
  const config = parseYamlLite(fs.readFileSync(path.join(dir, 'campaign.yaml'), 'utf8')).data;
  assert.equal(config.campaign.seed, 'Seme del mondo.md');
  assert.equal(Object.hasOwn(config, 'allow_model_imagination'), false);
  assert.equal(Object.hasOwn(config.campaign, 'description'), false);
  assert.equal(fs.existsSync(path.join(dir, 'Seme del mondo.md')), false);
});

test('a seed that points outside the campaign is refused and nothing is written', () => {
  const dir = tmp();
  const result = initCampaign(dir, { ...GOOD, seed: '../Seme.md' });
  assert.equal(result.errors[0].code, 'bad-input');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('an empty folder that holds only hidden entries is accepted', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.env-note'), 'x');
  const result = initCampaign(dir, GOOD);
  assert.deepEqual(result.errors, []);
});

test('a folder with a visible file is refused and left untouched', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'appunti.txt'), 'ciao\n');
  const result = initCampaign(dir, GOOD);
  assert.equal(result.errors[0].code, 'not-empty');
  assert.deepEqual(result.created, []);
  assert.equal(fs.existsSync(path.join(dir, 'campaign.yaml')), false);
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);
});

test('a folder that already holds a campaign is refused', () => {
  const dir = tmp();
  assert.deepEqual(initCampaign(dir, GOOD).errors, []);
  const before = fs.readFileSync(path.join(dir, 'campaign.yaml'));
  const again = initCampaign(dir, GOOD);
  assert.equal(again.errors[0].code, 'already-campaign');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'campaign.yaml')), before);
});

test('bad inputs are refused and nothing is written', () => {
  const dir = tmp();
  const cases = [
    [{ name: '' }, 'bad-input'],
    [{ name: '   ' }, 'bad-input'],
    [{ name: '!!! ???' }, 'bad-input'],
    [{ language: 'ITA' }, 'bad-input'],
    [{ language: 'italiano' }, 'bad-input'],
    [{ register: 'formal' }, 'bad-input'],
    [{ today: '2026-02-30' }, 'bad-input'],
    [{ world: 42 }, 'bad-input'],
  ];
  for (const [override, code] of cases) {
    const result = initCampaign(dir, { ...GOOD, ...override });
    assert.equal(result.errors[0].code, code, JSON.stringify(override));
    assert.equal(fs.existsSync(path.join(dir, 'campaign.yaml')), false, JSON.stringify(override));
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('without git the campaign.yaml written so far is removed and the error is no-git', () => {
  const dir = tmp();
  const emptyBin = tmp();
  const savedPath = process.env.PATH;
  process.env.PATH = emptyBin;
  let result;
  try {
    result = initCampaign(dir, GOOD);
  } finally {
    process.env.PATH = savedPath;
  }
  assert.equal(result.errors[0].code, 'no-git');
  assert.equal(fs.existsSync(path.join(dir, 'campaign.yaml')), false);
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);
});

test('init-campaign CLI prints JSON and uses exit codes 0, 1 and 2', () => {
  const dir = tmp();
  const args = [
    CLI,
    dir,
    '--name',
    "Le isole d'ambra",
    '--language',
    'it',
    '--register',
    'plain',
    '--world',
    "Arcipelago d'Ambra",
  ];
  const ok = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const result = JSON.parse(stripExitLine(ok.stdout));
  assert.deepEqual(result.errors, []);
  assert.equal(result.slug, 'le-isole-d-ambra');

  const again = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(again.status, 1);
  assert.equal(JSON.parse(stripExitLine(again.stdout)).errors[0].code, 'already-campaign');

  const usage = spawnSync(process.execPath, [CLI, tmp(), '--name', 'X', '--language', 'it'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: node init-campaign\.mjs/);
  assert.match(usage.stderr, /--adapter <id>/);
});

test('init-campaign CLI accepts --adapter and refuses an unknown adapter with exit 1', () => {
  const dir = tmp();
  const base = [CLI, dir, '--name', 'Cenere', '--language', 'it', '--register', 'plain'];
  const unknown = spawnSync(process.execPath, [...base, '--adapter', 'non-installato'], { encoding: 'utf8' });
  assert.equal(unknown.status, 1);
  assert.equal(JSON.parse(stripExitLine(unknown.stdout)).errors[0].code, 'unknown-adapter');
  assert.deepEqual(fs.readdirSync(dir), []);

  const ok = spawnSync(process.execPath, [...base, '--adapter', 'dnd-2024'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const config = parseYamlLite(fs.readFileSync(path.join(dir, 'campaign.yaml'), 'utf8')).data;
  assert.equal(config.system.adapter, 'dnd-2024');
});
