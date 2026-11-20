import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initEncounter,
  startEncounter,
  endEncounter,
  recordEvent,
  advanceTurn,
  validateState,
  statSummary,
} from './encounter.mjs';

const NOW = '2026-11-12T10:00:00.000Z';
const ctx = { now: NOW };

const adapter = {
  conditions: ['slow', 'dazed', 'weak', 'shaken', 'enraged', 'poisoned'],
  condition_durations: ['until_removed'],
  condition_effects: { slow: ['dex'], dazed: ['ins'], weak: ['mig'], shaken: ['wlp'], enraged: ['dex', 'ins'], poisoned: ['mig', 'wlp'] },
  resources: [{ id: 'hp', recovery: 'rest' }, { id: 'mp', recovery: 'rest' }, { id: 'ip', recovery: 'rest' }],
  pools: [
    { id: 'fabula', owner: ['pc'], label: { it: 'Punti Fabula', en: 'Fabula Points' } },
    { id: 'ultima', owner: ['enemy'], label: { it: 'Punti Ultima', en: 'Ultima Points' } },
  ],
  creature_sheet: { required: [
    { id: 'level', label_it: 'Livello', label_en: 'Level' }, { id: 'rank', label_it: 'Grado', label_en: 'Rank' },
    { id: 'hp', label_it: 'PV', label_en: 'HP' }, { id: 'mp', label_it: 'PM', label_en: 'MP' },
    { id: 'dex', label_it: 'DES', label_en: 'DEX' }, { id: 'ins', label_it: 'INT', label_en: 'INS' },
    { id: 'mig', label_it: 'VIG', label_en: 'MIG' }, { id: 'wlp', label_it: 'VOL', label_en: 'WLP' },
    { id: 'def', label_it: 'Difesa', label_en: 'Defense' }, { id: 'mdef', label_it: 'Difesa Magica', label_en: 'Magic Defense' },
  ] },
};

// Shorthand: apply an op and fail the test when the rules refuse it.
function apply(state, op, a = adapter) {
  const result = recordEvent(a, state, op, ctx);
  assert.equal(result.ok, true, result.error?.message);
  return result.state;
}

// Shorthand: apply an op and return the whole result (state and notices).
function step(state, op, a = adapter) {
  const result = recordEvent(a, state, op, ctx);
  assert.equal(result.ok, true, result.error?.message);
  return result;
}

function refusal(state, op, a = adapter) {
  const result = recordEvent(a, state, op, ctx);
  assert.equal(result.ok, false);
  return result.error.code;
}

function fighting(ops = []) {
  let state = startEncounter(adapter, null, ctx).state;
  for (const op of ops) state = apply(state, op);
  return state;
}

// The name of the combatant who is up now.
const upName = (state) => state.combatants.find((c) => c.id === state.order[state.turn]).name;

// Gives `next` count times and returns the names that were up, in order.
function nexts(state, count) {
  const ups = [];
  let current = state;
  for (let i = 0; i < count; i++) {
    current = apply(current, { op: 'next' });
    ups.push(upName(current));
  }
  return { state: current, ups };
}

describe('initEncounter', () => {
  test('returns the empty inactive state, with no side due to act first', () => {
    assert.deepEqual(initEncounter(adapter), {
      active: false, round: 0, turn: 0, order: [], combatants: [], events: [], revision: 0, first: null,
    });
  });
});

describe('add', () => {
  test('assigns c-<n> ids, defaults hpMax to hp, and gives one turn with none used', () => {
    const state = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }, { op: 'add', name: 'Ilde', side: 'pc', hp: 20, hpMax: 24 }]);
    assert.deepEqual(state.combatants.map((c) => c.id), ['c-1', 'c-2']);
    assert.equal(state.combatants[0].hpMax, 7);
    assert.equal(state.combatants[1].hpMax, 24);
    assert.deepEqual(state.combatants[0].conditions, []);
    assert.equal(state.combatants[0].turns, 1);
    assert.equal(state.combatants[0].acted, 0);
  });

  test('accepts turns and keeps acted at 0', () => {
    const state = fighting([{ op: 'add', name: 'Champion', side: 'enemy', hp: 30, turns: 2 }]);
    assert.equal(state.combatants[0].turns, 2);
    assert.equal(state.combatants[0].acted, 0);
  });

  test('turns must be a whole number, one or more', () => {
    const state = fighting();
    assert.equal(refusal(state, { op: 'add', name: 'X', side: 'enemy', turns: 0 }), 'bad-value');
    assert.equal(refusal(state, { op: 'add', name: 'X', side: 'enemy', turns: 1.5 }), 'bad-value');
  });

  test('initiative may stay null and then sorts last, ties keep insertion order', () => {
    const state = fighting([
      { op: 'add', name: 'Late', side: 'enemy' },
      { op: 'add', name: 'Early', side: 'enemy', initiative: 18 },
      { op: 'add', name: 'Tie', side: 'pc', initiative: 18 },
    ]);
    assert.deepEqual(state.order, ['c-2', 'c-3', 'c-1']);
    assert.equal(state.combatants[0].initiative, null);
  });

  test('refuses an unknown side and a bad initiative value', () => {
    const state = fighting();
    assert.equal(refusal(state, { op: 'add', name: 'X', side: 'boss' }), 'bad-value');
    assert.equal(refusal(state, { op: 'add', name: 'X', side: 'enemy', initiative: 1.5 }), 'bad-value');
  });
});

