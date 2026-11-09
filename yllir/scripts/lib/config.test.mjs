import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../../../testbench/fixtures/morvalle/campaign');

const created = [];
after(() => {
  for (const dir of created) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const lines = (...rows) => rows.join('\n');

const MINIMAL = lines(
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
);

const FULL = lines(
  'schema: 1',
  '',
  'campaign:',
  '  name: "Le ceneri della valle"',
  '  slug: ceneri-della-valle',
  '  world: Calvane',
  '  description: "Una valle coperta di cenere."',
  '  created: 2026-11-07',
  '',
  'language:',
  '  main: it',
  '  other: [en, "de"]',
  '',
  'prose:',
  '  register: elevated',
  '  session_format: regole-sessione',
  '',
  'system:',
  '  adapter: none',
  '  version: 1',
  '  options: {}',
  '',
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '  - id: cronaca',
  '    folder: Cronaca',
  '    type: chronicle',
  '  - id: luoghi',
  '    folder: Mondo',
  '    type: places',
  '  - id: creature',
  '    folder: Creature',
  '    type: subjects',
  '  - id: oggetti',
  '    folder: Oggetti',
  '    type: objects',
  '    cards: true',
  '  - id: giocatori',
  '    folder: Giocatori',
  '    type: master-only',
  '',
  'modules:',
  '  print: false',
  '  encyclopedia: true',
  '',
  'audit:',
  '  exclusions:',
  '    - subject: lago-grigio',
  '      attribute: number.depth',
  '      values: ["30", 40]',
  '      reason: "Il master: «va bene così»."',
  '      date: 2026-11-07',
  '',
);

const FULL_FOLDERS = ['Trama', 'Cronaca', 'Mondo', 'Creature', 'Oggetti', 'Giocatori'];

/** Makes a temporary campaign folder with the given campaign.yaml text (null = no file). */
function makeCampaign(yamlText, folders = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-'));
  created.push(root);
  for (const folder of folders) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
  }
  if (yamlText !== null) {
    fs.writeFileSync(path.join(root, 'campaign.yaml'), yamlText);
  }
  return root;
}

/** Returns the codes and paths of the errors, for compact assertions. */
const errorsOf = (yamlText, folders = []) => validateConfig(makeCampaign(yamlText, folders)).errors;
const codesOf = (issues) => issues.map((issue) => issue.code);
const pairsOf = (issues) => issues.map((issue) => `${issue.code} ${issue.path}`);

test('a minimal config is valid and only warns that there is no structure', () => {
  const result = validateConfig(makeCampaign(MINIMAL));
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(pairsOf(result.warnings), ['no-structure structure']);
  assert.equal(result.config.campaign.slug, 'ceneri-della-valle');
});

test('a full config with structure, modules and an exclusion is valid without warnings', () => {
  const result = validateConfig(makeCampaign(FULL, FULL_FOLDERS));
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.config.structure.length, 6);
  assert.equal(result.config.audit.exclusions.length, 1);
});

test('a missing campaign.yaml is reported as missing-file', () => {
  const result = validateConfig(makeCampaign(null));
  assert.equal(result.ok, false);
  assert.equal(result.config, null);
  assert.deepEqual(pairsOf(result.errors), ['missing-file campaign.yaml']);
});

test('a YAML syntax error is reported as yaml with its line and no config', () => {
  const result = validateConfig(makeCampaign(lines('schema: 1', 'campaign:', '\tname: x')));
  assert.equal(result.ok, false);
  assert.equal(result.config, null);
  assert.deepEqual(codesOf(result.errors), ['yaml']);
  assert.match(result.errors[0].message, /^line 3: /);
});

test('schema must be the number 1', () => {
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('schema: 1', 'schema: 2'))), ['bad-schema schema']);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('schema: 1', 'schema: "1"'))), ['bad-schema schema']);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('schema: 1\n', ''))), ['bad-schema schema']);
});

test('an unknown top-level key is reported as unknown-key', () => {
  assert.deepEqual(pairsOf(errorsOf(`${MINIMAL}colour: red\n`)), ['unknown-key colour']);
});

