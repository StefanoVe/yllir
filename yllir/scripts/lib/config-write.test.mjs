import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlLite } from './yaml-lite.mjs';
import { stringifyConfig, addCategory } from './config-write.mjs';
import { validateConfig } from './config.mjs';
import { stripExitLine } from './cli-exit.mjs';

// Git is never needed here, but keep the test independent of the user's git setup.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../../../testbench/fixtures/morvalle/campaign/campaign.yaml');
const CLI = path.join(here, '..', 'add-category.mjs');

const created = [];
after(() => {
  for (const dir of created) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-cfg-'));
  created.push(dir);
  return dir;
}

function parse(text) {
  const result = parseYamlLite(text);
  assert.deepEqual(result.errors, []);
  return result.data;
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

// ---------------------------------------------------------------- stringifyConfig

test('the morvalle fixture survives a write and a read', () => {
  const original = parse(fs.readFileSync(FIXTURE, 'utf8'));
  const text = stringifyConfig(original);
  assert.deepEqual(parse(text), original);
});

test('awkward strings, dates, booleans and empty collections round-trip', () => {
  const config = {
    schema: 1,
    campaign: {
      name: `Le "ceneri" dell'isola «prova»`,
      slug: 'ceneri-isola',
      world: 'Mondo: #1 [bozza], con virgola',
      description: "Una riga con 'apici' e # nel testo",
      created: '2026-11-07',
    },
    language: { main: 'it', other: ['en'] },
    prose: { register: 'plain', session_format: '' },
    system: { adapter: 'none', options: {} },
    structure: [
      { id: 'trama', folder: 'Trama', type: 'plot' },
      { id: 'note', folder: "Nota 'x'", type: 'notes', cards: false },
    ],
    modules: { print: true, music: false },
    audit: {
      exclusions: [
        {
          subject: 'lago',
          attribute: 'number.depth',
          values: ['30', 40],
          reason: 'Il master: "va bene" così',
          date: '2026-11-07',
        },
      ],
    },
    extra: { empty_list: [], nested: { value: 'true', n: -3, nul: null, zero: 0 } },
  };
  const text = stringifyConfig(config);
  assert.deepEqual(parse(text), config);
});

test('dates, booleans, numbers and empty values are written in the expected form', () => {
  const text = stringifyConfig({
    campaign: { created: '2026-11-07', name: 'Prova' },
    modules: { print: true },
    audit: { exclusions: [{ values: ['30'], tags: [] , meta: {} }] },
    language: { main: 'it' },
  });
  assert.match(text, /^campaign:\n/m);
  assert.match(text, /^  created: "2026-11-07"$/m);
  assert.match(text, /^  print: true$/m);
  assert.match(text, /values: \["30"\]/);
  assert.match(text, /tags: \[\]/);
  assert.match(text, /meta: \{\}/);
  assert.match(text, /\n$/);
});

test('top-level keys follow the canonical order, then the others alphabetically', () => {
  const text = stringifyConfig({
    zeta: 1,
    audit: {},
    alpha: 2,
    schema: 1,
    campaign: {},
    structure: [],
  });
  const topKeys = text.split('\n').filter((line) => /^[a-z]/.test(line)).map((line) => line.split(':')[0]);
  assert.deepEqual(topKeys, ['schema', 'campaign', 'structure', 'audit', 'alpha', 'zeta']);
});

test('values that cannot be read back are refused', () => {
  assert.throws(() => stringifyConfig({ campaign: { name: 'a\nb' } }), TypeError);
  assert.throws(() => stringifyConfig({ campaign: { ratio: 0.5 } }), TypeError);
  assert.throws(() => stringifyConfig({ 'Bad Key': 1 }), TypeError);
  assert.throws(() => stringifyConfig(['not', 'a', 'mapping']), TypeError);
});

// ---------------------------------------------------------------- addCategory

test('addCategory adds the category, creates its folder and regenerates the instructions', () => {
  const dir = campaignWith();
  const result = addCategory(dir, { id: 'mondo', folder: 'Mondo', type: 'places' });
  assert.deepEqual(result, { added: true, errors: [] });
  assert.ok(fs.statSync(path.join(dir, 'Mondo')).isDirectory());
  const config = parse(fs.readFileSync(path.join(dir, 'campaign.yaml'), 'utf8'));
  assert.deepEqual(config.structure, [{ id: 'mondo', folder: 'Mondo', type: 'places' }]);
  assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(dir, '.campaign', 'instructions', 'agent.md')));
  assert.deepEqual(validateConfig(dir).errors, []);
});