describe('remove, initiative and turns', () => {
  test('remove drops the combatant from combatants and order', () => {
    const state = fighting([{ op: 'add', name: 'A', side: 'enemy', initiative: 10 }, { op: 'add', name: 'B', side: 'enemy', initiative: 5 }]);
    const next = apply(state, { op: 'remove', id: 'c-1' });
    assert.deepEqual(next.order, ['c-2']);
    assert.equal(next.combatants.length, 1);
  });

  test('changing initiative re-sorts the order and keeps the turn on the same combatant', () => {
    let state = fighting([
      { op: 'add', name: 'A', side: 'enemy', initiative: 20 },
      { op: 'add', name: 'B', side: 'enemy', initiative: 10 },
    ]);
    state = apply(state, { op: 'next' });
    assert.equal(state.order[state.turn], 'c-1');
    state = apply(state, { op: 'initiative', id: 'c-2', value: 25 });
    assert.deepEqual(state.order, ['c-2', 'c-1']);
    assert.equal(state.order[state.turn], 'c-1');
  });

  test('turns op sets the turns per round and says so in the history', () => {
    let state = fighting([{ op: 'add', name: 'Ogre', side: 'enemy', hp: 30 }]);
    state = apply(state, { op: 'turns', id: 'c-1', value: 2 });
    assert.equal(state.combatants[0].turns, 2);
    assert.equal(state.events.at(-1).text, 'Ogre has 2 turns per round');
  });

  test('turns op refuses an unknown id and a value below one', () => {
    const state = fighting([{ op: 'add', name: 'Ogre', side: 'enemy', hp: 30 }]);
    assert.equal(refusal(state, { op: 'turns', id: 'c-9', value: 2 }), 'unknown-combatant');
    assert.equal(refusal(state, { op: 'turns', id: 'c-1', value: 0 }), 'bad-value');
  });

  test('refuses an unknown combatant for initiative', () => {
    assert.equal(refusal(fighting(), { op: 'initiative', id: 'c-9', value: 2 }), 'unknown-combatant');
  });
});

describe('damage, defeat and healing', () => {
  test('hit points never go below 0 and an enemy at 0 is defeated', () => {
    const state = apply(fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]), { op: 'damage', id: 'c-1', amount: 50 });
    assert.equal(state.combatants[0].hp, 0);
    assert.equal(state.combatants[0].defeated, true);
    assert.equal(state.events.at(-1).text, 'Goblin 1 takes 50 damage (0 left) and is defeated');
  });

  test('a PC at 0 hp is defeated, with the defeated notice and never unconscious', () => {
    const result = step(fighting([{ op: 'add', name: 'Ilde', side: 'pc', hp: 5 }]), { op: 'damage', id: 'c-1', amount: 5 });
    const pc = result.state.combatants[0];
    assert.equal(pc.hp, 0);
    assert.equal(pc.defeated, true);
    assert.deepEqual(pc.conditions, []);
    assert.deepEqual(result.notices, [{ kind: 'defeated', id: 'c-1', name: 'Ilde' }]);
    assert.equal(result.state.events.at(-1).text, 'Ilde takes 5 damage (0 left) and is defeated');
    assert.equal(JSON.stringify(result.state).includes('unconscious'), false);
  });

  test('healing a PC above 0 clears defeated and never exceeds hpMax', () => {
    let state = apply(fighting([{ op: 'add', name: 'Ilde', side: 'pc', hp: 5, hpMax: 9 }]), { op: 'damage', id: 'c-1', amount: 9 });
    state = apply(state, { op: 'heal', id: 'c-1', amount: 100 });
    assert.equal(state.combatants[0].hp, 9);
    assert.equal(state.combatants[0].defeated, undefined);
    assert.equal(state.events.at(-1).text, 'Ilde heals 9 (9 left) and is no longer defeated');
  });

  test('healing an enemy above 0 clears defeated', () => {
    let state = apply(fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]), { op: 'damage', id: 'c-1', amount: 7 });
    assert.equal(state.combatants[0].defeated, true);
    state = apply(state, { op: 'heal', id: 'c-1', amount: 2 });
    assert.equal(state.combatants[0].hp, 2);
    assert.equal(state.combatants[0].defeated, undefined);
  });

  test('a combatant added at 0 hp is defeated at once and the notice says so', () => {
    const result = step(fighting(), { op: 'add', name: 'Cart', side: 'enemy', hp: 0 });
    assert.deepEqual(result.notices, [{ kind: 'defeated', id: 'c-1', name: 'Cart' }]);
  });

  test('damage and heal refuse a combatant without hit points and a zero amount', () => {
    const state = fighting([{ op: 'add', name: 'Cart', side: 'ally' }]);
    assert.equal(refusal(state, { op: 'damage', id: 'c-1', amount: 2 }), 'no-hp');
    const hurt = apply(fighting([{ op: 'add', name: 'Goblin', side: 'enemy', hp: 4 }]), { op: 'damage', id: 'c-1', amount: 1 });
    assert.equal(refusal(hurt, { op: 'damage', id: 'c-1', amount: 0 }), 'bad-amount');
    assert.equal(refusal(hurt, { op: 'heal', id: 'c-1', amount: -1 }), 'bad-amount');
  });

  test('the original state is not mutated', () => {
    const before = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]);
    const snapshot = JSON.stringify(before);
    apply(before, { op: 'damage', id: 'c-1', amount: 3 });
    assert.equal(JSON.stringify(before), snapshot);
  });

  test('every change increments revision', () => {
    const state = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]);
    const next = apply(state, { op: 'damage', id: 'c-1', amount: 1 });
    assert.equal(next.revision, state.revision + 1);
  });
});

