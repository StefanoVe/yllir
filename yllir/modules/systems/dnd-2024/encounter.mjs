// Encounter rules of the D&D 2024 adapter: the state of a fight that the master
// declares and the tracker keeps. Pure functions on plain objects: no I/O, no dice.
// The tracker never rolls, never chooses targets and never decides an outcome: it
// applies what the master says. Every function returns new objects and never
// mutates its input.
//
// Results: initEncounter returns a CombatState. startEncounter, recordEvent,
// advanceTurn and endEncounter return { ok: true, state, notices } or
// { ok: false, error: { code, message } }. validateState returns an array of
// { code, message }, empty when the state is valid.
//
// Notices: `notices` lists the automatic changes the rules made in that step, empty
// when there were none. The change the master asked for directly is not a notice.
// Each notice is also saved on the history line it belongs to, as `notice`. A notice is:
// - { kind: 'condition-ended', id, name, condition }: a condition was removed at the
//   end of the turn of its bearer (`end_of_turn`, or `rounds` reaching 0);
// - { kind: 'defeated', id, name }: a non-PC reached 0 hp (not when already defeated);
// - { kind: 'unconscious', id, name }: a PC reached 0 hp and was given `unconscious`
//   (not when it already had it);
// - { kind: 'turn', id, name, round, newRound }: after `next`, who is up. `newRound` is
//   true when the round changes, which includes the first round of the combat.
//
// Choices made here (each one is covered by encounter.test.mjs):
// - a PC at 0 hp falls unconscious (the `unconscious` condition is added, the PC is
//   NOT defeated, and the tracker rolls no death saves); any other side at 0 hp is
//   defeated;
// - the initiative order is kept sorted after every change, also before the combat
//   starts: higher first, null last, ties keep insertion order;
// - a condition with duration `rounds` loses one round at the END of the turn of the
//   combatant that bears it; `end_of_turn` conditions are removed at the same moment;
// - resources whose recovery is `turn` or `round` in the adapter are NOT refilled by
//   the tracker: the master says when they come back, as a resource op;
// - a new combatant id is `c-<n>`, where n is one more than the largest number in use.
//   Ids of removed combatants can therefore come back after the highest one is removed.

const MAX_EVENTS = 200;
const SIDES = ['pc', 'ally', 'enemy'];
const SIDE_WORDS = { pc: 'player character', ally: 'ally', enemy: 'enemy' };
const UNCONSCIOUS = 'unconscious';
const DURATION_WORDS = {
  end_of_turn: 'until the end of its turn',
  until_save: 'until a save',
  until_rest: 'until a rest',
  until_removed: 'until removed',
};

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

const isInt = (value) => Number.isInteger(value);
const nonNegInt = (value) => isInt(value) && value >= 0;
const posInt = (value) => isInt(value) && value >= 1;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const at = (ctx) => (typeof ctx?.now === 'string' ? ctx.now : '');

function copyCombatant(c) {
  return { ...c, conditions: c.conditions.map((cond) => ({ ...cond })), resources: { ...c.resources } };
}

function copyState(state) {
  return {
    ...state,
    order: [...state.order],
    combatants: state.combatants.map(copyCombatant),
    events: state.events.map((event) => ({ ...event })),
  };
}

// Appends history lines and counts one revision. Each entry is plain text or
// { text, notice }; a notice is saved on its line, a line without one stays { at, text }.
// Mutates `next`, which must be a fresh copy.
function commit(next, entries, ctx) {
  for (const entry of entries) {
    const { text, notice = null } = typeof entry === 'string' ? { text: entry } : entry;
    const event = { at: at(ctx), text };
    if (notice) event.notice = notice;
    next.events.push(event);
  }
  next.events = next.events.slice(-MAX_EVENTS);
  next.revision += 1;
  return next;
}

// A successful step: the new state and the notices of its entries (see the header).
function done(next, entries, ctx) {
  const notices = entries.flatMap((entry) => (typeof entry === 'object' && entry.notice ? [entry.notice] : []));
  return { ok: true, state: commit(next, entries, ctx), notices };
}

function find(state, id) {
  return state.combatants.find((c) => c.id === id) ?? null;
}

function unknownCombatant(id) {
  return fail('unknown-combatant', `there is no combatant with id ${String(id)}`);
}