test('addCategory keeps the existing settings and appends to a list that exists', () => {
  const dir = campaignWith(MINIMAL + 'structure:\n  - id: trama\n    folder: Trama\n    type: plot\n');
  fs.mkdirSync(path.join(dir, 'Trama'));
  assert.deepEqual(addCategory(dir, { id: 'mondo', folder: 'Mondo', type: 'places' }), { added: true, errors: [] });
  const config = parse(fs.readFileSync(path.join(dir, 'campaign.yaml'), 'utf8'));
  assert.equal(config.campaign.name, 'Le ceneri della valle');
  assert.deepEqual(
    config.structure.map((entry) => entry.id),
    ['trama', 'mondo'],
  );
});

test('addCategory is idempotent for the same id, folder and type', () => {
  const dir = campaignWith();
  addCategory(dir, { id: 'mondo', folder: 'Mondo', type: 'places' });
  const before = fs.readFileSync(path.join(dir, 'campaign.yaml'));
  assert.deepEqual(addCategory(dir, { id: 'mondo', folder: 'Mondo', type: 'places' }), { added: false, errors: [] });
  assert.deepEqual(fs.readFileSync(path.join(dir, 'campaign.yaml')), before);
});

test('addCategory refuses a clash on id or folder and changes nothing', () => {
  const dir = campaignWith();
  addCategory(dir, { id: 'mondo', folder: 'Mondo', type: 'places' });
  const before = fs.readFileSync(path.join(dir, 'campaign.yaml'));

  const sameIdOtherFolder = addCategory(dir, { id: 'mondo', folder: 'Luoghi', type: 'places' });
  assert.equal(sameIdOtherFolder.added, false);
  assert.equal(sameIdOtherFolder.errors[0].code, 'category-conflict');

  const sameIdOtherType = addCategory(dir, { id: 'mondo', folder: 'Mondo', type: 'subjects' });
  assert.equal(sameIdOtherType.errors[0].code, 'category-conflict');

  const sameFolderOtherId = addCategory(dir, { id: 'luoghi', folder: 'Mondo', type: 'places' });
  assert.equal(sameFolderOtherId.errors[0].code, 'category-conflict');

  assert.deepEqual(fs.readFileSync(path.join(dir, 'campaign.yaml')), before);
  assert.equal(fs.existsSync(path.join(dir, 'Luoghi')), false);
});

test('addCategory restores the file and removes the folders it created when validation fails', () => {
  const dir = campaignWith();
  const before = fs.readFileSync(path.join(dir, 'campaign.yaml'));
  const result = addCategory(dir, { id: 'mondo', folder: 'Luoghi/Mondo', type: 'bogus' });
  assert.equal(result.added, false);
  assert.ok(result.errors.some((error) => error.code === 'bad-value'));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'campaign.yaml')), before);
  assert.equal(fs.existsSync(path.join(dir, 'Luoghi')), false);
});

test('addCategory keeps a folder that already existed when validation fails', () => {
  const dir = campaignWith();
  fs.mkdirSync(path.join(dir, 'Mondo'));
  fs.writeFileSync(path.join(dir, 'Mondo', 'lago.md'), 'testo\n');
  const result = addCategory(dir, { id: 'mondo', folder: 'Mondo', type: 'bogus' });
  assert.equal(result.added, false);
  assert.equal(fs.readFileSync(path.join(dir, 'Mondo', 'lago.md'), 'utf8'), 'testo\n');
});

