import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  atlasFolderFor, defaultSeed, ensureAtlasSetup, planAtlasSetup, defaultCanvasFor, DEFAULT_CANVAS, DEFAULT_URBAN_CANVAS,
} from './setup.mjs';
import { cleanupCampaigns, makeCampaign } from './test-support.mjs';

after(cleanupCampaigns);

/** A campaign.yaml that passes validateConfig, with the given language and categories. */
function validYaml(language, structure, { slug = 'test-campaign', modules = null } = {}) {
  const lines = [
    'schema: 1',
    'campaign:',
    '  name: "Test"',
    `  slug: ${slug}`,
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

const readYaml = (root) => fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8');

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

test('defaultSeed is the first 28 bits of sha256 of the slug, and the same every time', () => {
  const expected = parseInt(crypto.createHash('sha256').update('ceneri').digest('hex').slice(0, 7), 16);
  const config = { campaign: { slug: 'ceneri' } };
  assert.equal(defaultSeed(config, '/unused'), expected);
  assert.equal(defaultSeed(config, '/unused'), expected);
  assert.ok(expected >= 0 && expected < 2 ** 28);
});

test('defaultSeed falls back to the folder name when the campaign has no slug', () => {
  const expected = parseInt(crypto.createHash('sha256').update('my-folder').digest('hex').slice(0, 7), 16);
  assert.equal(defaultSeed({}, '/tmp/x/my-folder'), expected);
});

test('planAtlasSetup reads without writing: the folder a new category would get, and the seed', () => {
  const root = makeCampaign({}, { yaml: validYaml('it', PLACES) });
  const before = readYaml(root);
  const plan = planAtlasSetup(root);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.folder, 'Atlante');
  assert.equal(typeof plan.seed, 'number');
  assert.equal(readYaml(root), before);
});

test('ensureAtlasSetup adds the category and the module to a campaign that has neither', () => {
  const root = makeCampaign({}, { yaml: validYaml('en', PLACES) });
  const result = ensureAtlasSetup(root);
  assert.deepEqual(result, { ok: true, categoryAdded: true, moduleEnabled: true, errors: [] });
  const yaml = readYaml(root);
  assert.match(yaml, /folder: "?Atlas"?\n    type: atlas/);
  assert.match(yaml, /modules:\n  atlas: true/);
  assert.ok(fs.existsSync(path.join(root, 'Atlas')));
});

test('ensureAtlasSetup on a campaign that already has both changes nothing', () => {
  const root = makeCampaign({}, { yaml: validYaml('en', WITH_ATLAS, { modules: { atlas: true } }) });
  const before = readYaml(root);
  const result = ensureAtlasSetup(root);
  assert.deepEqual(result, { ok: true, categoryAdded: false, moduleEnabled: false, errors: [] });
  assert.equal(readYaml(root), before);
});

test('ensureAtlasSetup turns on an existing module that is off, without adding a category', () => {
  const root = makeCampaign({}, { yaml: validYaml('en', WITH_ATLAS, { modules: { atlas: false } }) });
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

test('ensureAtlasSetup refuses when the id atlas is already used by another category, and changes nothing', () => {
  const structure = [...PLACES, { id: 'atlas', folder: 'Mappe', type: 'free' }];
  const root = makeCampaign({}, { yaml: validYaml('en', structure) });
  fs.mkdirSync(path.join(root, 'Mappe'));
  const before = readYaml(root);
  const result = ensureAtlasSetup(root);
  assert.equal(result.ok, false);
  assert.equal(result.categoryAdded, false);
  assert.equal(readYaml(root), before);
});

test('defaultCanvasFor: the urban canvas for a settlement or district, the geographic one otherwise; a fresh copy', () => {
  assert.deepEqual(DEFAULT_URBAN_CANVAS, { width: 2400, height: 1800 });
  assert.deepEqual(defaultCanvasFor('settlement'), { width: 2400, height: 1800 });
  assert.deepEqual(defaultCanvasFor('district'), { width: 2400, height: 1800 });
  assert.deepEqual(defaultCanvasFor('region'), DEFAULT_CANVAS);
  assert.deepEqual(defaultCanvasFor(undefined), DEFAULT_CANVAS);
  const copy = defaultCanvasFor('settlement');
  copy.width = 1;
  assert.equal(defaultCanvasFor('settlement').width, 2400);
});