// Ids in initiative order: higher first, null last, ties in insertion order (the
// combatants array is kept in insertion order and JavaScript sorting is stable).
function sortedOrder(combatants) {
  return combatants
    .map((c, index) => ({ id: c.id, index, initiative: c.initiative ?? null }))
    .sort((a, b) => {
      if ((a.initiative === null) !== (b.initiative === null)) return a.initiative === null ? 1 : -1;
      if (a.initiative !== null && a.initiative !== b.initiative) return b.initiative - a.initiative;
      return a.index - b.index;
    })
    .map((entry) => entry.id);
}

// Re-sorts `order` in place after a change. The turn stays on the same combatant when
// that combatant still exists; otherwise the index is kept, clamped to the list.
function resort(next) {
  const current = next.order[next.turn];
  const order = sortedOrder(next.combatants);
  let turn = current === undefined ? -1 : order.indexOf(current);
  if (turn < 0) turn = Math.min(next.turn, Math.max(0, order.length - 1));
  next.order = order;
  next.turn = turn;
  return next;
}

// A PC at 0 hp falls unconscious; any other side at 0 hp is defeated. Returns the notice
// of the change it made, or null when nothing changed.
function settleZeroHp(c) {
  if (c.hp !== 0) return null;
  if (c.side === 'pc') {
    if (c.conditions.some((cond) => cond.id === UNCONSCIOUS)) return null;
    c.conditions.push({ id: UNCONSCIOUS, duration: 'until_removed' });
    return { kind: 'unconscious', id: c.id, name: c.name };
  }
  if (c.defeated) return null;
  c.defeated = true;
  return { kind: 'defeated', id: c.id, name: c.name };
}

function durationText(duration, rounds) {
  if (duration === 'rounds') return `for ${rounds} rounds`;
  return DURATION_WORDS[duration] ?? duration;
}

/**
 * The empty, inactive state. The adapter is accepted so that every rule call has the
 * same shape; this table has no setting that changes the empty state.
 * @returns {object} CombatState
 */
export function initEncounter(adapter) {
  void adapter;
  return { active: false, round: 0, turn: 0, order: [], combatants: [], events: [], revision: 0 };
}

/** Starts a fresh combat: resets the state and marks it active. */
export function startEncounter(adapter, previous, ctx = {}) {
  const base = initEncounter(adapter);
  const next = { ...base, active: true, revision: previous?.revision ?? 0 };
  return done(next, ['Combat starts'], ctx);
}

/** Ends the running combat. The state is kept, for the log. */
export function endEncounter(adapter, state, ctx = {}) {
  void adapter;
  if (!state.active) return fail('not-active', 'no combat is running');
  const next = copyState(state);
  next.active = false;
  const text = next.round > 0 ? `Combat ends in round ${next.round}` : 'Combat ends';
  return done(next, [text], ctx);
}

function opAdd(state, op, ctx) {
  const name = typeof op.name === 'string' ? op.name.trim() : '';
  if (name === '') return fail('bad-value', 'a combatant needs a name');
  if (!SIDES.includes(op.side)) return fail('bad-value', 'side must be pc, ally or enemy');
  const initiative = op.initiative === undefined ? null : op.initiative;
  if (initiative !== null && !isInt(initiative)) return fail('bad-value', 'initiative must be a whole number');
  if (op.hp !== undefined && !nonNegInt(op.hp)) return fail('bad-value', 'hp must be a whole number, zero or more');
  if (op.hpMax !== undefined && !nonNegInt(op.hpMax)) return fail('bad-value', 'hp-max must be a whole number, zero or more');
  if (op.ac !== undefined && !isInt(op.ac)) return fail('bad-value', 'ac must be a whole number');
  const resources = op.resources ?? {};
  if (!isPlainObject(resources) || Object.values(resources).some((value) => !nonNegInt(value))) {
    return fail('bad-value', 'resources must map names to whole numbers, zero or more');
  }
  if (op.notes !== undefined && typeof op.notes !== 'string') return fail('bad-value', 'notes must be text');

  const next = copyState(state);
  let maxId = 0;
  for (const c of next.combatants) {
    const match = /^c-(\d+)$/.exec(c.id);
    if (match) maxId = Math.max(maxId, Number(match[1]));
  }
  const c = { id: `c-${maxId + 1}`, name, side: op.side, initiative, conditions: [], resources: { ...resources }, hidden: op.hidden === true };
  if (op.hp !== undefined) c.hp = op.hp;
  const hpMax = op.hpMax ?? op.hp; // hpMax defaults to hp
  if (hpMax !== undefined) c.hpMax = hpMax;
  if (op.ac !== undefined) c.ac = op.ac;
  if (op.sheet !== undefined) c.sheet = op.sheet; // checked by the store, not here
  if (op.notes !== undefined) c.notes = op.notes;
  const notice = settleZeroHp(c);
  next.combatants.push(c);
  resort(next);
  const detail = initiative === null ? '' : `, initiative ${initiative}`;
  return done(next, [{ text: `${name} joins the fight (${SIDE_WORDS[op.side]}${detail})`, notice }], ctx);
}

