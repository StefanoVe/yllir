import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCreature } from './checks.mjs';

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
