import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dieSize,
  rankMultiplier,
  effectiveDie,
  pcMaxHp,
  pcMaxMp,
  pcMaxIp,
  crisisThreshold,
  magicDefense,
  companionHp,
  craftingMaxCost,
  clockSections,
  npcBaseHp,
  npcBaseMp,
  npcAccuracyBonus,
  npcDamageBonus,
  checkCreature,
} from './checks.mjs';

function codes(fields) {
  return checkCreature(fields).map((entry) => entry.code);
}

test('dieSize reads d6, d8, d10 and d12 and rejects everything else', () => {
  assert.equal(dieSize('d6'), 6);
  assert.equal(dieSize('D10'), 10);
  assert.equal(dieSize(' d12 '), 12);
  assert.equal(dieSize('d4'), null);
  assert.equal(dieSize('8'), null);
  assert.equal(dieSize(''), null);
  assert.equal(dieSize(undefined), null);
});

test('rankMultiplier: soldier 1, elite 2, champion N from 2 to 6', () => {
  assert.equal(rankMultiplier('Soldier'), 1);
  assert.equal(rankMultiplier('soldato'), 1);
  assert.equal(rankMultiplier('Elite'), 2);
  assert.equal(rankMultiplier('Élite'), 2);
  assert.equal(rankMultiplier('élite'), 2);
  assert.equal(rankMultiplier('Champion 3'), 3);
  assert.equal(rankMultiplier('campione (4)'), 4);
  assert.equal(rankMultiplier('Champion  2'), 2);
  assert.equal(rankMultiplier('champion 1'), null);
  assert.equal(rankMultiplier('champion 7'), null);
  assert.equal(rankMultiplier('champion'), null);
  assert.equal(rankMultiplier('boss'), null);
});

test('effectiveDie lowers the die one step per status, never below d6', () => {
  assert.equal(effectiveDie('d10', 1), 'd8');
  assert.equal(effectiveDie('d10', 2), 'd6');
  assert.equal(effectiveDie('d8', 5), 'd6');
  assert.equal(effectiveDie('d12', 0), 'd12');
  assert.equal(effectiveDie('d5', 1), null);
  assert.equal(effectiveDie('d8', -1), null);
});

test('player character HP, MP, IP and crisis', () => {
  assert.equal(pcMaxHp({ level: 7, mig: 8 }), 47);
  assert.equal(pcMaxHp({ level: 7, mig: 8, bonus: 5 }), 52);
  assert.equal(pcMaxMp({ level: 7, wlp: 6, bonus: 5 }), 42);
  assert.equal(pcMaxMp({ level: 3, wlp: 10 }), 53);
  assert.equal(pcMaxIp(), 6);
  assert.equal(pcMaxIp({ bonus: 2 }), 8);
  assert.equal(crisisThreshold(47), 23);
  assert.equal(crisisThreshold(52), 26);
});

test('magic defense and companion HP', () => {
  assert.equal(magicDefense({ ins: 10 }), 10);
  assert.equal(magicDefense({ ins: 8, bonus: 1 }), 9);
  assert.equal(companionHp({ skillLevel: 2, companionMig: 10, level: 9 }), 24);
});

test('crafting cost and clock sections', () => {
  assert.equal(craftingMaxCost(12), 720);
  assert.equal(clockSections({ total: 9, difficulty: 10 }), 0);
  assert.equal(clockSections({ total: 10, difficulty: 10 }), 1);
  assert.equal(clockSections({ total: 12, difficulty: 10 }), 1);
  assert.equal(clockSections({ total: 13, difficulty: 10 }), 2);
  assert.equal(clockSections({ total: 17, difficulty: 10 }), 3);
});

test('NPC base HP, base MP, accuracy and damage bonuses', () => {
  assert.equal(npcBaseHp({ level: 10, mig: 8 }), 60);
  assert.equal(npcBaseMp({ level: 10, wlp: 6 }), 40);
  assert.equal(npcAccuracyBonus(9), 0);
  assert.equal(npcAccuracyBonus(25), 2);
  assert.equal(npcDamageBonus(19), 0);
  assert.equal(npcDamageBonus(40), 10);
});