test('addCategory reports a campaign.yaml that does not parse and leaves it alone', () => {
  const dir = campaignWith('schema: 1\n  broken: [\n');
  const before = fs.readFileSync(path.join(dir, 'campaign.yaml'));
  const result = addCategory(dir, { id: 'mondo', folder: 'Mondo', type: 'places' });
  assert.equal(result.added, false);
  assert.equal(result.errors[0].code, 'yaml');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'campaign.yaml')), before);
  assert.equal(fs.existsSync(path.join(dir, 'Mondo')), false);
});

test('addCategory refuses folders outside the campaign and bad ids before writing', () => {
  const dir = campaignWith();
  const before = fs.readFileSync(path.join(dir, 'campaign.yaml'));
  const outside = path.join(path.dirname(dir), `${path.basename(dir)}-escape`);
  created.push(outside);
  for (const folder of ['../escape', '/tmp/escape', '.campaign', '.git/x', 'a\\b', '']) {
    const result = addCategory(dir, { id: 'mondo', folder, type: 'places' });
    assert.equal(result.errors[0].code, 'bad-input', `folder ${JSON.stringify(folder)}`);
  }
  assert.equal(addCategory(dir, { id: 'Mondo Grande', folder: 'Mondo', type: 'places' }).errors[0].code, 'bad-input');
  assert.equal(fs.existsSync(outside), false);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'campaign.yaml')), before);
});

// ---------------------------------------------------------------- addCategory with a source

test('an external category with a source becomes a symbolic link to that folder', () => {
  const dir = campaignWith();
  const source = tmp();
  fs.writeFileSync(path.join(source, 'lago.md'), 'testo\n');
  const result = addCategory(dir, { id: 'fonti', folder: 'Fonti', type: 'external', source });
  assert.deepEqual(result, { added: true, errors: [] });
  assert.ok(fs.lstatSync(path.join(dir, 'Fonti')).isSymbolicLink());
  assert.equal(fs.readlinkSync(path.join(dir, 'Fonti')), source);
  assert.equal(fs.readFileSync(path.join(dir, 'Fonti', 'lago.md'), 'utf8'), 'testo\n');
  assert.deepEqual(validateConfig(dir).errors, []);
  const config = parse(fs.readFileSync(path.join(dir, 'campaign.yaml'), 'utf8'));
  assert.deepEqual(config.structure, [{ id: 'fonti', folder: 'Fonti', type: 'external' }]);
});

test('an external category without a source keeps a real folder', () => {
  const dir = campaignWith();
  assert.deepEqual(addCategory(dir, { id: 'fonti', folder: 'Fonti', type: 'external' }), { added: true, errors: [] });
  assert.ok(fs.lstatSync(path.join(dir, 'Fonti')).isDirectory());
  assert.equal(fs.lstatSync(path.join(dir, 'Fonti')).isSymbolicLink(), false);
});

test('a source that is missing or not absolute is refused and nothing is written', () => {
  const dir = campaignWith();
  const before = fs.readFileSync(path.join(dir, 'campaign.yaml'));
  const missing = path.join(tmp(), 'assente');
  const missingResult = addCategory(dir, { id: 'fonti', folder: 'Fonti', type: 'external', source: missing });
  assert.equal(missingResult.added, false);
  assert.equal(missingResult.errors[0].code, 'bad-input');
  assert.equal(fs.existsSync(path.join(dir, 'Fonti')), false);

  const relative = addCategory(dir, { id: 'fonti', folder: 'Fonti', type: 'external', source: 'relativa' });
  assert.equal(relative.errors[0].code, 'bad-input');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'campaign.yaml')), before);
});