describe('crisis', () => {
  test('damage that takes hp from above half of hpMax to half or less ends the line with "and is in crisis"', () => {
    const state = fighting([{ op: 'add', name: 'Gob', side: 'enemy', hp: 40 }]);
    const result = step(state, { op: 'damage', id: 'c-1', amount: 20 });
    assert.equal(result.state.events.at(-1).text, 'Gob takes 20 damage (20 left) and is in crisis');
    assert.deepEqual(result.notices, []);
    assert.equal('notice' in result.state.events.at(-1), false);
  });

  test('damage that leaves hp above half does not give crisis, and damage below half gives none either', () => {
    const above = apply(fighting([{ op: 'add', name: 'Gob', side: 'enemy', hp: 40 }]), { op: 'damage', id: 'c-1', amount: 19 });
    assert.equal(above.events.at(-1).text, 'Gob takes 19 damage (21 left)');
    const crossed = apply(above, { op: 'damage', id: 'c-1', amount: 5 });
    assert.equal(crossed.events.at(-1).text, 'Gob takes 5 damage (16 left) and is in crisis');
    const below = apply(crossed, { op: 'damage', id: 'c-1', amount: 5 });
    assert.equal(below.events.at(-1).text, 'Gob takes 5 damage (11 left)');
    assert.equal(below.events.at(-1).text.includes('crisis'), false);
  });

  test('damage to 0 is defeated, not crisis', () => {
    const state = apply(fighting([{ op: 'add', name: 'Gob', side: 'enemy', hp: 4 }]), { op: 'damage', id: 'c-1', amount: 4 });
    assert.equal(state.events.at(-1).text, 'Gob takes 4 damage (0 left) and is defeated');
  });
});

describe('conditions', () => {
  test('enraged lowers DEX and INS, and the line says so', () => {
    const state = apply(fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]), { op: 'condition-add', id: 'c-1', condition: 'enraged' });
    assert.deepEqual(state.combatants[0].conditions, [{ id: 'enraged', duration: 'until_removed' }]);
    assert.equal(state.events.at(-1).text, 'Goblin 1 gets enraged (until removed; lowers DEX and INS by one die size)');
  });

  test('slow lowers DEX by one die size and poisoned lowers MIG and WLP', () => {
    let state = apply(fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]), { op: 'condition-add', id: 'c-1', condition: 'slow' });
    assert.equal(state.events.at(-1).text, 'Goblin 1 gets slow (until removed; lowers DEX by one die size)');
    state = apply(state, { op: 'condition-add', id: 'c-1', condition: 'poisoned' });
    assert.equal(state.events.at(-1).text, 'Goblin 1 gets poisoned (until removed; lowers MIG and WLP by one die size)');
  });

  test('a condition with no effects entry gives the plain line', () => {
    const extended = { ...adapter, conditions: [...adapter.conditions, 'prone'] };
    const state = apply(fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]), { op: 'condition-add', id: 'c-1', condition: 'prone' }, extended);
    assert.equal(state.events.at(-1).text, 'Goblin 1 gets prone (until removed)');
  });

  test('an unknown condition is refused with unknown-condition', () => {
    const state = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]);
    assert.equal(refusal(state, { op: 'condition-add', id: 'c-1', condition: 'prone' }), 'unknown-condition');
  });

  test('only until_removed is a duration, and rounds is refused', () => {
    const state = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]);
    assert.equal(refusal(state, { op: 'condition-add', id: 'c-1', condition: 'slow', duration: 'rounds', rounds: 2 }), 'unknown-duration');
    assert.equal(refusal(state, { op: 'condition-add', id: 'c-1', condition: 'slow', duration: 'forever' }), 'unknown-duration');
  });

  test('condition-remove removes it, and refuses one that is not there', () => {
    let state = apply(fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]), { op: 'condition-add', id: 'c-1', condition: 'weak' });
    state = apply(state, { op: 'condition-remove', id: 'c-1', condition: 'weak' });
    assert.deepEqual(state.combatants[0].conditions, []);
    assert.equal(refusal(state, { op: 'condition-remove', id: 'c-1', condition: 'weak' }), 'condition-not-present');
  });
});

