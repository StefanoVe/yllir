import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { atlasFolderFor, ensureAtlasSetup, planAtlasSetup, DEFAULT_STYLE } from './setup.mjs';
import { cleanupCampaigns, makeCampaign } from './test-support.mjs';

after(cleanupCampaigns);

/** A campaign.yaml that passes validateConfig, with the given language, categories and modules. */
function validYaml(language, structure, { modules = null } = {}) {
  const lines = [
    'schema: 1',
    'campaign:',
    '  name: "Test"',
    '  slug: test-campaign',
    '  created: 2026-11-01',
    'language:',
    `  main: ${language}`,
    '  other: []',
    'prose:',
    '  register: plain',
    'system:',
    '  adapter: none',
    'structure:',
    ...structure.flatMap((c) => [`  - id: ${c.id}`, `    folder: ${c.folder}`, `    type: ${c.type}`]),
  ];
  if (modules !== null) lines.push('modules:', ...Object.entries(modules).map(([k, v]) => `  ${k}: ${v}`));
  return `${lines.join('\n')}\n`;
}

const PLACES = [{ id: 'luoghi', folder: 'World', type: 'places' }, { id: 'persone', folder: 'People', type: 'subjects' }];
const WITH_ATLAS = [...PLACES, { id: 'atlante', folder: 'Atlas', type: 'atlas' }];

/** A campaign whose World and People folders exist, so that campaign.yaml validates. */
const validCampaign = (yaml) => makeCampaign({ 'World/.keep': '', 'People/.keep': '' }, { yaml });

const readYaml = (root) => fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8');

test('DEFAULT_STYLE is fantasy-color', () => {
  assert.equal(DEFAULT_STYLE, 'fantasy-color');
});

test('atlasFolderFor: Atlante in Italian, Atlas otherwise, and a second name when the first one is taken', () => {
  assert.equal(atlasFolderFor({ language: { main: 'it' }, structure: [] }), 'Atlante');
  assert.equal(atlasFolderFor({ language: { main: 'en' }, structure: [] }), 'Atlas');
  assert.equal(atlasFolderFor({ structure: [] }), 'Atlas');
  assert.equal(
    atlasFolderFor({ language: { main: 'it' }, structure: [{ id: 'x', folder: 'Atlante', type: 'free' }] }),
    'Atlante della campagna',
  );
  assert.equal(
    atlasFolderFor({ language: { main: 'en' }, structure: [{ id: 'x', folder: 'Atlas', type: 'free' }] }),
    'Campaign atlas',
  );
});

test('planAtlasSetup reads without writing: the folder a new category would get, and no seed', () => {
  const root = validCampaign(validYaml('it', PLACES));
  const before = readYaml(root);
  const plan = planAtlasSetup(root);
  assert.deepEqual(plan, { folder: 'Atlante', errors: [] });
  assert.equal(readYaml(root), before);
});

test('planAtlasSetup reports the folder of an existing atlas category', () => {
  const root = validCampaign(validYaml('en', WITH_ATLAS));
  assert.deepEqual(planAtlasSetup(root), { folder: 'Atlas', errors: [] });
});

test('planAtlasSetup on a campaign without campaign.yaml reports the problem', () => {
  const root = validCampaign(validYaml('en', PLACES));
  fs.rmSync(path.join(root, 'campaign.yaml'));
  const plan = planAtlasSetup(root);
  assert.equal(plan.folder, null);
  assert.equal(plan.errors[0].code, 'missing-file');
});

test('ensureAtlasSetup adds the category and the module to a campaign that has neither', () => {
  const root = validCampaign(validYaml('en', PLACES));
  const result = ensureAtlasSetup(root);
  assert.deepEqual(result, { ok: true, categoryAdded: true, moduleEnabled: true, errors: [] });
  const yaml = readYaml(root);
  assert.match(yaml, /folder: "?Atlas"?\n    type: atlas/);
  assert.match(yaml, /modules:\n  atlas: true/);
  assert.ok(fs.existsSync(path.join(root, 'Atlas')), 'the atlas folder is created');
});

test('ensureAtlasSetup is idempotent: a second call changes nothing', () => {
  const root = validCampaign(validYaml('en', PLACES));
  ensureAtlasSetup(root);
  const once = readYaml(root);
  const second = ensureAtlasSetup(root);
  assert.deepEqual(second, { ok: true, categoryAdded: false, moduleEnabled: false, errors: [] });
  assert.equal(readYaml(root), once);
});

test('ensureAtlasSetup on a campaign that already has both changes nothing', () => {
  const root = validCampaign(validYaml('en', WITH_ATLAS, { modules: { atlas: true } }));
  const before = readYaml(root);
  const result = ensureAtlasSetup(root);
  assert.deepEqual(result, { ok: true, categoryAdded: false, moduleEnabled: false, errors: [] });
  assert.equal(readYaml(root), before);
});

test('ensureAtlasSetup turns on an existing module that is off, without adding a category', () => {
  const root = validCampaign(validYaml('en', WITH_ATLAS, { modules: { atlas: false } }));
  const result = ensureAtlasSetup(root);
  assert.equal(result.ok, true);
  assert.equal(result.categoryAdded, false);
  assert.equal(result.moduleEnabled, true);
  assert.match(readYaml(root), /modules:\n  atlas: true/);
});

test('ensureAtlasSetup refuses and leaves campaign.yaml as it was when the file is not valid YAML', () => {
  const root = makeCampaign({}, { yaml: 'schema: 1\nstructure:\n  - id: [broken\n' });
  const before = readYaml(root);
  const result = ensureAtlasSetup(root);
  assert.equal(result.ok, false);
  assert.equal(result.categoryAdded, false);
  assert.equal(result.errors[0].code, 'yaml');
  assert.equal(readYaml(root), before);
});

test('ensureAtlasSetup refuses when the id atlas is used by another category, and restores campaign.yaml', () => {
  const structure = [...PLACES, { id: 'atlas', folder: 'Mappe', type: 'free' }];
  const root = validCampaign(validYaml('en', structure));
  fs.mkdirSync(path.join(root, 'Mappe'));
  const before = readYaml(root);
  const result = ensureAtlasSetup(root);
  assert.equal(result.ok, false);
  assert.equal(result.categoryAdded, false);
  assert.equal(readYaml(root), before);
  assert.equal(fs.existsSync(path.join(root, 'Atlas')), false, 'no folder is created by a refused call');
});