function opRemove(state, op, ctx) {
  const c = find(state, op.id);
  if (!c) return unknownCombatant(op.id);
  const next = copyState(state);
  next.combatants = next.combatants.filter((x) => x.id !== op.id);
  resort(next);
  return done(next, [`${c.name} leaves the fight`], ctx);
}

function opInitiative(state, op, ctx) {
  const c = find(state, op.id);
  if (!c) return unknownCombatant(op.id);
  if (!isInt(op.value)) return fail('bad-value', 'initiative must be a whole number');
  const next = copyState(state);
  next.combatants.find((x) => x.id === op.id).initiative = op.value;
  resort(next);
  return done(next, [`${c.name} has initiative ${op.value}`], ctx);
}

// Temporary hit points absorb damage first, then hit points. Hit points never go below 0.
function opDamage(state, op, ctx) {
  const c = find(state, op.id);
  if (!c) return unknownCombatant(op.id);
  if (!posInt(op.amount)) return fail('bad-amount', 'damage must be a whole number above zero');
  if (c.hp === undefined) return fail('no-hp', `${c.name} has no hit points on the tracker`);
  const next = copyState(state);
  const target = next.combatants.find((x) => x.id === op.id);
  const before = target.hp;
  let rest = op.amount;
  let absorbed = 0;
  if (target.tempHp !== undefined) {
    absorbed = Math.min(target.tempHp, rest);
    target.tempHp -= absorbed;
    rest -= absorbed;
  }
  target.hp = Math.max(0, before - rest);
  const notice = settleZeroHp(target);
  let text = `${c.name} takes ${op.amount} damage (${target.hp} left`;
  if (absorbed > 0) text += `, ${absorbed} absorbed by temporary hit points`;
  text += ')';
  if (target.hp === 0 && before > 0) text += target.side === 'pc' ? ' and falls unconscious' : ' and is defeated';
  return done(next, [{ text, notice }], ctx);
}

// Heal never goes above hpMax (when it is known). Reaching hp above 0 clears `defeated`
// and removes `unconscious`.
function opHeal(state, op, ctx) {
  const c = find(state, op.id);
  if (!c) return unknownCombatant(op.id);
  if (!posInt(op.amount)) return fail('bad-amount', 'heal must be a whole number above zero');
  if (c.hp === undefined) return fail('no-hp', `${c.name} has no hit points on the tracker`);
  const next = copyState(state);
  const target = next.combatants.find((x) => x.id === op.id);
  const before = target.hp;
  const raised = target.hpMax === undefined ? before + op.amount : Math.min(target.hpMax, before + op.amount);
  target.hp = raised;
  const gained = raised - before;
  if (target.hp > 0) {
    delete target.defeated;
    target.conditions = target.conditions.filter((cond) => cond.id !== UNCONSCIOUS);
  }
  let text = `${c.name} heals ${gained} (${target.hp} left)`;
  if (gained === 0 && target.hpMax !== undefined) text = `${c.name} is already at full hit points (${target.hp})`;
  if (before === 0 && target.hp > 0) text += target.side === 'pc' ? ' and is conscious again' : ' and is no longer defeated';
  return done(next, [text], ctx);
}

