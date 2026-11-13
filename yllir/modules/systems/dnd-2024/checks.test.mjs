import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCreature, checkSceneCheck, fixRolls } from './checks.mjs';

function codes(fields) {
  return checkCreature(fields).map((entry) => entry.code);
}

test('ability score without a written modifier is valid', () => {
  assert.deepEqual(checkCreature({ str: '14' }), []);
});

test('ability score with a matching modifier is valid, with ASCII or unicode minus', () => {
  assert.deepEqual(checkCreature({ dex: '14 (+2)' }), []);
  assert.deepEqual(checkCreature({ dex: '9 (-1)' }), []);
  assert.deepEqual(checkCreature({ dex: '9 (−1)' }), []);
});

test('ability score with a wrong modifier reports bad-modifier', () => {
  const errors = checkCreature({ str: '14 (+3)' });
  assert.deepEqual(errors.map((entry) => entry.code), ['bad-modifier']);
  assert.equal(errors[0].field, 'str');
});

test('ability score outside 1..30 or not an integer reports bad-value', () => {
  assert.deepEqual(codes({ con: '0' }), ['bad-value']);
  assert.deepEqual(codes({ con: '31' }), ['bad-value']);
  assert.deepEqual(codes({ con: 'dodici' }), ['bad-value']);
  assert.deepEqual(codes({ con: '12.5' }), ['bad-value']);
});

test('armor class accepts a number with optional text in parentheses', () => {
  assert.deepEqual(checkCreature({ ac: '15' }), []);
  assert.deepEqual(checkCreature({ ac: '15 (cuoio borchiato)' }), []);
  assert.deepEqual(codes({ ac: '0' }), ['bad-value']);
  assert.deepEqual(codes({ ac: '31 (scudo)' }), ['bad-value']);
  assert.deepEqual(codes({ ac: 'alta' }), ['bad-value']);
});

test('hit points without dice are valid when positive', () => {
  assert.deepEqual(checkCreature({ hp: '33' }), []);
  assert.deepEqual(codes({ hp: '0' }), ['bad-value']);
});

test('hit points with dice must match the average of the dice', () => {
  assert.deepEqual(checkCreature({ hp: '45 (6d10+12)' }), []);
  assert.deepEqual(checkCreature({ hp: '33 (6d10)' }), []);
  assert.deepEqual(checkCreature({ hp: '6 (2d6 − 1)' }), []);
  assert.deepEqual(codes({ hp: '46 (6d10+12)' }), ['bad-hp-average']);
  assert.deepEqual(codes({ hp: '7 (2d6 - 1)' }), ['bad-hp-average']);
});

test('challenge rating accepts 0, 1/8, 1/4, 1/2 and integers 1..30 only', () => {
  for (const cr of ['0', '1/8', '1/4', '1/2', '1', '30']) assert.deepEqual(checkCreature({ cr }), [], cr);
  for (const cr of ['31', '1/3', 'x']) assert.deepEqual(codes({ cr }), ['bad-value'], cr);
});

test('proficiency bonus must match the challenge rating', () => {
  assert.deepEqual(checkCreature({ cr: '1/2', proficiency_bonus: '+2' }), []);
  assert.deepEqual(checkCreature({ cr: '0', proficiency_bonus: '2' }), []);
  assert.deepEqual(checkCreature({ cr: '5', proficiency_bonus: '+3' }), []);
  assert.deepEqual(codes({ cr: '5', proficiency_bonus: '+2' }), ['bad-proficiency']);
  assert.deepEqual(codes({ cr: '1/2', proficiency_bonus: '+3' }), ['bad-proficiency']);
});

test('proficiency bonus without a valid challenge rating is only format-checked', () => {
  assert.deepEqual(checkCreature({ proficiency_bonus: '+5' }), []);
  assert.deepEqual(checkCreature({ cr: 'x', proficiency_bonus: '+2' }).map((entry) => entry.code), ['bad-value']);
  assert.deepEqual(codes({ proficiency_bonus: 'due' }), ['bad-value']);
});

test('fields not listed by the checks are not checked', () => {
  assert.deepEqual(checkCreature({ speed: 'anything at all', initiative: '99', saves: 'x' }), []);
});

test('scene check: Italian forms are accepted, with skills in any case and a skill paired with another ability', () => {
  for (const value of ['Carisma (Persuasione) CD 13', 'Carisma CD 13', 'Tiro salvezza su Saggezza CD 13',
    'carisma (persuasione) cd 5', '  Destrezza  (Rapidità di Mano)  CD   30 ', 'Forza (Persuasione) CD 10']) {
    assert.deepEqual(checkSceneCheck(value, 'it'), [], value);
  }
});

test('scene check: English forms are accepted', () => {
  for (const value of ['Charisma (Persuasion) DC 13', 'Charisma DC 13', 'Wisdom saving throw DC 13',
    'dexterity (sleight of hand) dc 9']) {
    assert.deepEqual(checkSceneCheck(value, 'en'), [], value);
  }
});