test('required sections and keys are reported as missing-key', () => {
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('  name: "Le ceneri della valle"\n', ''))), [
    'missing-key campaign.name',
  ]);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('language:\n  main: it\n  other: []\n', ''))), [
    'missing-key language',
  ]);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('prose:\n  register: plain\n', ''))), ['missing-key prose']);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('system:\n  adapter: none\n', ''))), ['missing-key system']);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('  register: plain', '  session_format: x'))), [
    'missing-key prose.register',
  ]);
});

test('campaign values are checked for type, emptiness, pattern and calendar date', () => {
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('"Le ceneri della valle"', '""'))), [
    'bad-value campaign.name',
  ]);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('"Le ceneri della valle"', '12'))), ['bad-type campaign.name']);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('slug: ceneri-della-valle', 'slug: Ceneri_Valle'))), [
    'bad-value campaign.slug',
  ]);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('created: 2026-11-07', 'created: 2026-02-30'))), [
    'bad-value campaign.created',
  ]);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('created: 2026-11-07', 'created: 2026-1-7'))), [
    'bad-value campaign.created',
  ]);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('created: 2026-11-07', 'created: 2026-11-07\n  colour: red'))), [
    'unknown-key campaign.colour',
  ]);
});

test('language codes are checked for format and list type', () => {
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('main: it', 'main: italiano'))), ['bad-value language.main']);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('other: []', 'other: en'))), ['bad-type language.other']);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('other: []', 'other: [en, "EN"]'))), [
    'bad-value language.other[1]',
  ]);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('other: []', 'other: [en, 3]'))), ['bad-type language.other[1]']);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('  other: []', '  other: []\n  flag: 1'))), [
    'unknown-key language.flag',
  ]);
});

test('prose register is an enumeration and session_format is text', () => {
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('register: plain', 'register: loud'))), ['bad-value prose.register']);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('register: plain', 'register: 3'))), ['bad-type prose.register']);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('register: plain', 'register: plain\n  session_format: 5'))), [
    'bad-type prose.session_format',
  ]);
});

test('system adapter must be installed; version and options must have the right type', () => {
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('adapter: none', 'adapter: no-such-system'))), [
    'unknown-adapter system.adapter',
  ]);
  assert.match(errorsOf(MINIMAL.replace('adapter: none', 'adapter: no-such-system'))[0].message, /no-such-system is not installed/);
  assert.deepEqual(errorsOf(MINIMAL.replace('adapter: none', 'adapter: dnd-2024')), []);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('adapter: none', 'adapter: none\n  version: "1"'))), [
    'bad-type system.version',
  ]);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('adapter: none', 'adapter: none\n  version: 1.5'))), [
    'bad-type system.version',
  ]);
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('adapter: none', 'adapter: none\n  options: []'))), [
    'bad-type system.options',
  ]);
});

test('structure must be a list of mappings', () => {
  assert.deepEqual(pairsOf(errorsOf(`${MINIMAL}structure: Trama\n`)), [
    'bad-type structure',
  ]);
  assert.deepEqual(pairsOf(errorsOf(`${MINIMAL}structure:\n  - Trama\n`)), ['bad-type structure[0]']);
});

test('an empty structure only warns', () => {
  const result = validateConfig(makeCampaign(`${MINIMAL}structure: []\n`));
  assert.equal(result.ok, true);
  assert.deepEqual(pairsOf(result.warnings), ['no-structure structure']);
});

test('structure ids must be slugs and unique', () => {
  const yaml = `${MINIMAL}structure:
  - id: Trama
    folder: Trama
    type: plot
  - id: cronaca
    folder: Cronaca
    type: chronicle
  - id: cronaca
    folder: Altra
    type: free
`;
  assert.deepEqual(pairsOf(errorsOf(yaml, ['Trama', 'Cronaca', 'Altra'])), [
    'bad-value structure[0].id',
    'duplicate-category-id structure[2].id',
  ]);
});

test('structure folders must be relative and inside the campaign folder', () => {
  const build = (folder) => `${MINIMAL}structure:\n  - id: trama\n    folder: ${folder}\n    type: plot\n`;
  assert.deepEqual(pairsOf(errorsOf(build('../Trama'))), ['bad-folder structure[0].folder']);
  assert.deepEqual(pairsOf(errorsOf(build('/Trama'))), ['bad-folder structure[0].folder']);
  assert.deepEqual(pairsOf(errorsOf(build('Trama\\\\x'))), ['bad-folder structure[0].folder']);
});