function opConditionAdd(adapter, state, op, ctx) {
  const c = find(state, op.id);
  if (!c) return unknownCombatant(op.id);
  const conditions = adapter.conditions ?? [];
  if (typeof op.condition !== 'string' || !conditions.includes(op.condition)) {
    return fail('unknown-condition', `"${String(op.condition)}" is not a condition of this game`);
  }
  const duration = op.duration ?? 'until_removed';
  if (!(adapter.condition_durations ?? []).includes(duration)) {
    return fail('unknown-duration', `"${duration}" is not a duration of this game`);
  }
  if (duration === 'rounds') {
    if (!posInt(op.rounds)) return fail('bad-rounds', 'a condition lasting rounds needs a number of rounds, one or more');
  } else if (op.rounds !== undefined) {
    return fail('bad-rounds', 'a number of rounds goes only with the duration rounds');
  }
  if (op.note !== undefined && typeof op.note !== 'string') return fail('bad-value', 'note must be text');
  const entry = { id: op.condition, duration };
  if (duration === 'rounds') entry.rounds = op.rounds;
  if (op.note !== undefined) entry.note = op.note;
  const next = copyState(state);
  const target = next.combatants.find((x) => x.id === op.id);
  const index = target.conditions.findIndex((cond) => cond.id === op.condition);
  if (index >= 0) target.conditions[index] = entry;
  else target.conditions.push(entry);
  const words = durationText(duration, op.rounds);
  return done(next, [`${c.name} gets ${op.condition} (${words})`], ctx);
}

function opConditionRemove(state, op, ctx) {
  const c = find(state, op.id);
  if (!c) return unknownCombatant(op.id);
  if (!c.conditions.some((cond) => cond.id === op.condition)) {
    return fail('condition-not-present', `${c.name} does not have ${String(op.condition)}`);
  }
  const next = copyState(state);
  const target = next.combatants.find((x) => x.id === op.id);
  target.conditions = target.conditions.filter((cond) => cond.id !== op.condition);
  return done(next, [`${c.name} loses ${op.condition}`], ctx);
}

// A resource is a counter the adapter names (spell slots, uses, legendary actions...).
// hp and temp_hp have their own ops. Values never go below 0.
function opResource(adapter, state, op, ctx) {
  const c = find(state, op.id);
  if (!c) return unknownCombatant(op.id);
  if (typeof op.resource !== 'string' || op.resource.trim() === '') return fail('bad-value', 'a resource needs a name');
  if (op.resource === 'hp' || op.resource === 'temp_hp') return fail('use-damage-or-heal', `use damage or heal for ${op.resource}`);
  const known = (adapter.resources ?? []).map((resource) => resource.id);
  if (!known.includes(op.resource)) return fail('unknown-resource', `"${op.resource}" is not a resource of this game`);
  const hasDelta = op.delta !== undefined;
  const hasValue = op.value !== undefined;
  if (hasDelta === hasValue) return fail('bad-value', 'give either a delta or a value, not both');
  if (hasValue && !nonNegInt(op.value)) return fail('bad-value', 'value must be a whole number, zero or more');
  if (hasDelta && !isInt(op.delta)) return fail('bad-value', 'delta must be a whole number');
  const next = copyState(state);
  const target = next.combatants.find((x) => x.id === op.id);
  const current = target.resources[op.resource] ?? 0;
  const value = hasValue ? op.value : Math.max(0, current + op.delta);
  target.resources[op.resource] = value;
  const label = op.resource.replace(/_/g, ' ');
  return done(next, [`${c.name}: ${label}, ${value} left`], ctx);
}

function opNote(state, op, ctx) {
  const c = find(state, op.id);
  if (!c) return unknownCombatant(op.id);
  if (typeof op.text !== 'string') return fail('bad-value', 'a note needs text');
  const next = copyState(state);
  const target = next.combatants.find((x) => x.id === op.id);
  const text = op.text.trim();
  if (text === '') {
    delete target.notes;
    return done(next, [`Note on ${c.name} cleared`], ctx);
  }
  target.notes = op.text;
  return done(next, [`Note on ${c.name}: ${text}`], ctx);
}

function opReveal(state, op, ctx) {
  const c = find(state, op.id);
  if (!c) return unknownCombatant(op.id);
  const next = copyState(state);
  next.combatants.find((x) => x.id === op.id).hidden = false;
  return done(next, [`${c.name} is revealed`], ctx);
}