describe('resources and pools', () => {
  test('mp on an enemy is set by value, and a delta never takes a counter below 0', () => {
    let state = fighting([{ op: 'add', name: 'Mage', side: 'enemy', hp: 9, resources: { mp: 3 } }]);
    state = apply(state, { op: 'resource', id: 'c-1', resource: 'mp', delta: -2 });
    assert.equal(state.combatants[0].resources.mp, 1);
    state = apply(state, { op: 'resource', id: 'c-1', resource: 'mp', delta: -5 });
    assert.equal(state.combatants[0].resources.mp, 0);
    state = apply(state, { op: 'resource', id: 'c-1', resource: 'mp', value: 4 });
    assert.equal(state.combatants[0].resources.mp, 4);
  });

  test('ultima works on an enemy', () => {
    const state = apply(fighting([{ op: 'add', name: 'Dragon', side: 'enemy', hp: 90 }]), { op: 'resource', id: 'c-1', resource: 'ultima', value: 2 });
    assert.equal(state.combatants[0].resources.ultima, 2);
    assert.equal(state.events.at(-1).text, 'Dragon: ultima, 2 left');
  });

  test('ultima on a PC is refused with wrong-owner, and the line names the owner', () => {
    const state = fighting([{ op: 'add', name: 'Ilde', side: 'pc', hp: 20 }]);
    assert.equal(refusal(state, { op: 'resource', id: 'c-1', resource: 'ultima', value: 1 }), 'wrong-owner');
    const result = recordEvent(adapter, state, { op: 'resource', id: 'c-1', resource: 'ultima', value: 1 }, ctx);
    assert.equal(result.error.message, 'Ultima Points belong to enemy, not to Ilde');
  });

  test('fabula works on a PC, and on an enemy is refused with wrong-owner', () => {
    const state = fighting([{ op: 'add', name: 'Ilde', side: 'pc', hp: 20 }, { op: 'add', name: 'Goblin', side: 'enemy', hp: 5 }]);
    const next = apply(state, { op: 'resource', id: 'c-1', resource: 'fabula', value: 3 });
    assert.equal(next.combatants[0].resources.fabula, 3);
    assert.equal(next.events.at(-1).text, 'Ilde: fabula, 3 left');
    assert.equal(refusal(state, { op: 'resource', id: 'c-2', resource: 'fabula', value: 1 }), 'wrong-owner');
  });

  test('an unknown name is refused, hp is sent to damage or heal, and delta with value is refused', () => {
    const state = fighting([{ op: 'add', name: 'Mage', side: 'enemy', hp: 9 }]);
    assert.equal(refusal(state, { op: 'resource', id: 'c-1', resource: 'mana', delta: 1 }), 'unknown-resource');
    assert.equal(refusal(state, { op: 'resource', id: 'c-1', resource: 'temp_hp', delta: 1 }), 'unknown-resource');
    assert.equal(refusal(state, { op: 'resource', id: 'c-1', resource: 'hp', delta: 1 }), 'use-damage-or-heal');
    assert.equal(refusal(state, { op: 'resource', id: 'c-1', resource: 'mp' }), 'bad-value');
    assert.equal(refusal(state, { op: 'resource', id: 'c-1', resource: 'mp', delta: 1, value: 1 }), 'bad-value');
  });

  test('a note is set, and reveal makes the combatant visible', () => {
    let state = fighting([{ op: 'add', name: 'Ogre', side: 'enemy', hp: 30, hidden: true }]);
    assert.equal(state.combatants[0].hidden, true);
    state = apply(state, { op: 'note', id: 'c-1', text: 'Goes for the cart first' });
    state = apply(state, { op: 'reveal', id: 'c-1' });
    assert.equal(state.combatants[0].notes, 'Goes for the cart first');
    assert.equal(state.combatants[0].hidden, false);
    assert.equal(state.events.at(-1).text, 'Ogre is revealed');
  });
});