test('a declared folder that does not exist is reported as missing-folder', () => {
  const result = validateConfig(makeCampaign(`${MINIMAL}structure:\n  - id: trama\n    folder: Trama\n    type: plot\n`));
  assert.deepEqual(pairsOf(result.errors), ['missing-folder structure[0].folder']);
  assert.equal(result.errors[0].message, 'the folder Trama declared in the settings does not exist');
});

test('two categories with the same folder are reported as duplicate-folder', () => {
  const yaml = `${MINIMAL}structure:
  - id: trama
    folder: Trama
    type: plot
  - id: storia
    folder: Trama
    type: free
`;
  assert.deepEqual(pairsOf(errorsOf(yaml, ['Trama'])), ['duplicate-folder structure[1].folder']);
});

test('a category needs a valid type', () => {
  const missing = `${MINIMAL}structure:\n  - id: trama\n    folder: Trama\n`;
  assert.deepEqual(pairsOf(errorsOf(missing, ['Trama'])), ['missing-key structure[0].type']);
  const wrong = `${MINIMAL}structure:\n  - id: trama\n    folder: Trama\n    type: diary\n`;
  assert.deepEqual(pairsOf(errorsOf(wrong, ['Trama'])), ['bad-value structure[0].type']);
  const notText = `${MINIMAL}structure:\n  - id: trama\n    folder: Trama\n    type: 4\n`;
  assert.deepEqual(pairsOf(errorsOf(notText, ['Trama'])), ['bad-type structure[0].type']);
});

test('a sources category is a valid type', () => {
  const yaml = `${MINIMAL}structure:\n  - id: fonti\n    folder: Fonti\n    type: sources\n`;
  assert.deepEqual(errorsOf(yaml, ['Fonti']), []);
});

test('a style is not installed, and cards only makes sense on objects', () => {
  const styled = `${MINIMAL}structure:\n  - id: creature\n    folder: Creature\n    type: subjects\n    style: dark-fantasy\n`;
  assert.deepEqual(pairsOf(errorsOf(styled, ['Creature'])), ['unknown-style structure[0].style']);
  const cards = `${MINIMAL}structure:\n  - id: trama\n    folder: Trama\n    type: plot\n    cards: true\n`;
  assert.deepEqual(pairsOf(errorsOf(cards, ['Trama'])), ['cards-not-objects structure[0].cards']);
  const notBool = `${MINIMAL}structure:\n  - id: oggetti\n    folder: Oggetti\n    type: objects\n    cards: "yes"\n`;
  assert.deepEqual(pairsOf(errorsOf(notBool, ['Oggetti'])), ['bad-type structure[0].cards']);
});

test('unknown keys inside a category are reported', () => {
  const yaml = `${MINIMAL}structure:\n  - id: trama\n    folder: Trama\n    type: plot\n    owner: Stefano\n`;
  assert.deepEqual(pairsOf(errorsOf(yaml, ['Trama'])), ['unknown-key structure[0].owner']);
});

test('modules accept only the known keys, with boolean values', () => {
  assert.deepEqual(pairsOf(errorsOf(`${MINIMAL}modules:\n  sauna: true\n`)), ['unknown-module modules.sauna']);
  assert.deepEqual(pairsOf(errorsOf(`${MINIMAL}modules:\n  print: "yes"\n`)), ['bad-type modules.print']);
});