/**
 * Applies one master operation (CombatOp) to the state. `start`, `next` and `end` are
 * routed to their own functions, so every CombatOp is accepted here.
 * @returns {{ok: true, state: object, notices: object[]} | {ok: false, error: {code: string, message: string}}}
 */
export function recordEvent(adapter, state, op, ctx = {}) {
  if (!isPlainObject(state) || !Array.isArray(state.order) || !Array.isArray(state.combatants)) {
    return fail('bad-state', 'the combat state is not complete');
  }
  if (!isPlainObject(op)) return fail('bad-op', 'the operation must be an object');
  switch (op.op) {
    case 'start': return startEncounter(adapter, state, ctx);
    case 'next': return advanceTurn(adapter, state, ctx);
    case 'end': return endEncounter(adapter, state, ctx);
    case 'add': return opAdd(state, op, ctx);
    case 'remove': return opRemove(state, op, ctx);
    case 'initiative': return opInitiative(state, op, ctx);
    case 'damage': return opDamage(state, op, ctx);
    case 'heal': return opHeal(state, op, ctx);
    case 'condition-add': return opConditionAdd(adapter, state, op, ctx);
    case 'condition-remove': return opConditionRemove(state, op, ctx);
    case 'resource': return opResource(adapter, state, op, ctx);
    case 'note': return opNote(state, op, ctx);
    case 'reveal': return opReveal(state, op, ctx);
    default: return fail('unknown-op', `unknown operation: ${String(op.op)}`);
  }
}

/**
 * Passes the turn to the next living combatant. The first call after startEncounter
 * sets round 1 and turn 0. Otherwise the end of the current turn first ticks its
 * conditions, then the turn moves on and wraps to the next round when the list ends.
 * Defeated combatants are skipped. The tracker never refills resources here: see the
 * header of this file.
 */
export function advanceTurn(adapter, state, ctx = {}) {
  void adapter;
  if (!isPlainObject(state) || !Array.isArray(state.order)) return fail('bad-state', 'the combat state is not complete');
  if (!state.active) return fail('not-active', 'no combat is running');
  const count = state.order.length;
  if (count === 0) return fail('no-combatants', 'the combat has no combatants yet');
  const next = copyState(state);

  if (state.round === 0) {
    const first = next.order.findIndex((id) => !find(next, id).defeated);
    if (first < 0) return fail('no-living-combatants', 'every combatant is defeated');
    next.round = 1;
    next.turn = first;
    const who = find(next, next.order[first]);
    const notice = { kind: 'turn', id: who.id, name: who.name, round: 1, newRound: true };
    return done(next, [{ text: `Round 1: ${who.name} is up`, notice }], ctx);
  }

  const entries = [];
  const bearer = find(next, next.order[state.turn]);
  if (bearer) {
    const kept = [];
    for (const cond of bearer.conditions) {
      const ended = { kind: 'condition-ended', id: bearer.id, name: bearer.name, condition: cond.id };
      if (cond.duration === 'end_of_turn') {
        entries.push({ text: `${bearer.name} loses ${cond.id}`, notice: ended });
        continue;
      }
      if (cond.duration === 'rounds') {
        const left = (cond.rounds ?? 1) - 1;
        if (left <= 0) {
          entries.push({ text: `${bearer.name} loses ${cond.id}`, notice: ended });
        } else {
          kept.push({ ...cond, rounds: left });
        }
        continue;
      }
      kept.push(cond);
    }
    bearer.conditions = kept;
  }

  let index = state.turn;
  let round = state.round;
  let found = -1;
  for (let step = 0; step < count; step++) {
    index += 1;
    if (index >= count) {
      index = 0;
      round += 1;
    }
    const candidate = find(next, next.order[index]);
    if (candidate && !candidate.defeated) {
      found = index;
      break;
    }
  }
  if (found < 0) return fail('no-living-combatants', 'every combatant is defeated');

  next.turn = found;
  next.round = round;
  const who = find(next, next.order[found]);
  const newRound = round !== state.round;
  const notice = { kind: 'turn', id: who.id, name: who.name, round, newRound };
  entries.push({ text: newRound ? `Round ${round}: ${who.name} is up` : `${who.name} is up`, notice });
  return done(next, entries, ctx);
}