describe('turn order: alternation', () => {
  test('start sets active with round 0 and no first side yet', () => {
    const state = startEncounter(adapter, null, ctx).state;
    assert.equal(state.active, true);
    assert.equal(state.round, 0);
    assert.equal(state.first, null);
    assert.equal(state.revision, 1);
  });

  test('next refuses when no combat is running or it has no combatants', () => {
    assert.equal(recordEvent(adapter, initEncounter(adapter), { op: 'next' }, ctx).error.code, 'not-active');
    assert.equal(recordEvent(adapter, startEncounter(adapter, null, ctx).state, { op: 'next' }, ctx).error.code, 'no-combatants');
  });

  test('the first next starts round 1 with the first hero in order, first is heroes, and the notice says newRound', () => {
    const result = step(fighting([
      { op: 'add', name: 'Goblin', side: 'enemy', initiative: 20, hp: 3 },
      { op: 'add', name: 'Ilde', side: 'pc', initiative: 10, hp: 9 },
      { op: 'add', name: 'Ro', side: 'ally', initiative: 5, hp: 9 },
    ]), { op: 'next' });
    assert.equal(result.state.round, 1);
    assert.equal(result.state.first, 'heroes');
    assert.equal(upName(result.state), 'Ilde');
    assert.equal(result.state.events.at(-1).text, 'Round 1: Ilde is up');
    assert.deepEqual(result.notices, [{ kind: 'turn', id: 'c-2', name: 'Ilde', round: 1, newRound: true }]);
  });

  test('with no hero able to act, the first side is the enemies', () => {
    const state = apply(fighting([{ op: 'add', name: 'Goblin', side: 'enemy', hp: 3 }]), { op: 'next' });
    assert.equal(state.first, 'enemies');
    assert.equal(upName(state), 'Goblin');
  });

  test('heroes H1, H2 and enemies E1, E2 alternate, then round 2 starts with H1', () => {
    let state = fighting([
      { op: 'add', name: 'H1', side: 'pc', hp: 9 },
      { op: 'add', name: 'H2', side: 'pc', hp: 9 },
      { op: 'add', name: 'E1', side: 'enemy', hp: 9 },
      { op: 'add', name: 'E2', side: 'enemy', hp: 9 },
    ]);
    const first = nexts(state, 4);
    assert.deepEqual(first.ups, ['H1', 'E1', 'H2', 'E2']);
    assert.equal(first.state.round, 1);
    const wrapped = step(first.state, { op: 'next' });
    assert.equal(upName(wrapped.state), 'H1');
    assert.equal(wrapped.state.round, 2);
    assert.deepEqual(wrapped.notices, [{ kind: 'turn', id: 'c-1', name: 'H1', round: 2, newRound: true }]);
    assert.equal(wrapped.state.events.at(-1).text, 'Round 2: H1 is up');
  });

  test('uneven sides: when the heroes are done, the enemies keep acting: H1, E1, E2, then round 2 with H1', () => {
    const state = fighting([
      { op: 'add', name: 'H1', side: 'pc', hp: 9 },
      { op: 'add', name: 'E1', side: 'enemy', hp: 9 },
      { op: 'add', name: 'E2', side: 'enemy', hp: 9 },
    ]);
    const { state: after, ups } = nexts(state, 4);
    assert.deepEqual(ups, ['H1', 'E1', 'E2', 'H1']);
    assert.equal(after.round, 2);
  });

  test('champion with two turns: H1, E1, H2, E1, then round 2', () => {
    let state = fighting([
      { op: 'add', name: 'H1', side: 'pc', hp: 9 },
      { op: 'add', name: 'H2', side: 'pc', hp: 9 },
      { op: 'add', name: 'E1', side: 'enemy', hp: 30, turns: 2 },
    ]);
    const { state: after, ups } = nexts(state, 5);
    assert.deepEqual(ups.slice(0, 4), ['H1', 'E1', 'H2', 'E1']);
    assert.equal(ups[4], 'H1');
    assert.equal(after.round, 2);
    assert.equal(after.combatants[2].acted, 0);
  });

  test('defeated combatants are skipped and do not take a turn', () => {
    let state = fighting([
      { op: 'add', name: 'H1', side: 'pc', hp: 3 },
      { op: 'add', name: 'E1', side: 'enemy', hp: 3 },
      { op: 'add', name: 'H2', side: 'pc', hp: 3 },
    ]);
    state = apply(state, { op: 'damage', id: 'c-1', amount: 3 });
    const { state: after, ups } = nexts(state, 3);
    assert.deepEqual(ups, ['H2', 'E1', 'H2']);
    assert.equal(after.round, 2);
  });

  test('all defeated refuses to advance', () => {
    let state = fighting([{ op: 'add', name: 'A', side: 'enemy', hp: 3 }]);
    state = apply(state, { op: 'damage', id: 'c-1', amount: 3 });
    assert.equal(refusal(state, { op: 'next' }), 'no-living-combatants');
  });

  test('nothing ticks at the end of a turn: statuses stay until removed', () => {
    let state = fighting([
      { op: 'add', name: 'A', side: 'enemy', hp: 3 },
      { op: 'add', name: 'B', side: 'pc', hp: 3 },
    ]);
    state = apply(state, { op: 'next' });
    state = apply(state, { op: 'condition-add', id: 'c-1', condition: 'poisoned' });
    state = apply(state, { op: 'next' });
    state = apply(state, { op: 'next' });
    assert.deepEqual(state.combatants[0].conditions, [{ id: 'poisoned', duration: 'until_removed' }]);
  });

  test('resources are not refilled by the tracker when the turn or the round passes', () => {
    let state = fighting([{ op: 'add', name: 'Mage', side: 'enemy', hp: 3, resources: { mp: 3 } }]);
    state = apply(state, { op: 'resource', id: 'c-1', resource: 'mp', delta: -2 });
    state = apply(state, { op: 'next' });
    state = apply(state, { op: 'next' });
    assert.equal(state.combatants[0].resources.mp, 1);
  });
});