test('scene check: the attack form and the Italian names of the English forms are rejected', () => {
  assert.deepEqual(checkSceneCheck('Attacco CD 13', 'it').map((e) => e.code), ['bad-check']);
  assert.deepEqual(checkSceneCheck('Carisma (Persuasione) DC 13', 'it').map((e) => e.code), ['bad-check']);
  assert.deepEqual(checkSceneCheck('Charisma DC 13', 'it').map((e) => e.code), ['bad-check']);
  assert.deepEqual(checkSceneCheck('Persuasion DC 13', 'en').map((e) => e.code), ['bad-check']);
});

test('scene check: an unknown form, ability or skill is rejected with the expected forms', () => {
  const [error] = checkSceneCheck('Persuasione CD 13', 'it');
  assert.equal(error.code, 'bad-check');
  assert.equal(error.message, '"Persuasione CD 13" is not a D&D 2024 check; write "Carisma (Persuasione) CD 13" or "Tiro salvezza su Saggezza CD 13"');
  assert.deepEqual(checkSceneCheck('Carisma (Foo) CD 13', 'it').map((e) => e.code), ['bad-check']);
  assert.deepEqual(checkSceneCheck('Carisma CD tredici', 'it').map((e) => e.code), ['bad-check']);
  assert.deepEqual(checkSceneCheck('Carisma (Persuasione) CD', 'it').map((e) => e.code), ['bad-check']);
  assert.deepEqual(checkSceneCheck('Ignoto (Persuasione) CD 13', 'it').map((e) => e.code), ['bad-check']);
  assert.deepEqual(checkSceneCheck('Wisdom (Insight) DC 12', 'en').map((e) => e.code), []);
  assert.deepEqual(checkSceneCheck('Wisdom (Acrobatics) DC 12', 'en').map((e) => e.code), []);
  assert.deepEqual(checkSceneCheck('Wisdom (Juggling) DC 12', 'en').map((e) => e.code), ['bad-check']);
});

test('scene check: a DC outside 5..30 is rejected', () => {
  for (const value of ['Carisma CD 4', 'Carisma CD 31']) {
    const errors = checkSceneCheck(value, 'it');
    assert.deepEqual(errors.map((e) => e.code), ['bad-check'], value);
    assert.ok(errors[0].message.includes('from 5 to 30'), errors[0].message);
  }
  assert.deepEqual(checkSceneCheck('Strength saving throw DC 30', 'en'), []);
});

test('precomputed roll in the statistics is reported; dice only is valid', () => {
  const bad = checkCreature({}, '| Lancia | Attacco in mischia: +3. Colpisce: 4 (1d6 + 1) danni perforanti. |');
  assert.equal(bad.length, 1);
  assert.equal(bad[0].code, 'precomputed-roll');
  assert.ok(bad[0].message.includes('"1d6 + 1"'), bad[0].message);
  assert.deepEqual(checkCreature({}, '| Lancia | Attacco in mischia: +3. Colpisce: 1d6 + 1 danni perforanti. |'), []);
});

test('hit points row of the Characteristics table keeps its fixed number', () => {
  assert.deepEqual(checkCreature({ hp: '11 (2d8 + 2)' }, '| PF | 11 (2d8 + 2) |\n| HP | 11 (2d8 + 2) |'), []);
});

test('two precomputed amounts on one line give two precomputed-roll errors', () => {
  const errors = checkCreature({}, '| Lancia | Colpisce: 7 (1d8 + 3) danni taglienti più 3 (1d6) danni da fuoco. |');
  assert.deepEqual(errors.map((entry) => entry.code), ['precomputed-roll', 'precomputed-roll']);
});

test('checkCreature without a statistics argument still passes', () => {
  assert.deepEqual(checkCreature({ str: '14' }), []);
});

test('fixRolls writes a precomputed roll as its dice only and counts it', () => {
  const spear = 'Lancia | Colpisce: 4 (1d6 + 1) danni perforanti.';
  const result = fixRolls(spear);
  assert.equal(result.text, 'Lancia | Colpisce: 1d6 + 1 danni perforanti.');
  assert.equal(result.count, 1);
});

test('fixRolls fixes every amount of a line and counts each one', () => {
  const result = fixRolls('Colpisce: 4 (1d6 + 1) danni, oppure 9 (2d8) danni.');
  assert.equal(result.text, 'Colpisce: 1d6 + 1 danni, oppure 2d8 danni.');
  assert.equal(result.count, 2);
});

test('fixRolls leaves the hit points row unchanged', () => {
  const row = '| PF | 11 (2d8 + 2) |';
  assert.deepEqual(fixRolls(row), { text: row, count: 0 });
});

test('after fixRolls the statistics pass checkCreature', () => {
  const result = fixRolls('| Lancia | Colpisce: 4 (1d6 + 1) danni perforanti. |\n| PF | 11 (2d8 + 2) |');
  assert.deepEqual(checkCreature({}, result.text), []);
});