test('audit accepts only exclusions, and each exclusion is complete and well formed', () => {
  assert.deepEqual(pairsOf(errorsOf(`${MINIMAL}audit:\n  rules: []\n`)), ['unknown-key audit.rules']);

  const base = (fields) => `${MINIMAL}audit:\n  exclusions:\n    - ${fields.join('\n      ')}\n`;
  const complete = ['subject: lago-grigio', 'attribute: number.depth', 'values: ["30"]', 'reason: "ok"', 'date: 2026-11-07'];
  assert.deepEqual(errorsOf(base(complete)), []);

  const without = (key) => complete.filter((line) => !line.startsWith(`${key}:`));
  assert.deepEqual(pairsOf(errorsOf(base(without('reason')))), ['bad-exclusion audit.exclusions[0].reason']);

  const badAttribute = complete.map((line) => line.replace('number.depth', 'Number.Depth'));
  assert.deepEqual(pairsOf(errorsOf(base(badAttribute))), ['bad-exclusion audit.exclusions[0].attribute']);

  const badSubject = complete.map((line) => line.replace('lago-grigio', 'Lago Grigio'));
  assert.deepEqual(pairsOf(errorsOf(base(badSubject))), ['bad-exclusion audit.exclusions[0].subject']);

  const badDate = complete.map((line) => line.replace('2026-11-07', '2026-13-01'));
  assert.deepEqual(pairsOf(errorsOf(base(badDate))), ['bad-exclusion audit.exclusions[0].date']);

  const emptyValues = complete.map((line) => line.replace('values: ["30"]', 'values: []'));
  assert.deepEqual(pairsOf(errorsOf(base(emptyValues))), ['bad-exclusion audit.exclusions[0].values']);

  const textValues = complete.map((line) => line.replace('values: ["30"]', 'values: "30"'));
  assert.deepEqual(pairsOf(errorsOf(base(textValues))), ['bad-type audit.exclusions[0].values']);

  const nestedValue = complete.map((line) => line.replace('values: ["30"]', 'values: [true]'));
  assert.deepEqual(pairsOf(errorsOf(base(nestedValue))), ['bad-type audit.exclusions[0].values[0]']);

  const notMapping = `${MINIMAL}audit:\n  exclusions:\n    - lago\n`;
  assert.deepEqual(pairsOf(errorsOf(notMapping)), ['bad-type audit.exclusions[0]']);
});

test('errors come out sorted by path, then code, and the result is deterministic', () => {
  const yaml = lines(
    'schema: 2',
    'campaign:',
    '  name: ""',
    '  slug: Bad Slug',
    '  created: 2026-02-30',
    'language:',
    '  main: italiano',
    'prose:',
    '  register: loud',
    'system:',
    '  adapter: no-such-system',
    'colour: red',
    '',
  );
  const folder = makeCampaign(yaml);
  const first = validateConfig(folder);
  const second = validateConfig(folder);
  assert.deepEqual(first, second);
  assert.deepEqual(pairsOf(first.errors), [
    'bad-value campaign.created',
    'bad-value campaign.name',
    'bad-value campaign.slug',
    'unknown-key colour',
    'bad-value language.main',
    'bad-value prose.register',
    'bad-schema schema',
    'unknown-adapter system.adapter',
  ]);
});

test('an unknown key in prose is reported as unknown-key', () => {
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('  register: plain', '  register: plain\n  tone: dry'))), [
    'unknown-key prose.tone',
  ]);
});

test('an unknown key in system is reported as unknown-key, while options content stays free', () => {
  assert.deepEqual(pairsOf(errorsOf(MINIMAL.replace('adapter: none', 'adapter: none\n  flavour: x'))), [
    'unknown-key system.flavour',
  ]);
  assert.deepEqual(errorsOf(MINIMAL.replace('adapter: none', 'adapter: none\n  options:\n    anything: goes'))
    .filter((issue) => issue.code === 'unknown-key'), []);
});

test('an unknown key in an audit exclusion is reported as unknown-key', () => {
  const yaml = `${MINIMAL}audit:\n  exclusions:\n    - subject: lago-grigio\n      attribute: number.depth\n      values: ["30"]\n      reason: "ok"\n      date: 2026-11-07\n      note: extra\n`;
  assert.deepEqual(pairsOf(errorsOf(yaml)), ['unknown-key audit.exclusions[0].note']);
});

test('an external category is accepted when its folder exists', () => {
  const yaml = `${MINIMAL}structure:\n  - id: esterno\n    folder: Esterno\n    type: external\n`;
  assert.deepEqual(errorsOf(yaml, ['Esterno']), []);
});

test('an external category accepts a valid exclude list', () => {
  const yaml = `${MINIMAL}structure:\n  - id: esterno\n    folder: Esterno\n    type: external\n    exclude: ["Bozze", "note/privato.md"]\n`;
  assert.deepEqual(errorsOf(yaml, ['Esterno']), []);
});