describe('turn order: chosen combatant', () => {
  test('next with the id of an enemy at the start makes that enemy up and first is enemies', () => {
    let state = fighting([
      { op: 'add', name: 'H1', side: 'pc', hp: 9 },
      { op: 'add', name: 'E1', side: 'enemy', hp: 9 },
    ]);
    state = apply(state, { op: 'next', id: 'c-2' });
    assert.equal(upName(state), 'E1');
    assert.equal(state.first, 'enemies');
    assert.equal(state.round, 1);
  });

  test('an id on the wrong side is refused with wrong-side, and nothing changes', () => {
    let state = fighting([
      { op: 'add', name: 'H1', side: 'pc', hp: 9 },
      { op: 'add', name: 'E1', side: 'enemy', hp: 9 },
      { op: 'add', name: 'E2', side: 'enemy', hp: 9 },
    ]);
    state = apply(state, { op: 'next', id: 'c-2' });
    const snapshot = JSON.stringify(state);
    assert.equal(refusal(state, { op: 'next', id: 'c-3' }), 'wrong-side');
    const result = recordEvent(adapter, state, { op: 'next', id: 'c-3' }, ctx);
    assert.equal(result.error.message, 'it is the turn of the heroes: E2 cannot act now');
    assert.equal(JSON.stringify(state), snapshot);
  });

  test('an id that has used its turn, on its own side, is refused with no-turns-left', () => {
    let state = fighting([
      { op: 'add', name: 'H1', side: 'pc', hp: 9 },
      { op: 'add', name: 'H2', side: 'pc', hp: 9 },
      { op: 'add', name: 'E1', side: 'enemy', hp: 9 },
    ]);
    state = apply(state, { op: 'next', id: 'c-1' }); // H1 acts
    state = apply(state, { op: 'next' }); // E1 acts
    assert.equal(upName(state), 'E1');
    assert.equal(state.combatants[0].acted, 1);
    assert.equal(refusal(state, { op: 'next', id: 'c-1' }), 'no-turns-left');
    assert.equal(refusal(state, { op: 'next', id: 'c-3' }), 'no-turns-left');
  });

  test('a chosen id that is on the side due to act moves the turn to it', () => {
    let state = fighting([
      { op: 'add', name: 'H1', side: 'pc', hp: 9 },
      { op: 'add', name: 'H2', side: 'pc', hp: 9 },
      { op: 'add', name: 'E1', side: 'enemy', hp: 9 },
    ]);
    state = apply(state, { op: 'next' }); // H1
    state = apply(state, { op: 'next' }); // E1
    state = apply(state, { op: 'next', id: 'c-2' }); // H2 is due: chosen
    assert.equal(upName(state), 'H2');
    assert.equal(state.first, 'heroes');
  });

  test('an unknown id is refused with unknown-combatant', () => {
    const state = fighting([{ op: 'add', name: 'H1', side: 'pc', hp: 9 }]);
    assert.equal(refusal(state, { op: 'next', id: 'c-99' }), 'unknown-combatant');
  });
});

