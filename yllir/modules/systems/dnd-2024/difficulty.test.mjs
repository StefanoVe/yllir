import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAdapter, pluginRootFromHere } from '../../../scripts/lib/adapter.mjs';
import { rateEncounter } from './difficulty.mjs';

const loaded = loadAdapter(pluginRootFromHere(), 'dnd-2024');
assert.deepEqual(loaded.errors, []);
const adapter = loaded.adapter;

const enemies = (...list) => list.map(([cr, count]) => ({ cr, count }));

describe('rateEncounter with the real D&D 2024 adapter', () => {
  test('four level-3 characters against four CR 1/2 enemies', () => {
    const result = rateEncounter(adapter, { party: [3, 3, 3, 3], enemies: enemies(['1/2', 4]) });
    assert.deepEqual(result, { ok: true, xp: 400, budgets: { low: 600, moderate: 900, high: 1600 }, band: 'low' });
  });

  test('trivial: XP below half of the low budget', () => {
    const result = rateEncounter(adapter, { party: [3, 3, 3, 3], enemies: enemies(['0', 1]) });
    assert.equal(result.ok, true);
    assert.equal(result.xp, 10);
    assert.equal(result.band, 'trivial');
  });

  test('moderate: XP above the low budget and within the moderate one', () => {
    const result = rateEncounter(adapter, { party: [3, 3, 3, 3], enemies: enemies(['2', 1], ['1', 1]) });
    assert.equal(result.xp, 650);
    assert.equal(result.band, 'moderate');
  });

  test('high: XP equal to the high budget is still high', () => {
    const result = rateEncounter(adapter, { party: [3, 3, 3, 3], enemies: enemies(['2', 2], ['3', 1]) });
    assert.equal(result.xp, 1600);
    assert.equal(result.budgets.high, 1600);
    assert.equal(result.band, 'high');
  });

  test('beyond: XP above the high budget', () => {
    const result = rateEncounter(adapter, { party: [3, 3, 3, 3], enemies: enemies(['5', 1]) });
    assert.equal(result.xp, 1800);
    assert.equal(result.band, 'beyond');
  });

  test('the budgets are the sum over the party, level by level', () => {
    const result = rateEncounter(adapter, { party: [1, 20], enemies: enemies(['0', 1]) });
    assert.deepEqual(result.budgets, { low: 50 + 6400, moderate: 75 + 13200, high: 100 + 22000 });
  });

  test('the input is not mutated and the adapter tables are unchanged', () => {
    const input = { party: [3, 3], enemies: enemies(['1/4', 2]) };
    const before = JSON.stringify({ input, table: adapter.difficulty });
    rateEncounter(adapter, input);
    assert.equal(JSON.stringify({ input, table: adapter.difficulty }), before);
  });

  test('error: empty party', () => {
    assert.equal(rateEncounter(adapter, { party: [], enemies: enemies(['1', 1]) }).error.code, 'empty-party');
  });

  test('error: bad character levels', () => {
    for (const level of [0, 21, 2.5, '3', null]) {
      const result = rateEncounter(adapter, { party: [3, level], enemies: enemies(['1', 1]) });
      assert.equal(result.ok, false, String(level));
      assert.equal(result.error.code, 'bad-level', String(level));
    }
  });

  test('error: challenge rating not in the table', () => {
    const result = rateEncounter(adapter, { party: [3], enemies: enemies(['1/3', 1]) });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'bad-cr');
  });

  test('error: enemy count not a positive whole number', () => {
    const result = rateEncounter(adapter, { party: [3], enemies: enemies(['1', 0]) });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'bad-count');
  });

  test('bad input never throws', () => {
    assert.equal(rateEncounter(adapter, undefined).ok, false);
    assert.equal(rateEncounter(adapter, { party: [3], enemies: [null] }).ok, false);
    assert.equal(rateEncounter(adapter, { party: [3], enemies: [{ cr: Symbol('x'), count: 1 }] }).ok, false);
  });

  test('an adapter without difficulty tables gives no-difficulty-rules', () => {
    assert.equal(rateEncounter({ id: 'none' }, { party: [3], enemies: enemies(['1', 1]) }).error.code, 'no-difficulty-rules');
  });
});
