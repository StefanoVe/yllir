import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { rateEncounter } from './difficulty.mjs';

const adapter = { difficulty: { level_offsets: { easy: 0, normal: 5, hard: 10 } } };

describe('rateEncounter', () => {
  test('same level, more enemies than characters: normal', () => {
    const result = rateEncounter(adapter, { party: [10, 10, 10, 10], enemies: [{ level: '15', rank: 'Soldier', count: 4 }] });
    assert.deepEqual(result, {
      ok: true,
      band: 'normal',
      xp: null,
      budgets: null,
      detail: { partyLevel: 10, partySize: 4, enemyLevel: 15, offset: 5, levelBand: 'normal', weight: 4, countBand: 'normal' },
    });
  });

  test('same level, fewer enemies: easy', () => {
    const result = rateEncounter(adapter, { party: [10, 10, 10, 10], enemies: [{ level: '10', rank: 'Soldier', count: 2 }] });
    assert.equal(result.ok, true);
    assert.equal(result.band, 'easy');
    assert.equal(result.detail.offset, 0);
    assert.equal(result.detail.weight, 2);
  });

  test('elite and soldier at level 20 against four characters: hard, because of the level', () => {
    const result = rateEncounter(adapter, {
      party: [10, 10, 10, 10],
      enemies: [{ level: '20', rank: 'Elite', count: 1 }, { level: '20', rank: 'Soldier', count: 1 }],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.detail, {
      partyLevel: 10, partySize: 4, enemyLevel: 20, offset: 10, levelBand: 'hard', weight: 3, countBand: 'easy',
    });
    assert.equal(result.band, 'hard');
  });

  test('champion 4 below the party level, but more soldier equivalents than characters: hard, because of the count', () => {
    const result = rateEncounter(adapter, { party: [10, 11, 12], enemies: [{ level: '10', rank: 'Campione 4', count: 1 }] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.detail, {
      partyLevel: 11, partySize: 3, enemyLevel: 10, offset: -1, levelBand: 'easy', weight: 4, countBand: 'hard',
    });
    assert.equal(result.band, 'hard');
  });

  test('elite at level 22 against two level-20 characters: normal, because of the count', () => {
    const result = rateEncounter(adapter, { party: [20, 20], enemies: [{ level: '22', rank: 'Élite', count: 1 }] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.detail, {
      partyLevel: 20, partySize: 2, enemyLevel: 22, offset: 2, levelBand: 'easy', weight: 2, countBand: 'normal',
    });
    assert.equal(result.band, 'normal');
  });

  test('errors: empty party', () => {
    const result = rateEncounter(adapter, { party: [], enemies: [{ level: '10', rank: 'Soldier', count: 1 }] });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'empty-party');
  });

  test('errors: character level out of range', () => {
    const result = rateEncounter(adapter, { party: [0], enemies: [{ level: '10', rank: 'Soldier', count: 1 }] });
    assert.equal(result.error.code, 'bad-level');
  });

  test('errors: enemy level not a number', () => {
    const result = rateEncounter(adapter, { party: [10], enemies: [{ level: 'ten', rank: 'Soldier', count: 1 }] });
    assert.equal(result.error.code, 'bad-level');
  });

  test('errors: unknown enemy rank', () => {
    const result = rateEncounter(adapter, { party: [10], enemies: [{ level: '10', rank: 'boss', count: 1 }] });
    assert.equal(result.error.code, 'bad-rank');
  });

  test('errors: enemy count below 1', () => {
    const result = rateEncounter(adapter, { party: [10], enemies: [{ level: '10', rank: 'Soldier', count: 0 }] });
    assert.equal(result.error.code, 'bad-count');
  });

  test('errors: adapter without level_offsets', () => {
    const result = rateEncounter({}, { party: [10], enemies: [{ level: '10', rank: 'Soldier', count: 1 }] });
    assert.equal(result.error.code, 'no-difficulty-rules');
  });

  test('the input is not mutated', () => {
    const input = { party: [10, 12], enemies: [{ level: '14', rank: 'Elite', count: 2, cr: '1' }] };
    const before = structuredClone(input);
    rateEncounter(adapter, input);
    assert.deepEqual(input, before);
  });
});