test('a source on a category that is not of type external is refused', () => {
  const dir = campaignWith();
  const before = fs.readFileSync(path.join(dir, 'campaign.yaml'));
  const result = addCategory(dir, { id: 'note', folder: 'Note', type: 'notes', source: tmp() });
  assert.equal(result.added, false);
  assert.equal(result.errors[0].code, 'bad-input');
  assert.equal(fs.existsSync(path.join(dir, 'Note')), false);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'campaign.yaml')), before);
});

test('a source is refused when the category folder already exists', () => {
  const dir = campaignWith();
  fs.mkdirSync(path.join(dir, 'Fonti'));
  const result = addCategory(dir, { id: 'fonti', folder: 'Fonti', type: 'external', source: tmp() });
  assert.equal(result.errors[0].code, 'category-conflict');
  assert.ok(fs.lstatSync(path.join(dir, 'Fonti')).isDirectory());
});

test('rollback removes the symbolic link and never deletes the files of the source', () => {
  // A category that already in the file does not validate, so the new one is rolled back.
  const dir = campaignWith(MINIMAL + 'structure:\n  - id: trama\n    folder: Trama\n    type: bogus\n');
  fs.mkdirSync(path.join(dir, 'Trama'));
  const before = fs.readFileSync(path.join(dir, 'campaign.yaml'));
  const source = tmp();
  fs.writeFileSync(path.join(source, 'lago.md'), 'testo\n');

  const result = addCategory(dir, { id: 'fonti', folder: 'Fonti', type: 'external', source });
  assert.equal(result.added, false);
  assert.ok(result.errors.length > 0);
  assert.throws(() => fs.lstatSync(path.join(dir, 'Fonti')), { code: 'ENOENT' });
  assert.deepEqual(fs.readFileSync(path.join(dir, 'campaign.yaml')), before);
  assert.equal(fs.readFileSync(path.join(source, 'lago.md'), 'utf8'), 'testo\n');
});

// ---------------------------------------------------------------- CLI

test('add-category CLI prints JSON and uses exit codes 0, 1 and 2', () => {
  const dir = campaignWith();
  const ok = spawnSync(process.execPath, [CLI, dir, '--id', 'mondo', '--folder', 'Mondo', '--type', 'places'], {
    encoding: 'utf8',
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(stripExitLine(ok.stdout)), { added: true, errors: [] });

  const bad = spawnSync(process.execPath, [CLI, dir, '--id', 'luoghi', '--folder', 'Luoghi', '--type', 'bogus'], {
    encoding: 'utf8',
  });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(stripExitLine(bad.stdout)).added, false);

  const usage = spawnSync(process.execPath, [CLI, dir, '--id', 'mondo', '--folder', 'Mondo'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: node add-category\.mjs/);
});

test('a top-level allow_model_imagination is written and reads back as null, true or false', () => {
  for (const value of [null, true, false]) {
    const config = parse(MINIMAL);
    config.allow_model_imagination = value;
    const text = stringifyConfig(config);
    assert.match(text, new RegExp(`^allow_model_imagination: ${value === null ? 'null' : String(value)}$`, 'm'));
    assert.deepEqual(parse(text), config);
    assert.deepEqual(validateConfig(campaignWith(text)).errors, []);
  }
});

test('workflow.auto_item_images is written under workflow and reads back', () => {
  const config = parse(MINIMAL);
  config.workflow = { auto_item_images: false };
  const text = stringifyConfig(config);
  assert.match(text, /^workflow:\n  auto_item_images: false$/m);
  assert.deepEqual(parse(text), config);
});

test('workflow is written right after modules and reads back', () => {
  const config = parse(MINIMAL);
  config.modules = { print: false };
  config.workflow = { auto_accept: true };
  const text = stringifyConfig(config);
  const topKeys = text.split('\n').filter((line) => /^[a-z]/.test(line)).map((line) => line.split(':')[0]);
  assert.deepEqual(topKeys.slice(topKeys.indexOf('modules'), topKeys.indexOf('modules') + 2), ['modules', 'workflow']);
  assert.match(text, /^workflow:\n  auto_accept: true$/m);
  assert.deepEqual(parse(text), config);
});
