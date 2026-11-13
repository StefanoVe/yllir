import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeEncounters, markNoFight, prepareEncounters } from './encounters.mjs';

const roots = [];
after(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

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
  'Creature/Lupo.md': '---\nid: lupo\ntemplate: creature\n---\n\n# Lupo\n',
  'Creature/Capo dei predoni.md': '---\nid: capo-dei-predoni\ntemplate: npc\n---\n\n# Capo dei predoni\n',
  'Personaggi/Ilde Varno.md': '---\nid: ilde-varno\ntemplate: character\n---\n\n# Ilde Varno\n',
};

const FIGHT = 'Trama/Sessione 3/Eventi/Scontro al ponte.md';
const TALK = 'Trama/Sessione 3/Eventi/Conversazione.md';
const DONE = 'Trama/Sessione 3/Eventi/Gia dichiarato.md';
const MAIN = 'Trama/Sessione 3/Sessione 3.md';

/** An event file: metadata block with the given characters line and an optional extra lines. */
function event(characters, extra = []) {
  return ['<!-- yllir', 'id: evento', 'session: sessione-03', `characters: [${characters.join(', ')}]`, ...extra, '-->', '', 'Il gruppo attraversa il ponte.', ''].join('\n');
}

const VALID = ['enemies:', '  - id: guardiano-di-sale', '    count: 3'];

/** A temporary campaign with the given event files; returns the root. */
function campaign(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-encounters-'));
  roots.push(root);
  const all = {
    'campaign.yaml': CAMPAIGN,
    ...SUBJECTS,
    [FIGHT]: event(['guardiano-di-sale', 'ilde-varno']),
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const ids = (result) => result.events.map((e) => e.file);

test('an event with a creature among its characters and no enemies key is a candidate', async () => {
  const root = campaign({});
  const result = await prepareEncounters(root);
  assert.equal(result.status, 'pending');
  assert.deepEqual(ids(result), [FIGHT]);
  assert.deepEqual(result.events[0].candidates, ['guardiano-di-sale']);
  assert.deepEqual(result.events[0].status, 'pending');
  const saved = JSON.parse(fs.readFileSync(path.join(root, '.campaign/state/update/encounters.json'), 'utf8'));
  assert.deepEqual(saved.events, [{ file: FIGHT, status: 'pending' }]);
});

test('an event that already has an enemies key is not listed', async () => {
  const root = campaign({ [DONE]: event(['guardiano-di-sale'], VALID) });
  const result = await prepareEncounters(root);
  assert.deepEqual(ids(result), [FIGHT]);
});

test('an event with no creature among its characters is not listed', async () => {
  const root = campaign({ [TALK]: event(['ilde-varno', 'capo-dei-predoni']) });
  const result = await prepareEncounters(root);
  assert.deepEqual(ids(result), [FIGHT]);
});

test('the session main file is not an event', async () => {
  const root = campaign({ [MAIN]: event(['guardiano-di-sale']) });
  const result = await prepareEncounters(root);
  assert.equal(ids(result).includes(MAIN), false);
});

test('a no-fight event is kept across a new inventory and never proposed again', async () => {
  const root = campaign({});
  assert.equal((await markNoFight(root, FIGHT)).status, 'no-fight');
  const again = await prepareEncounters(root);
  assert.equal(again.status, 'complete');
  assert.deepEqual(again.events, []);
  const saved = JSON.parse(fs.readFileSync(path.join(root, '.campaign/state/update/encounters.json'), 'utf8'));
  assert.deepEqual(saved.events, [{ file: FIGHT, status: 'no-fight' }]);
});

test('no-fight refuses a file that is not an event', async () => {
  const root = campaign({});
  const result = await markNoFight(root, 'Personaggi/Ilde Varno.md');
  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'not-an-event');
});

test('complete is refused while the enemies key is absent, and the event stays pending', async () => {
  const root = campaign({});
  const result = await completeEncounters(root, [FIGHT]);
  assert.equal(result.status, 'pending');
  assert.deepEqual(result.completed, []);
  assert.equal(result.errors[0].code, 'enemies-missing');
  assert.deepEqual(ids(result), [FIGHT]);
});

test('complete accepts an event whose enemies block is valid', async () => {
  const root = campaign({});
  fs.writeFileSync(path.join(root, FIGHT), event(['guardiano-di-sale', 'ilde-varno'], VALID));
  const result = await completeEncounters(root, [FIGHT]);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.completed, [FIGHT]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual((await prepareEncounters(root)).events, []);
});

test('complete refuses an enemies block that names a subject which is not a creature', async () => {
  const root = campaign({});
  fs.writeFileSync(path.join(root, FIGHT), event(['guardiano-di-sale'], ['enemies:', '  - id: ilde-varno', '    count: 1']));
  const result = await completeEncounters(root, [FIGHT]);
  assert.equal(result.status, 'pending');
  assert.equal(result.errors[0].code, 'enemies-missing');
});

test('complete refuses an empty enemies list', async () => {
  const root = campaign({});
  fs.writeFileSync(path.join(root, FIGHT), event(['guardiano-di-sale'], ['enemies: []']));
  const result = await completeEncounters(root, [FIGHT]);
  assert.equal(result.completed.length, 0);
});

test('a pending event that the master then wrote a valid block into stays pending until it is completed', async () => {
  const root = campaign({});
  assert.deepEqual(ids(await prepareEncounters(root)), [FIGHT]);
  fs.writeFileSync(path.join(root, FIGHT), event(['guardiano-di-sale'], VALID));
  assert.deepEqual(ids(await prepareEncounters(root)), [FIGHT]);
  assert.equal((await completeEncounters(root, [FIGHT])).status, 'complete');
});

test('a refused event that was never listed makes the migration pending', async () => {
  const root = campaign({ [DONE]: event(['guardiano-di-sale'], ['enemies:', '  - id: ilde-varno', '    count: 1']) });
  const result = await completeEncounters(root, [DONE]);
  assert.equal(result.status, 'pending');
  assert.ok(ids(result).includes(DONE));
});
