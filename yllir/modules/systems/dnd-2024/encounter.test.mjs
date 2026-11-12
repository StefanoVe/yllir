import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlLite } from '../../../scripts/lib/yaml-lite.mjs';
import {
  initEncounter,
  startEncounter,
  endEncounter,
  recordEvent,
  advanceTurn,
  validateState,
  statSummary,
} from './encounter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL = parseYamlLite(fs.readFileSync(path.join(HERE, 'adapter.yaml'), 'utf8')).data;
const NOW = '2026-11-12T10:00:00.000Z';
const ctx = { now: NOW };

// Shorthand: apply an op and fail the test when the rules refuse it.
function apply(state, op, adapter = REAL) {
  const result = recordEvent(adapter, state, op, ctx);
  assert.equal(result.ok, true, result.error?.message);
  return result.state;
}

function refusal(state, op, adapter = REAL) {
  const result = recordEvent(adapter, state, op, ctx);
  assert.equal(result.ok, false);
  return result.error.code;
}

function fighting(ops = []) {
  let state = startEncounter(REAL, null, ctx).state;
  for (const op of ops) state = apply(state, op);
  return state;
}

describe('initEncounter', () => {
  test('returns the empty inactive state', () => {
    assert.deepEqual(initEncounter(REAL), {
      active: false, round: 0, turn: 0, order: [], combatants: [], events: [], revision: 0,
    });
  });
});

describe('adapter setting', () => {
  test('the adapter names its encounter rules file and the real adapter still provides its condition lists', () => {
    assert.equal(REAL.encounter_ops, 'encounter.mjs');
    assert.ok(REAL.conditions.includes('unconscious'));
    assert.ok(REAL.condition_durations.includes('rounds'));
    assert.ok(REAL.resources.some((r) => r.id === 'spell_slots'));
  });
});

describe('add', () => {
  test('assigns c-<n> ids and defaults hpMax to hp', () => {
    const state = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }, { op: 'add', name: 'Ilde', side: 'pc', hp: 20, hpMax: 24 }]);
    assert.deepEqual(state.combatants.map((c) => c.id), ['c-1', 'c-2']);
    assert.equal(state.combatants[0].hpMax, 7);
    assert.equal(state.combatants[1].hpMax, 24);
    assert.deepEqual(state.combatants[0].conditions, []);
  });

  test('initiative may stay null and then sorts last', () => {
    const state = fighting([
      { op: 'add', name: 'Late', side: 'enemy' },
      { op: 'add', name: 'Early', side: 'enemy', initiative: 18 },
    ]);
    assert.deepEqual(state.order, ['c-2', 'c-1']);
    assert.equal(state.combatants[0].initiative, null);
  });

  test('ties keep insertion order', () => {
    const state = fighting([
      { op: 'add', name: 'A', side: 'enemy', initiative: 15 },
      { op: 'add', name: 'B', side: 'enemy', initiative: 15 },
      { op: 'add', name: 'C', side: 'pc', initiative: 15 },
    ]);
    assert.deepEqual(state.order, ['c-1', 'c-2', 'c-3']);
  });

  test('a new combatant before the combat starts still gets a sorted order', () => {
    const base = initEncounter(REAL);
    const state = apply(base, { op: 'add', name: 'Low', side: 'enemy', initiative: 3 });
    const higher = apply(state, { op: 'add', name: 'High', side: 'enemy', initiative: 10 });
    assert.deepEqual(higher.order, ['c-2', 'c-1']);
  });

  test('refuses an unknown side and a bad initiative value', () => {
    const state = fighting();
    assert.equal(refusal(state, { op: 'add', name: 'X', side: 'boss' }), 'bad-value');
    assert.equal(refusal(state, { op: 'add', name: 'X', side: 'enemy', initiative: 1.5 }), 'bad-value');
  });
});

describe('remove and initiative', () => {
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

  test('refuses an unknown combatant', () => {
    assert.equal(refusal(fighting(), { op: 'initiative', id: 'c-9', value: 2 }), 'unknown-combatant');
  });
});