/**
 * Checks a CombatState. Returns the problems found, empty when the state is valid.
 * The store refuses to save a state with any problem.
 */
export function validateState(adapter, state) {
  if (!isPlainObject(state) || !Array.isArray(state.combatants) || !Array.isArray(state.order)) {
    return [{ code: 'bad-state', message: 'the combat state is not complete' }];
  }
  const errors = [];
  const conditions = adapter.conditions ?? [];
  const durations = adapter.condition_durations ?? [];

  const ids = new Set();
  for (const c of state.combatants) {
    if (ids.has(c.id)) errors.push({ code: 'duplicate-id', message: `combatant id ${c.id} is used more than once` });
    ids.add(c.id);
    if (!SIDES.includes(c.side)) errors.push({ code: 'bad-side', message: `${c.name}: side must be pc, ally or enemy` });
    if (c.hp !== undefined && (!isInt(c.hp) || c.hp < 0)) errors.push({ code: 'negative-hp', message: `${c.name} has an impossible hit point value` });
    if (c.tempHp !== undefined && (!isInt(c.tempHp) || c.tempHp < 0)) errors.push({ code: 'negative-hp', message: `${c.name} has an impossible temporary hit point value` });
    for (const cond of c.conditions ?? []) {
      if (!conditions.includes(cond.id)) errors.push({ code: 'unknown-condition', message: `${c.name}: unknown condition ${cond.id}` });
      if (!durations.includes(cond.duration)) errors.push({ code: 'unknown-duration', message: `${c.name}: unknown duration ${cond.duration}` });
    }
    for (const [name, value] of Object.entries(c.resources ?? {})) {
      if (!nonNegInt(value)) errors.push({ code: 'negative-resource', message: `${c.name}: ${name} is not a whole number, zero or more` });
    }
  }

  // The order must list every combatant exactly once and nothing else.
  const listed = new Set();
  let orderBad = false;
  for (const id of state.order) {
    if (listed.has(id) || !ids.has(id)) orderBad = true;
    listed.add(id);
  }
  if ([...ids].some((id) => !listed.has(id))) orderBad = true;
  if (orderBad) errors.push({ code: 'order-mismatch', message: 'the initiative order does not list every combatant exactly once' });

  if (!nonNegInt(state.round)) errors.push({ code: 'negative-round', message: 'the round cannot be negative' });
  const turnOk = isInt(state.turn) && (state.order.length > 0 ? state.turn >= 0 && state.turn < state.order.length : state.turn === 0);
  if (!turnOk) errors.push({ code: 'turn-out-of-range', message: 'the turn points outside the initiative order' });
  return errors;
}

// Public summary of a stat block, for the tooltip of a combatant. Reads the sheet's
// statistics tables (ability rows, armour class, hit points, speed), the rows of the
// action tables (adapter.action_table, the "attacks and abilities" tables) and every
// paragraph under the action headings. The master-only block is removed first, so it
// never comes back.
const MASTER_BLOCK = /<!--\s*master\s*-->[\s\S]*?<!--\s*\/master\s*-->/g;
const MASTER_OPEN = /<!--\s*master\s*-->[\s\S]*$/;
// Action headings of the fixed set, used when the adapter declares no action_groups.
// Every action under them is read as an action of its own turn.
const FIXED_ACTION_HEADINGS = [
  'azioni', 'azioni bonus', 'reazioni', 'azioni leggendarie',
  'actions', 'bonus actions', 'reactions', 'legendary actions',
];
const FIXED_ACTION_GROUP = { group: 'actions', timing: 'own_turn' };
// Labels the adapter does not list: initiative and challenge rating, in both languages.
const EXTRA_STAT_LABELS = {
  initiative: ['iniziativa', 'bonus di iniziativa', 'initiative', 'initiative bonus'],
  cr: ['gs', 'grado di sfida', 'cr', 'challenge rating'],
};
const STAT_ORDER = ['ac', 'hp', 'speed', 'initiative', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'cr'];

