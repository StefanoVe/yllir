import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkEnemies, readEnemies } from './enemies-check.mjs';

const CAMPAIGN = [
  'name: Test',
  'language:',
  '  main: it',
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '  - id: creature',
  '    folder: Creature',
  '    type: subjects',
  '  - id: personaggi',
  '    folder: Personaggi',
  '    type: subjects',
  '',
].join('\n');

const SUBJECTS = {
  'Creature/Guardiano di sale.md': '---\nid: guardiano-di-sale\ntemplate: enemy\n---\n\n# Guardiano di sale\n',
  'Creature/Capo dei predoni.md': '---\nid: capo-dei-predoni\ntemplate: npc\n---\n\n# Capo dei predoni\n',
  'Personaggi/Ilde Varno.md': '---\nid: ilde-varno\ntemplate: character\n---\n\n# Ilde Varno\n',
};

const EVENT = 'Trama/Sessione 3/Eventi/Scontro al ponte.md';

/** Metadata of an event with the given enemies block (lines), with no fight when null. */
function event(enemies) {
  const lines = ['<!-- yllir', 'id: scontro-al-ponte', 'session: sessione-03', 'depends_on: []'];
  if (enemies !== null) lines.push(...enemies);
  lines.push('-->', '', 'Il gruppo attraversa il ponte.', '');
  return lines.join('\n');
}

const VALID_ENEMIES = [
  'enemies:',
  '  - id: guardiano-di-sale',
  '    count: 3',
  '  - id: capo-dei-predoni',
  '    count: 1',
];

/** Writes a temporary campaign, runs `fn` on it and removes it afterwards. */
function withCampaign(files, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-enemies-'));
  try {
    const all = { 'campaign.yaml': CAMPAIGN, ...SUBJECTS, ...files };
    for (const [rel, content] of Object.entries(all)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Errors of one event file with the given enemies block. */
function checkEvent(enemies, file = EVENT) {
  return withCampaign({ [file]: event(enemies) }, (root) => checkEnemies(root, { files: [file] }).errors);
}

function codesOf(errors) {
  return errors.map((e) => e.code);
}

test('a valid fight has no errors', () => {
  assert.deepEqual(checkEvent(VALID_ENEMIES), []);
});

test('an event with no enemies key is ok', () => {
  assert.deepEqual(checkEvent(null), []);
});

test('an empty enemies list is ok', () => {
  assert.deepEqual(checkEvent(['enemies: []']), []);
});

test('a list that is not block maps reports enemies-shape', () => {
  const errors = checkEvent(['enemies: [guardiano-di-sale, capo-dei-predoni]']);
  assert.deepEqual(codesOf(errors), ['enemies-shape', 'enemies-shape']);
  assert.equal(errors[0].file, EVENT);
});

test('a map with an extra key reports enemies-shape', () => {
  const errors = checkEvent([
    'enemies:',
    '  - id: guardiano-di-sale',
    '    count: 3',
    '    note: alla fine',
  ]);
  assert.deepEqual(codesOf(errors), ['enemies-shape']);
});

test('a map without count reports enemies-shape', () => {
  assert.deepEqual(codesOf(checkEvent(['enemies:', '  - id: guardiano-di-sale'])), ['enemies-shape']);
});

test('an unknown id reports enemies-unknown', () => {
  const errors = checkEvent(['enemies:', '  - id: drago-inesistente', '    count: 1']);
  assert.deepEqual(codesOf(errors), ['enemies-unknown']);
});

test('a subject that is not a creature reports enemies-not-creature', () => {
  const errors = checkEvent(['enemies:', '  - id: ilde-varno', '    count: 1']);
  assert.deepEqual(codesOf(errors), ['enemies-not-creature']);
});

test('a count that is zero, text, or fractional reports enemies-count', () => {
  for (const count of ['0', 'abc', '2.5', '-1']) {
    const errors = checkEvent(['enemies:', '  - id: guardiano-di-sale', `    count: ${count}`]);
    assert.deepEqual(codesOf(errors), ['enemies-count'], `count ${count}`);
  }
});

test('the same id twice reports enemies-duplicate', () => {
  const errors = checkEvent([
    'enemies:',
    '  - id: guardiano-di-sale',
    '    count: 2',
    '  - id: guardiano-di-sale',
    '    count: 1',
  ]);
  assert.deepEqual(codesOf(errors), ['enemies-duplicate']);
});

test('a file outside an Eventi folder is ignored', () => {
  const file = 'Trama/Sessione 3/Note.md';
  const errors = withCampaign({ [file]: event(['enemies: [x]']) }, (root) => checkEnemies(root, { files: [file] }).errors);
  assert.deepEqual(errors, []);
});

test('a session main file is ignored even with bad enemies', () => {
  const file = 'Trama/Sessione 3/Eventi/Eventi.md';
  assert.deepEqual(checkEvent(['enemies: [x]'], file), []);
  const main = 'Trama/Sessione 3/Sessione 3.md';
  const errors = withCampaign({ [main]: event(['enemies: [x]']) }, (root) => checkEnemies(root, { files: [main] }).errors);
  assert.deepEqual(errors, []);
});

test('an English Events folder is checked too', () => {
  const file = 'Trama/Session 3/Events/Bridge.md';
  assert.deepEqual(codesOf(checkEvent(['enemies: [x]'], file)), ['enemies-shape']);
});

test('without a files list every event of the plot folders is checked', () => {
  const errors = withCampaign(
    {
      [EVENT]: event(['enemies:', '  - id: nessuno', '    count: 1']),
      'Trama/Sessione 3/Sessione 3.md': event(['enemies: [x]']),
    },
    (root) => checkEnemies(root).errors,
  );
  assert.deepEqual(codesOf(errors), ['enemies-unknown']);
});

test('readEnemies keeps valid entries as numbers and skips invalid ones', () => {
  assert.deepEqual(
    readEnemies({
      enemies: [
        { id: 'guardiano-di-sale', count: '3' },
        { id: 'capo-dei-predoni', count: 1 },
        { id: 'x', count: '0' },
        { id: '', count: '2' },
        { id: 'y' },
        'z',
      ],
    }),
    [
      { id: 'guardiano-di-sale', count: 3 },
      { id: 'capo-dei-predoni', count: 1 },
    ],
  );
});

test('readEnemies is empty when there is no list', () => {
  assert.deepEqual(readEnemies({}), []);
  assert.deepEqual(readEnemies(null), []);
  assert.deepEqual(readEnemies({ enemies: 'guardiano' }), []);
});