describe('damage and healing', () => {
  test('temporary hit points absorb damage first, then hit points', () => {
    let state = fighting([{ op: 'add', name: 'Ilde', side: 'pc', hp: 10 }]);
    state.combatants[0].tempHp = 4; // set by a previous state, as the adapter would keep it
    state = apply(state, { op: 'damage', id: 'c-1', amount: 6 });
    assert.equal(state.combatants[0].tempHp, 0);
    assert.equal(state.combatants[0].hp, 8);
    assert.match(state.events.at(-1).text, /absorbed by temporary hit points/);
  });

  test('hit points never go below 0 and an enemy at 0 is defeated', () => {
    const state = apply(fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]), { op: 'damage', id: 'c-1', amount: 50 });
    assert.equal(state.combatants[0].hp, 0);
    assert.equal(state.combatants[0].defeated, true);
    assert.equal(state.events.at(-1).text, 'Goblin 1 takes 50 damage (0 left) and is defeated');
  });

  test('a PC at 0 hp falls unconscious and is NOT defeated (no death saves are rolled)', () => {
    const state = apply(fighting([{ op: 'add', name: 'Ilde', side: 'pc', hp: 5 }]), { op: 'damage', id: 'c-1', amount: 5 });
    const pc = state.combatants[0];
    assert.equal(pc.hp, 0);
    assert.equal(pc.defeated, undefined);
    assert.deepEqual(pc.conditions, [{ id: 'unconscious', duration: 'until_removed' }]);
    assert.match(state.events.at(-1).text, /falls unconscious/);
  });

  test('healing a PC above 0 removes unconscious and never exceeds hpMax', () => {
    let state = apply(fighting([{ op: 'add', name: 'Ilde', side: 'pc', hp: 5, hpMax: 9 }]), { op: 'damage', id: 'c-1', amount: 9 });
    state = apply(state, { op: 'heal', id: 'c-1', amount: 100 });
    assert.equal(state.combatants[0].hp, 9);
    assert.deepEqual(state.combatants[0].conditions, []);
  });

  test('healing an enemy above 0 clears defeated', () => {
    let state = apply(fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]), { op: 'damage', id: 'c-1', amount: 7 });
    assert.equal(state.combatants[0].defeated, true);
    state = apply(state, { op: 'heal', id: 'c-1', amount: 2 });
    assert.equal(state.combatants[0].hp, 2);
    assert.equal(state.combatants[0].defeated, undefined);
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

describe('conditions', () => {
  test('refuses an unknown condition with code unknown-condition', () => {
    const state = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]);
    assert.equal(refusal(state, { op: 'condition-add', id: 'c-1', condition: 'dazed' }), 'unknown-condition');
  });

  test('duration defaults to until_removed, rounds need a number of at least one', () => {
    let state = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]);
    state = apply(state, { op: 'condition-add', id: 'c-1', condition: 'prone' });
    assert.deepEqual(state.combatants[0].conditions, [{ id: 'prone', duration: 'until_removed' }]);
    assert.equal(refusal(state, { op: 'condition-add', id: 'c-1', condition: 'poisoned', duration: 'rounds' }), 'bad-rounds');
    assert.equal(refusal(state, { op: 'condition-add', id: 'c-1', condition: 'poisoned', duration: 'rounds', rounds: 0 }), 'bad-rounds');
    assert.equal(refusal(state, { op: 'condition-add', id: 'c-1', condition: 'poisoned', duration: 'forever' }), 'unknown-duration');
  });

  test('adding the same condition again replaces it', () => {
    let state = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]);
    state = apply(state, { op: 'condition-add', id: 'c-1', condition: 'poisoned', duration: 'rounds', rounds: 2 });
    state = apply(state, { op: 'condition-add', id: 'c-1', condition: 'poisoned', duration: 'rounds', rounds: 5 });
    assert.deepEqual(state.combatants[0].conditions, [{ id: 'poisoned', duration: 'rounds', rounds: 5 }]);
  });

  test('condition-remove removes it, and refuses one that is not there', () => {
    let state = fighting([{ op: 'add', name: 'Goblin 1', side: 'enemy', hp: 7 }]);
    state = apply(state, { op: 'condition-add', id: 'c-1', condition: 'prone' });
    state = apply(state, { op: 'condition-remove', id: 'c-1', condition: 'prone' });
    assert.deepEqual(state.combatants[0].conditions, []);
    assert.equal(refusal(state, { op: 'condition-remove', id: 'c-1', condition: 'prone' }), 'condition-not-present');
  });
});