// Markdown to plain text: links become their text, emphasis markers go.
function plainText(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*+/g, '')
    .replace(/(^|[\s(])_+(?=\S)/g, '$1')
    .replace(/(?<=\S)_+(?=$|[\s.,;:!?)])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const normaliseLabel = (text) => plainText(text).replace(/:$/, '').toLowerCase();
const normaliseMarker = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();

// Maps every label the sheet may use (Italian or English) to the adapter field id.
function labelMap(adapter) {
  const map = new Map();
  const add = (labels, id) => {
    for (const label of labels) {
      if (typeof label === 'string' && label !== '') map.set(normaliseLabel(label), id);
    }
  };
  for (const field of adapter?.creature_sheet?.required ?? []) add([field.label_it, field.label_en], field.id);
  for (const [id, labels] of Object.entries(EXTRA_STAT_LABELS)) add(labels, id);
  return map;
}

// The action rules of the adapter, read once per call:
// - headings: each action heading (normalised) to its { group, timing };
// - groups: each action group with its timing and its markers (normalised);
// - tables: the table headings (normalised) whose rows are actions;
// - fallback: the group of a row no marker matches, the first group with timing own_turn.
// Without action_groups in the adapter, the fixed headings are actions of their own turn.
function actionRules(adapter) {
  const headings = new Map();
  const groups = [];
  if (Array.isArray(adapter?.action_groups)) {
    for (const group of adapter.action_groups) {
      const markers = Array.isArray(group?.markers)
        ? group.markers.filter((m) => typeof m === 'string' && m.trim() !== '').map(normaliseMarker)
        : [];
      const entry = { group: group.id, timing: group.timing, markers };
      groups.push(entry);
      for (const heading of group.headings ?? []) headings.set(normaliseLabel(heading), { group: group.id, timing: group.timing });
    }
  } else {
    for (const heading of FIXED_ACTION_HEADINGS) headings.set(heading, { ...FIXED_ACTION_GROUP });
  }
  const tables = new Set(
    (Array.isArray(adapter?.action_table) ? adapter.action_table : [])
      .filter((heading) => typeof heading === 'string' && heading.trim() !== '')
      .map(normaliseLabel),
  );
  const own = groups.find((group) => group.timing === 'own_turn') ?? groups[0];
  const fallback = own ? { group: own.group, timing: own.timing } : { ...FIXED_ACTION_GROUP };
  return { headings, groups, tables, fallback };
}

// First table row for each known label: `| CA | 15 (armatura) |` gives ac.
function statRows(lines, labels) {
  const found = new Map();
  for (const line of lines) {
    if (!isTableRow(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 2) continue;
    const id = labels.get(normaliseLabel(cells[0]));
    const value = plainText(cells[1]);
    if (!id || value === '' || found.has(id)) continue;
    found.set(id, { label: plainText(cells[0]), value });
  }
  return found;
}

const isTableRow = (line) => line.trim().startsWith('|');
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const isSeparatorRow = (cells) => cells.every((cell) => /^:?-+:?$/.test(cell));

// A paragraph starting with a bold name: `***Name.*** text`, `**Name.** text`, or a list item of that form.
function actionFromParagraph(text) {
  const match = /^(?:[-+*]\s+)?(\*{2,3}|_{2,3})(.+?)\1\s*(.*)$/.exec(text);
  if (!match) return null;
  const name = plainText(match[2]).replace(/[\s.:!?]+$/, '').trim();
  if (name === '') return null;
  return { name, text: plainText(match[3]) };
}

// True when `marker` is the whole of `lead` or its first words, at a word boundary.
function leadsWith(lead, marker) {
  if (!lead.startsWith(marker)) return false;
  return lead.length === marker.length || !/[\p{L}\p{N}]/u.test(lead[marker.length]);
}

// The group of one table row. Its details (the text before the first `:` or `.`) start
// with a marker: the longest such marker wins, so `Azione bonus` beats `Azione`. Without
// one, a marker in parentheses in the name counts. Otherwise the row takes the fallback.
function rowGroup(rules, name, details) {
  const lead = normaliseMarker(details.split(/[:.]/)[0]);
  let best = null;
  for (const group of rules.groups) {
    for (const marker of group.markers) {
      if (leadsWith(lead, marker) && (best === null || marker.length > best.marker.length)) best = { marker, group };
    }
  }
  if (best) return { group: best.group.group, timing: best.group.timing };
  for (const match of name.matchAll(/\(([^()]*)\)/g)) {
    const wanted = normaliseMarker(match[1]);
    const found = rules.groups.find((group) => group.markers.includes(wanted));
    if (found) return { group: found.group, timing: found.timing };
  }
  return { ...rules.fallback };
}

// One row of an action table: the first cell is the name, the second the details.
function tableAction(rules, cells) {
  const name = plainText(cells[0] ?? '');
  if (name === '') return null;
  const text = plainText(cells[1] ?? '');
  return { name, text, ...rowGroup(rules, name, text) };
}

// Every action in the sheet, with the line where it starts (`at`): the paragraphs under
// the action headings and the rows of the action tables. Table rows: the first row of a
// table is its header and the separator row after it is skipped.
function actionEntries(lines, rules) {
  const actions = [];
  let current = null; // { group, timing } of the action heading, or null
  let tableSection = false; // the heading is one of adapter.action_table
  let phase = null; // null before the header row, then 'separator', then 'rows'
  let paragraph = [];
  let paragraphAt = 0;
  const flush = () => {
    if (current !== null && paragraph.length > 0) {
      const entry = actionFromParagraph(paragraph.join(' '));
      if (entry) actions.push({ ...entry, group: current.group, timing: current.timing, at: paragraphAt });
    }
    paragraph = [];
  };
  lines.forEach((raw, at) => {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw);
    if (heading) {
      flush();
      const key = normaliseLabel(heading[1]);
      current = rules.headings.get(key) ?? null;
      tableSection = rules.tables.has(key);
      phase = null;
      return;
    }
    if (raw.trim() === '') {
      flush();
      phase = null;
      return;
    }
    if (tableSection && isTableRow(raw)) {
      const cells = splitRow(raw);
      if (phase === null) {
        phase = 'separator'; // the header row
        return;
      }
      phase = 'rows';
      if (isSeparatorRow(cells)) return;
      const entry = tableAction(rules, cells);
      if (entry) actions.push({ ...entry, at });
      return;
    }
    phase = null;
    if (current !== null) {
      if (paragraph.length === 0) paragraphAt = at;
      paragraph.push(raw.trim());
    }
  });
  flush();
  return actions;
}

/**
 * Summary of a stat block for the tooltip. `lines` are the rows found in the statistics
 * tables, in a fixed order: `id` is the adapter field id (or `initiative` and `cr`),
 * `label` is the label as the sheet writes it and `value` the value as the sheet writes
 * it, in plain text. `actions` are, in document order, the paragraphs under the action
 * headings and the rows of the tables under the headings of adapter.action_table (the
 * first cell is the name, the second the details; the header and separator rows are
 * skipped). Each action has `group`, the id of the adapter's action group, and `timing`
 * (own_turn, any_turn or others_turns):
 * - a row whose details start with one of the markers of a group (text before the first
 *   `:` or `.`; the longest marker wins) takes that group, and the marker stays in `text`;
 * - otherwise a marker in parentheses in the name gives the group;
 * - otherwise the first group with timing own_turn.
 * Without action_groups in the adapter, every action has group `actions` and timing
 * `own_turn`. The master-only block is removed before anything is read. Never throws:
 * unexpected input gives empty lists.
 * @param {object} adapter the parsed adapter.yaml of the game system
 * @param {string} markdown the sheet, Markdown
 * @returns {{lines: {id: string, label: string, value: string}[], actions: {name: string, text: string, group: string, timing: string}[]}}
 */
export function statSummary(adapter, markdown) {
  try {
    if (typeof markdown !== 'string') return { lines: [], actions: [] };
    const visible = markdown.replace(MASTER_BLOCK, '').replace(MASTER_OPEN, '');
    const lines = visible.split(/\r?\n/);
    const rows = statRows(lines, labelMap(adapter));
    const summary = [];
    for (const id of STAT_ORDER) {
      const row = rows.get(id);
      if (row) summary.push({ id, label: row.label, value: row.value });
    }
    const actions = actionEntries(lines, actionRules(adapter))
      .sort((a, b) => a.at - b.at)
      .map(({ name, text, group, timing }) => ({ name, text, group, timing }));
    return { lines: summary, actions };
  } catch {
    return { lines: [], actions: [] };
  }
}