describe('start and end', () => {
  test('end keeps the state for the log and marks it inactive', () => {
    let state = fighting([{ op: 'add', name: 'A', side: 'enemy', hp: 3 }]);
    state = apply(state, { op: 'next' });
    const ended = endEncounter(adapter, state, ctx);
    assert.equal(ended.state.active, false);
    assert.equal(ended.state.combatants.length, 1);
    assert.equal(ended.state.events.at(-1).text, 'Combat ends in round 1');
    assert.equal(endEncounter(adapter, ended.state, ctx).error.code, 'not-active');
  });

  test('start resets the combat and keeps the revision counting up', () => {
    const first = fighting([{ op: 'add', name: 'A', side: 'enemy', hp: 3 }]);
    const ended = endEncounter(adapter, first, ctx).state;
    const second = startEncounter(adapter, ended, ctx).state;
    assert.deepEqual(second.combatants, []);
    assert.equal(second.active, true);
    assert.equal(second.first, null);
    assert.equal(second.revision, ended.revision + 1);
  });
});

describe('events and history', () => {
  test('lines read in plain language', () => {
    const state = fighting([
      { op: 'add', name: 'Goblin 1', side: 'enemy', hp: 12, initiative: 14 },
      { op: 'damage', id: 'c-1', amount: 5 },
    ]);
    assert.equal(state.events.at(-1).text, 'Goblin 1 takes 5 damage (7 left)');
    assert.equal(state.events.at(-1).at, NOW);
  });

  test('the history is capped at 200 lines, newest last', () => {
    let state = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 500 }]);
    for (let i = 0; i < 250; i++) state = apply(state, { op: 'heal', id: 'c-1', amount: 1 });
    assert.equal(state.events.length, 200);
    assert.match(state.events.at(-1).text, /^Goblin 1 is already at full hit points|^Goblin 1 heals/);
  });

  test('a change with nothing automatic has no notices and its line has no notice field', () => {
    const state = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]);
    const result = step(state, { op: 'damage', id: 'c-1', amount: 2 });
    assert.deepEqual(result.notices, []);
    assert.equal('notice' in result.state.events.at(-1), false);
  });

  test('a defeated enemy that takes more damage is not reported again', () => {
    const state = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 3 }, { op: 'damage', id: 'c-1', amount: 3 }]);
    assert.deepEqual(step(state, { op: 'damage', id: 'c-1', amount: 1 }).notices, []);
  });

  test('a turn notice is saved on its line and returned with the result', () => {
    let state = fighting([
      { op: 'add', name: 'H1', side: 'pc', hp: 9 },
      { op: 'add', name: 'E1', side: 'enemy', hp: 9 },
    ]);
    state = apply(state, { op: 'next' });
    const result = step(state, { op: 'next' });
    assert.deepEqual(result.notices, [{ kind: 'turn', id: 'c-2', name: 'E1', round: 1, newRound: false }]);
    assert.deepEqual(result.state.events.at(-1).notice, { kind: 'turn', id: 'c-2', name: 'E1', round: 1, newRound: false });
    assert.equal(result.state.events.at(-1).text, 'E1 is up');
  });
});