describe('resources, notes and reveal', () => {
  test('a resource is set by value or changed by delta and never goes negative', () => {
    let state = fighting([{ op: 'add', name: 'Mage', side: 'enemy', hp: 9, resources: { spell_slots: 3 } }]);
    state = apply(state, { op: 'resource', id: 'c-1', resource: 'spell_slots', delta: -2 });
    assert.equal(state.combatants[0].resources.spell_slots, 1);
    state = apply(state, { op: 'resource', id: 'c-1', resource: 'spell_slots', delta: -5 });
    assert.equal(state.combatants[0].resources.spell_slots, 0);
    state = apply(state, { op: 'resource', id: 'c-1', resource: 'spell_slots', value: 2 });
    assert.equal(state.combatants[0].resources.spell_slots, 2);
  });

  test('resource refuses hp, unknown names and having both or neither of delta and value', () => {
    const state = fighting([{ op: 'add', name: 'Mage', side: 'enemy', hp: 9 }]);
    assert.equal(refusal(state, { op: 'resource', id: 'c-1', resource: 'hp', delta: 1 }), 'use-damage-or-heal');
    assert.equal(refusal(state, { op: 'resource', id: 'c-1', resource: 'mana', delta: 1 }), 'unknown-resource');
    assert.equal(refusal(state, { op: 'resource', id: 'c-1', resource: 'spell_slots' }), 'bad-value');
    assert.equal(refusal(state, { op: 'resource', id: 'c-1', resource: 'spell_slots', delta: 1, value: 1 }), 'bad-value');
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

describe('turn order', () => {
  test('start is handled by startEncounter and sets active with round 0', () => {
    const state = startEncounter(REAL, null, ctx).state;
    assert.equal(state.active, true);
    assert.equal(state.round, 0);
    assert.equal(state.revision, 1);
  });

  test('the first next sets round 1 and turn 0', () => {
    const state = advanceTurn(REAL, fighting([{ op: 'add', name: 'A', side: 'enemy', initiative: 10, hp: 3 }]), ctx);
    assert.equal(state.ok, true);
    assert.equal(state.state.round, 1);
    assert.equal(state.state.turn, 0);
  });

  test('next refuses when no combat is running or it has no combatants', () => {
    assert.equal(recordEvent(REAL, initEncounter(REAL), { op: 'next' }, ctx).error.code, 'not-active');
    assert.equal(recordEvent(REAL, startEncounter(REAL, null, ctx).state, { op: 'next' }, ctx).error.code, 'no-combatants');
  });

  test('defeated combatants are skipped', () => {
    let state = fighting([
      { op: 'add', name: 'A', side: 'enemy', initiative: 20, hp: 3 },
      { op: 'add', name: 'B', side: 'enemy', initiative: 15, hp: 3 },
      { op: 'add', name: 'C', side: 'pc', initiative: 10, hp: 3 },
    ]);
    state = apply(state, { op: 'damage', id: 'c-2', amount: 3 });
    state = apply(state, { op: 'next' }); // A
    state = apply(state, { op: 'next' }); // B is defeated: C
    assert.equal(state.order[state.turn], 'c-3');
    assert.equal(state.round, 1);
  });

  test('wraps to the next round after the last combatant', () => {
    let state = fighting([
      { op: 'add', name: 'A', side: 'enemy', initiative: 20, hp: 3 },
      { op: 'add', name: 'B', side: 'enemy', initiative: 10, hp: 3 },
    ]);
    state = apply(state, { op: 'next' });
    state = apply(state, { op: 'next' });
    assert.equal(state.round, 1);
    state = apply(state, { op: 'next' });
    assert.equal(state.round, 2);
    assert.equal(state.turn, 0);
    assert.match(state.events.at(-1).text, /^Round 2: A is up$/);
  });

  test('all defeated refuses to advance', () => {
    let state = fighting([{ op: 'add', name: 'A', side: 'enemy', initiative: 20, hp: 3 }]);
    state = apply(state, { op: 'damage', id: 'c-1', amount: 3 });
    assert.equal(refusal(state, { op: 'next' }), 'no-living-combatants');
  });

  test('ticks end_of_turn conditions and rounds conditions at the end of the bearer turn only', () => {
    let state = fighting([
      { op: 'add', name: 'A', side: 'enemy', initiative: 20, hp: 3 },
      { op: 'add', name: 'B', side: 'enemy', initiative: 10, hp: 3 },
    ]);
    state = apply(state, { op: 'next' }); // A's turn starts
    state = apply(state, { op: 'condition-add', id: 'c-1', condition: 'frightened', duration: 'end_of_turn' });
    state = apply(state, { op: 'condition-add', id: 'c-1', condition: 'poisoned', duration: 'rounds', rounds: 2 });
    state = apply(state, { op: 'condition-add', id: 'c-2', condition: 'stunned', duration: 'end_of_turn' });
    state = apply(state, { op: 'next' }); // A's turn ends: frightened gone, poisoned 2 -> 1
    assert.deepEqual(state.combatants[0].conditions, [{ id: 'poisoned', duration: 'rounds', rounds: 1 }]);
    assert.deepEqual(state.combatants[1].conditions, [{ id: 'stunned', duration: 'end_of_turn' }]);
    state = apply(state, { op: 'next' }); // B's turn ends: stunned gone; A's poisoned not touched
    assert.deepEqual(state.combatants[1].conditions, []);
    assert.deepEqual(state.combatants[0].conditions, [{ id: 'poisoned', duration: 'rounds', rounds: 1 }]);
    state = apply(state, { op: 'next' }); // round 2, A's turn ends: poisoned runs out
    assert.deepEqual(state.combatants[0].conditions, []);
    assert.equal(state.round, 2);
  });

  test('a rounds condition that is due at the end of its turn is removed with a line', () => {
    let state = fighting([{ op: 'add', name: 'A', side: 'enemy', initiative: 20, hp: 3 }]);
    state = apply(state, { op: 'next' });
    state = apply(state, { op: 'condition-add', id: 'c-1', condition: 'poisoned', duration: 'rounds', rounds: 1 });
    state = apply(state, { op: 'next' });
    assert.deepEqual(state.combatants[0].conditions, []);
    assert.equal(state.events.at(-2).text, 'A loses poisoned');
  });

  test('resources are not refilled by the tracker when the turn or the round passes', () => {
    let state = fighting([{ op: 'add', name: 'Dragon', side: 'enemy', initiative: 20, hp: 3, resources: { legendary_actions: 3 } }]);
    state = apply(state, { op: 'resource', id: 'c-1', resource: 'legendary_actions', delta: -2 });
    state = apply(state, { op: 'next' });
    state = apply(state, { op: 'next' });
    assert.equal(state.combatants[0].resources.legendary_actions, 1);
  });
});

describe('start and end', () => {
  test('end keeps the state for the log and marks it inactive', () => {
    let state = fighting([{ op: 'add', name: 'A', side: 'enemy', initiative: 20, hp: 3 }]);
    state = apply(state, { op: 'next' });
    const ended = endEncounter(REAL, state, ctx);
    assert.equal(ended.state.active, false);
    assert.equal(ended.state.combatants.length, 1);
    assert.equal(ended.state.events.at(-1).text, 'Combat ends in round 1');
    assert.equal(endEncounter(REAL, ended.state, ctx).error.code, 'not-active');
  });

  test('start resets the combat and keeps the revision counting up', () => {
    const first = fighting([{ op: 'add', name: 'A', side: 'enemy', hp: 3 }]);
    const ended = endEncounter(REAL, first, ctx).state;
    const second = startEncounter(REAL, ended, ctx).state;
    assert.deepEqual(second.combatants, []);
    assert.equal(second.active, true);
    assert.equal(second.revision, ended.revision + 1);
  });
});

describe('events', () => {
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
});

describe('validateState', () => {
  test('a valid state has no problems', () => {
    const state = fighting([{ op: 'add', name: 'A', side: 'enemy', initiative: 5, hp: 3 }]);
    assert.deepEqual(validateState(REAL, state), []);
  });

  test('reports each kind of problem', () => {
    const state = fighting([{ op: 'add', name: 'A', side: 'enemy', initiative: 5, hp: 3 }]);
    const codes = (bad) => validateState(REAL, bad).map((e) => e.code);
    assert.ok(codes({ ...state, combatants: [state.combatants[0], { ...state.combatants[0] }] }).includes('duplicate-id'));
    assert.ok(codes({ ...state, order: [] }).includes('order-mismatch'));
    assert.ok(codes({ ...state, order: ['c-1', 'c-9'] }).includes('order-mismatch'));
    assert.ok(codes({ ...state, combatants: [{ ...state.combatants[0], conditions: [{ id: 'dazed', duration: 'until_removed' }] }] }).includes('unknown-condition'));
    assert.ok(codes({ ...state, combatants: [{ ...state.combatants[0], hp: -1 }] }).includes('negative-hp'));
    assert.ok(codes({ ...state, round: -1 }).includes('negative-round'));
    assert.ok(codes({ ...state, active: true, turn: 4 }).includes('turn-out-of-range'));
  });

  test('a state made by the rules is always valid', () => {
    let state = fighting([
      { op: 'add', name: 'A', side: 'enemy', initiative: 20, hp: 3 },
      { op: 'add', name: 'Ilde', side: 'pc', initiative: 10, hp: 4 },
    ]);
    state = apply(state, { op: 'damage', id: 'c-2', amount: 9 });
    state = apply(state, { op: 'condition-add', id: 'c-1', condition: 'poisoned', duration: 'rounds', rounds: 1 });
    state = apply(state, { op: 'next' });
    state = apply(state, { op: 'next' });
    state = apply(state, { op: 'remove', id: 'c-1' });
    assert.deepEqual(validateState(REAL, state), []);
  });
});

describe('the PC at zero and a defeated enemy in the same fight', () => {
  test('the tracker keeps the PC in the order, unconscious, and the turn moves past it only when it is defeated', () => {
    let state = fighting([
      { op: 'add', name: 'Ilde', side: 'pc', initiative: 20, hp: 4 },
      { op: 'add', name: 'Goblin 1', side: 'enemy', initiative: 10, hp: 3 },
    ]);
    state = apply(state, { op: 'damage', id: 'c-1', amount: 4 });
    state = apply(state, { op: 'next' });
    assert.equal(state.order[state.turn], 'c-1');
    assert.equal(state.combatants[0].defeated, undefined);
  });
});

describe('statSummary', () => {
  const ITALIAN = `---
id: guardiano-sintetico
kind: creature
template: enemy
---
# Guardiano sintetico

## Natura

Una statua di pietra che cammina.

## Statistiche

### Caratteristiche

| Caratteristica | Valore |
| --- | --- |
| CA | 15 (armatura di pietra) |
| PF | 52 |
| Velocità | 9 m |
| Iniziativa | +1 |
| FOR | 18 (+4) |
| DES | 8 (-1) |
| COS | 16 (+3) |
| INT | 3 (-4) |
| SAG | 10 (+0) |
| CAR | 5 (-3) |
| GS | 2 |

### Attacchi e capacità

| Attacco o capacità | Dettagli |
| --- | --- |
| Pugno | +6, 1d8 + 4 |

## Azioni

***Pugno pesante.*** Il guardiano colpisce con [il braccio](https://example.test/braccio) di pietra.

**Sasso lanciato.** Gittata 30 m, *1d6* danni.

## Azioni bonus

**Scatto.** Il guardiano si sposta di 3 m.

## Reazioni

**Parata.** Quando è colpito in mischia, riduce il danno di 2.

## Azioni leggendarie

**Passo pesante.** Il guardiano si sposta di 1,5 m.

<!-- master -->
## Master

### Indicazioni per il master

***Segreto del master.*** Non deve apparire mai.
<!-- /master -->
`;

  const ENGLISH = `---
id: stone-guard
kind: creature
template: enemy
---
# Stone guard

## Nature

A statue that walks.

## Statistics

### Characteristics

| Characteristic | Value |
| --- | --- |
| AC | 15 |
| HP | 52 |
| Speed | 9 m |
| Initiative | +1 |
| STR | 18 (+4) |
| DEX | 8 (-1) |
| CON | 16 (+3) |
| INT | 3 (-4) |
| WIS | 10 (+0) |
| CHA | 5 (-3) |
| CR | 2 |

## Actions

***Heavy fist.*** The guard strikes with its stone arm.

## Bonus Actions

**Dash.** The guard moves 3 m.

## Reactions

**Parry.** When hit in melee, it reduces the damage by 2.

## Legendary Actions

**Heavy step.** The guard moves 1.5 m.
`;

  const MASTER_ONLY = `# Sentinella

## Statistiche

| Caratteristica | Valore |
| --- | --- |
| CA | 12 |
| PF | 20 |

## Azioni

**Colpo visibile.** Un colpo di spada.

<!-- master -->
## Master

## Azioni

**Colpo segreto.** Non deve comparire.

### Indicazioni per il master

Solo per il master.
<!-- /master -->
`;

  test('reads the Italian sheet: labels as written, ability rows, initiative and CR', () => {
    const summary = statSummary(REAL, ITALIAN);
    assert.deepEqual(summary.lines, [
      { label: 'CA', value: '15 (armatura di pietra)' },
      { label: 'PF', value: '52' },
      { label: 'Velocità', value: '9 m' },
      { label: 'Iniziativa', value: '+1' },
      { label: 'FOR', value: '18 (+4)' },
      { label: 'DES', value: '8 (-1)' },
      { label: 'COS', value: '16 (+3)' },
      { label: 'INT', value: '3 (-4)' },
      { label: 'SAG', value: '10 (+0)' },
      { label: 'CAR', value: '5 (-3)' },
      { label: 'GS', value: '2' },
    ]);
  });

  test('collects every action paragraph under the action headings, with plain text', () => {
    const { actions } = statSummary(REAL, ITALIAN);
    assert.deepEqual(actions, [
      { name: 'Pugno pesante', text: 'Il guardiano colpisce con il braccio di pietra.' },
      { name: 'Sasso lanciato', text: 'Gittata 30 m, 1d6 danni.' },
      { name: 'Scatto', text: 'Il guardiano si sposta di 3 m.' },
      { name: 'Parata', text: 'Quando è colpito in mischia, riduce il danno di 2.' },
      { name: 'Passo pesante', text: 'Il guardiano si sposta di 1,5 m.' },
    ]);
  });

  test('reads the English sheet with the English headings and labels', () => {
    const summary = statSummary(REAL, ENGLISH);
    assert.deepEqual(summary.lines.slice(0, 4), [
      { label: 'AC', value: '15' },
      { label: 'HP', value: '52' },
      { label: 'Speed', value: '9 m' },
      { label: 'Initiative', value: '+1' },
    ]);
    assert.deepEqual(summary.lines.find((line) => line.label === 'STR'), { label: 'STR', value: '18 (+4)' });
    assert.deepEqual(summary.lines.find((line) => line.label === 'CR'), { label: 'CR', value: '2' });
    assert.deepEqual(summary.actions.map((action) => action.name), [
      'Heavy fist', 'Dash', 'Parry', 'Heavy step',
    ]);
    assert.equal(summary.actions[0].text, 'The guard strikes with its stone arm.');
  });

  test('never returns anything from the master-only block, even an action heading inside it', () => {
    const summary = statSummary(REAL, MASTER_ONLY);
    assert.deepEqual(summary.actions, [{ name: 'Colpo visibile', text: 'Un colpo di spada.' }]);
    const text = JSON.stringify(summary);
    assert.equal(text.includes('Colpo segreto'), false);
    assert.equal(text.includes('Solo per il master'), false);
    assert.equal(text.includes('Segreto del master'), false);
  });

  test('an unclosed master block is removed to the end of the sheet', () => {
    const open = '## Azioni\n\n**Visibile.** Testo.\n\n<!-- master -->\n**Nascosto.** Non deve comparire.\n';
    assert.deepEqual(statSummary(REAL, open).actions, [{ name: 'Visibile', text: 'Testo.' }]);
  });

  test('a creature without statistics gives empty lists', () => {
    const creature = '# Capra\n\n## Natura\n\nUn animale.\n\n## Statistiche\n\nNessuna statistica: non combatte.\n';
    assert.deepEqual(statSummary(REAL, creature), { lines: [], actions: [] });
  });

  test('garbage input never throws and gives empty lists', () => {
    const empty = { lines: [], actions: [] };
    assert.deepEqual(statSummary(REAL, undefined), empty);
    assert.deepEqual(statSummary(REAL, null), empty);
    assert.deepEqual(statSummary(REAL, 42), empty);
    assert.deepEqual(statSummary(REAL, {}), empty);
    assert.deepEqual(statSummary(REAL, ''), empty);
    assert.deepEqual(statSummary(REAL, '| | |\n|||\n**\n## Azioni\n****'), empty);
    assert.deepEqual(statSummary(undefined, '| CA | 12 |'), { lines: [], actions: [] });
    assert.deepEqual(statSummary(null, null), empty);
  });
});