test('exclude is only valid on an external category', () => {
  const yaml = `${MINIMAL}structure:\n  - id: trama\n    folder: Trama\n    type: plot\n    exclude: ["Bozze"]\n`;
  assert.deepEqual(pairsOf(errorsOf(yaml, ['Trama'])), ['exclude-not-external structure[0].exclude']);
});

test('exclude must be a list of text items', () => {
  const notList = `${MINIMAL}structure:\n  - id: esterno\n    folder: Esterno\n    type: external\n    exclude: Bozze\n`;
  assert.deepEqual(pairsOf(errorsOf(notList, ['Esterno'])), ['bad-type structure[0].exclude']);
  const notText = `${MINIMAL}structure:\n  - id: esterno\n    folder: Esterno\n    type: external\n    exclude: [3]\n`;
  assert.deepEqual(pairsOf(errorsOf(notText, ['Esterno'])), ['bad-type structure[0].exclude[0]']);
});

test('exclude items must be safe relative paths inside the folder', () => {
  const yaml = `${MINIMAL}structure:\n  - id: esterno\n    folder: Esterno\n    type: external\n    exclude: ["../segreto", "/assoluto", "a\\\\b"]\n`;
  assert.deepEqual(pairsOf(errorsOf(yaml, ['Esterno'])), [
    'bad-exclude structure[0].exclude[0]',
    'bad-exclude structure[0].exclude[1]',
    'bad-exclude structure[0].exclude[2]',
  ]);
});

test('a folder that is a symlink to a directory counts as an existing folder', () => {
  const root = makeCampaign(`${MINIMAL}structure:\n  - id: esterno\n    folder: Esterno\n    type: external\n`);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-target-'));
  created.push(target);
  fs.symlinkSync(target, path.join(root, 'Esterno'), 'dir');
  const result = validateConfig(root);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
});

test('a folder that is a broken symlink is reported as missing-folder', () => {
  const root = makeCampaign(`${MINIMAL}structure:\n  - id: esterno\n    folder: Esterno\n    type: external\n`);
  fs.symlinkSync(path.join(root, 'nowhere'), path.join(root, 'Esterno'), 'dir');
  assert.deepEqual(pairsOf(validateConfig(root).errors), ['missing-folder structure[0].folder']);
});

test('the morvalle fixture is valid with no errors', () => {
  const result = validateConfig(FIXTURE);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
});

test('allow_model_imagination accepts null, true, false and an absent key', () => {
  assert.deepEqual(errorsOf(MINIMAL), []);
  assert.deepEqual(errorsOf(`${MINIMAL}allow_model_imagination: null\n`), []);
  assert.deepEqual(errorsOf(`${MINIMAL}allow_model_imagination: true\n`), []);
  assert.deepEqual(errorsOf(`${MINIMAL}allow_model_imagination: false\n`), []);
  assert.equal(validateConfig(makeCampaign(`${MINIMAL}allow_model_imagination: true\n`)).config.allow_model_imagination, true);
});

test('allow_model_imagination rejects text, numbers, lists and mappings with its own path', () => {
  assert.deepEqual(pairsOf(errorsOf(`${MINIMAL}allow_model_imagination: "yes"\n`)), ['bad-value allow_model_imagination']);
  assert.deepEqual(pairsOf(errorsOf(`${MINIMAL}allow_model_imagination: yes\n`)), ['bad-value allow_model_imagination']);
  assert.deepEqual(pairsOf(errorsOf(`${MINIMAL}allow_model_imagination: 1\n`)), ['bad-value allow_model_imagination']);
  assert.deepEqual(pairsOf(errorsOf(`${MINIMAL}allow_model_imagination: [true]\n`)), ['bad-type allow_model_imagination']);
  assert.deepEqual(pairsOf(errorsOf(`${MINIMAL}allow_model_imagination: {}\n`)), ['bad-type allow_model_imagination']);
  assert.equal(
    errorsOf(`${MINIMAL}allow_model_imagination: "yes"\n`)[0].message,
    'allow_model_imagination must be true, false or null',
  );
});