describe('validateState', () => {
  test('a valid state has no problems', () => {
    const state = fighting([{ op: 'add', name: 'A', side: 'enemy', initiative: 5, hp: 3 }]);
    assert.deepEqual(validateState(adapter, state), []);
  });

  test('reports each kind of problem', () => {
    const state = fighting([{ op: 'add', name: 'A', side: 'enemy', initiative: 5, hp: 3 }]);
    const codes = (bad) => validateState(adapter, bad).map((e) => e.code);
    assert.ok(codes({ ...state, combatants: [state.combatants[0], { ...state.combatants[0] }] }).includes('duplicate-id'));
    assert.ok(codes({ ...state, order: [] }).includes('order-mismatch'));
    assert.ok(codes({ ...state, order: ['c-1', 'c-9'] }).includes('order-mismatch'));
    assert.ok(codes({ ...state, combatants: [{ ...state.combatants[0], conditions: [{ id: 'dazed', duration: 'rounds', rounds: 2 }] }] }).includes('unknown-duration'));
    assert.ok(codes({ ...state, combatants: [{ ...state.combatants[0], conditions: [{ id: 'prone', duration: 'until_removed' }] }] }).includes('unknown-condition'));
    assert.ok(codes({ ...state, combatants: [{ ...state.combatants[0], hp: -1 }] }).includes('negative-hp'));
    assert.ok(codes({ ...state, round: -1 }).includes('negative-round'));
    assert.ok(codes({ ...state, active: true, turn: 4 }).includes('turn-out-of-range'));
  });

  test('bad turns and acted values are reported as bad-turns', () => {
    const state = fighting([{ op: 'add', name: 'A', side: 'enemy', hp: 3 }]);
    const withCombatant = (patch) => ({ ...state, combatants: [{ ...state.combatants[0], ...patch }] });
    assert.ok(validateState(adapter, withCombatant({ turns: 0 })).some((e) => e.code === 'bad-turns'));
    assert.ok(validateState(adapter, withCombatant({ turns: 1.5 })).some((e) => e.code === 'bad-turns'));
    assert.ok(validateState(adapter, withCombatant({ acted: -1 })).some((e) => e.code === 'bad-turns'));
    assert.deepEqual(validateState(adapter, withCombatant({ turns: 2, acted: 0 })), []);
  });

  test('first must be null, heroes or enemies', () => {
    const state = fighting([{ op: 'add', name: 'A', side: 'enemy', hp: 3 }]);
    assert.ok(validateState(adapter, { ...state, first: 'pcs' }).some((e) => e.code === 'bad-first'));
    assert.deepEqual(validateState(adapter, { ...state, first: 'enemies' }), []);
    assert.deepEqual(validateState(adapter, { ...state, first: 'heroes' }), []);
  });

  test('a state made by the rules is always valid', () => {
    let state = fighting([
      { op: 'add', name: 'A', side: 'enemy', initiative: 20, hp: 3, turns: 2 },
      { op: 'add', name: 'Ilde', side: 'pc', initiative: 10, hp: 4 },
    ]);
    state = apply(state, { op: 'damage', id: 'c-2', amount: 9 });
    state = apply(state, { op: 'condition-add', id: 'c-1', condition: 'enraged' });
    state = apply(state, { op: 'next' });
    state = apply(state, { op: 'next' });
    state = apply(state, { op: 'next' });
    state = apply(state, { op: 'remove', id: 'c-2' });
    assert.deepEqual(validateState(adapter, state), []);
  });
});

describe('statSummary (Fabula Ultima)', () => {
  const adapterWithTable = { ...adapter, action_table: ['Attacchi e capacità'] };

  const SHEET = `---
id: guardiano-sintetico
kind: creature
template: enemy
---
# Guardiano sintetico

## Statistiche

### Caratteristiche

| Caratteristica | Valore |
| --- | --- |
| Livello | 10 |
| Grado | Élite |
| PV | 120 |
| PM | 40 |
| DES | d8 |
| INT | d10 |
| VIG | d8 |
| VOL | d6 |
| Difesa | 8 |
| Difesa Magica | 10 |

### Attacchi e capacità

| Attacco o capacità | Dettagli |
| --- | --- |
| Lancia | Attacco: d8 danni perforanti. |
`;

  test('the lines come in the Fabula Ultima field order, with the field ids', () => {
    assert.deepEqual(statSummary(adapterWithTable, SHEET).lines, [
      { id: 'level', label: 'Livello', value: '10' },
      { id: 'rank', label: 'Grado', value: 'Élite' },
      { id: 'hp', label: 'PV', value: '120' },
      { id: 'mp', label: 'PM', value: '40' },
      { id: 'dex', label: 'DES', value: 'd8' },
      { id: 'ins', label: 'INT', value: 'd10' },
      { id: 'mig', label: 'VIG', value: 'd8' },
      { id: 'wlp', label: 'VOL', value: 'd6' },
      { id: 'def', label: 'Difesa', value: '8' },
      { id: 'mdef', label: 'Difesa Magica', value: '10' },
    ]);
  });

  test('the attacks table gives one action with group actions and timing own_turn', () => {
    assert.deepEqual(statSummary(adapterWithTable, SHEET).actions, [
      { name: 'Lancia', text: 'Attacco: d8 danni perforanti.', group: 'actions', timing: 'own_turn' },
    ]);
  });

  test('without action_table in the adapter the table gives no actions', () => {
    assert.deepEqual(statSummary(adapter, SHEET).actions, []);
  });

  test('the D&D-only labels give no lines', () => {
    const sheet = '### Caratteristiche\n\n| Caratteristica | Valore |\n| --- | --- |\n| Iniziativa | +1 |\n| GS | 2 |\n| CA | 15 |\n';
    assert.deepEqual(statSummary(adapter, sheet).lines, []);
  });

  test('garbage input never throws and gives empty lists', () => {
    const empty = { lines: [], actions: [] };
    assert.deepEqual(statSummary(adapter, undefined), empty);
    assert.deepEqual(statSummary(adapter, null), empty);
    assert.deepEqual(statSummary(adapter, ''), empty);
    assert.deepEqual(statSummary(adapter, {}), empty);
    assert.deepEqual(statSummary(undefined, '| DES | d8 |'), empty);
  });
});