test('valid soldier has no errors', () => {
  const fields = {
    level: '10', rank: 'Soldier', hp: '60', mp: '40', dex: 'd8', ins: 'd10', mig: 'd8', wlp: 'd6', def: '8', mdef: '10',
  };
  assert.deepEqual(checkCreature(fields), []);
});

test('valid Italian elite with a correct crisis has no errors', () => {
  assert.deepEqual(checkCreature({ level: '10', rank: 'Élite', hp: '120 (crisi 60)', mig: 'd8' }), []);
});

test('valid champion with higher values has no errors', () => {
  assert.deepEqual(checkCreature({ level: '10', rank: 'Champion 3', hp: '190', mig: 'd8' }), []);
});

test('elite below the minimum hit points reports bad-hp', () => {
  const errors = checkCreature({ level: '10', rank: 'Elite', hp: '100', mig: 'd8' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'bad-hp');
  assert.equal(errors[0].field, 'hp');
});

test('champion 3 below the minimum hit points reports bad-hp', () => {
  const errors = checkCreature({ level: '10', rank: 'Champion 3', hp: '179', mig: 'd8' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'bad-hp');
});

test('magic points below the minimum report bad-mp', () => {
  const errors = checkCreature({ level: '10', mp: '39', wlp: 'd6' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'bad-mp');
  assert.equal(errors[0].field, 'mp');
});

test('a wrong crisis number reports bad-crisis', () => {
  const errors = checkCreature({ hp: '60 (crisis 31)' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'bad-crisis');
  assert.equal(errors[0].field, 'hp');
});

test('magic defense below INS reports bad-defense on mdef', () => {
  const errors = checkCreature({ ins: 'd10', mdef: '8' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'bad-defense');
  assert.equal(errors[0].field, 'mdef');
});

test('def is never compared', () => {
  assert.deepEqual(checkCreature({ dex: 'd12', def: '6' }), []);
});

test('an invalid die reports bad-value and stops the check that needs it', () => {
  const dex = checkCreature({ dex: 'd20' });
  assert.equal(dex.length, 1);
  assert.equal(dex[0].code, 'bad-value');
  assert.equal(dex[0].field, 'dex');

  const mig = checkCreature({ level: '10', rank: 'Soldier', hp: '1', mig: 'd7' });
  assert.equal(mig.length, 1);
  assert.equal(mig[0].code, 'bad-value');
  assert.equal(mig[0].field, 'mig');
});

test('a level outside 1 to 60, or not a number, reports bad-value on level', () => {
  for (const level of ['0', '61', 'ten']) {
    const errors = checkCreature({ level });
    assert.equal(errors.length, 1, level);
    assert.equal(errors[0].code, 'bad-value', level);
    assert.equal(errors[0].field, 'level', level);
  }
});

test('an invalid rank reports bad-value on rank', () => {
  const errors = checkCreature({ rank: 'boss' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'bad-value');
  assert.equal(errors[0].field, 'rank');
});

test('a non-number or zero hit points or magic defense reports bad-value', () => {
  for (const fields of [{ hp: 'many' }, { mdef: '0' }]) {
    const errors = checkCreature(fields);
    assert.equal(errors.length, 1, JSON.stringify(fields));
    assert.equal(errors[0].code, 'bad-value', JSON.stringify(fields));
  }
});

test('empty input has no errors', () => {
  assert.deepEqual(checkCreature({}), []);
});

test('numeric values work as well as strings', () => {
  assert.deepEqual(checkCreature({ level: 10, rank: 'Soldier', hp: 60, mig: 'd8' }), []);
});

test('codes helper reports the codes of a bad sheet', () => {
  assert.deepEqual(codes({ dex: 'd20', mdef: '0' }), ['bad-value', 'bad-value']);
});
