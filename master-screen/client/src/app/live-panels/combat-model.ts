import type { CombatState, Combatant, ConditionState, Side } from '@shared/types';
import type { PanelKey } from './strings';

/** Conditions of the 2024 rules, offered first in every condition select. */
export const CONDITION_IDS = [
  'blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible',
  'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
] as const;

export const DURATION_IDS = ['end_of_turn', 'until_save', 'until_rest', 'until_removed', 'rounds'] as const;
export type DurationId = (typeof DURATION_IDS)[number];

export const SIDE_IDS: readonly Side[] = ['pc', 'ally', 'enemy'];

const CONDITION_KEYS: Record<(typeof CONDITION_IDS)[number], PanelKey> = {
  blinded: 'panels.condition.blinded',
  charmed: 'panels.condition.charmed',
  deafened: 'panels.condition.deafened',
  exhaustion: 'panels.condition.exhaustion',
  frightened: 'panels.condition.frightened',
  grappled: 'panels.condition.grappled',
  incapacitated: 'panels.condition.incapacitated',
  invisible: 'panels.condition.invisible',
  paralyzed: 'panels.condition.paralyzed',
  petrified: 'panels.condition.petrified',
  poisoned: 'panels.condition.poisoned',
  prone: 'panels.condition.prone',
  restrained: 'panels.condition.restrained',
  stunned: 'panels.condition.stunned',
  unconscious: 'panels.condition.unconscious',
};

const DURATION_KEYS: Record<DurationId, PanelKey> = {
  end_of_turn: 'panels.combat.duration.end_of_turn',
  until_save: 'panels.combat.duration.until_save',
  until_rest: 'panels.combat.duration.until_rest',
  until_removed: 'panels.combat.duration.until_removed',
  rounds: 'panels.combat.duration.rounds',
};

const SIDE_KEYS: Record<Side, PanelKey> = {
  pc: 'panels.combat.side.pc',
  ally: 'panels.combat.side.ally',
  enemy: 'panels.combat.side.enemy',
};

/** Copy key of a known condition; null for an id this panel does not know (shown as the id itself). */
export function conditionKey(id: string): PanelKey | null {
  return (CONDITION_IDS as readonly string[]).includes(id) ? CONDITION_KEYS[id as (typeof CONDITION_IDS)[number]] : null;
}

export function durationKey(id: string): PanelKey | null {
  return (DURATION_IDS as readonly string[]).includes(id) ? DURATION_KEYS[id as DurationId] : null;
}

export function sideKey(side: Side): PanelKey {
  return SIDE_KEYS[side];
}

/** Icon name of a side, for the template's icon map. */
export function sideIconName(side: Side): 'UserRound' | 'Shield' | 'Skull' {
  return side === 'pc' ? 'UserRound' : side === 'ally' ? 'Shield' : 'Skull';
}

/**
 * Conditions offered by the select: the 2024 list first, then any other id the combat already uses
 * (kept in the order it was first seen). The list is only a menu; the rule engine decides what is valid.
 */
export function conditionOptions(combat: CombatState | null): string[] {
  const options: string[] = [...CONDITION_IDS];
  for (const combatant of combat?.combatants ?? []) {
    for (const condition of combatant.conditions) {
      if (!options.includes(condition.id)) options.push(condition.id);
    }
  }
  return options;
}

export interface CombatRow {
  combatant: Combatant;
  /** True for the combatant whose turn it is, while the combat is active. */
  current: boolean;
}

/**
 * Rows in initiative order (`order`), then any combatant missing from it. Defeated combatants move to
 * the end and keep their relative order. Hidden ones stay where they are: the panel dims them.
 */
export function combatRows(combat: CombatState): CombatRow[] {
  const byId = new Map(combat.combatants.map((combatant) => [combatant.id, combatant] as const));
  const ids = [
    ...combat.order.filter((id) => byId.has(id)),
    ...combat.combatants.map((combatant) => combatant.id).filter((id) => !combat.order.includes(id)),
  ];
  const current = combat.active ? combat.order[combat.turn] : undefined;
  const rows: CombatRow[] = [];
  for (const id of ids) {
    const combatant = byId.get(id);
    if (combatant) rows.push({ combatant, current: id === current });
  }
  return [...rows.filter((row) => row.combatant.defeated !== true), ...rows.filter((row) => row.combatant.defeated === true)];
}

export interface HpView {
  /** False when the combatant has no hit points at all. */
  hasHp: boolean;
  hp: number;
  max: number | null;
  /** Width of the bar in percent (0 to 100); null when there is no maximum to measure against. */
  percent: number | null;
  temp: number;
}

export function hpView(combatant: Pick<Combatant, 'hp' | 'hpMax' | 'tempHp'>): HpView {
  const hasHp = typeof combatant.hp === 'number';
  const hp = combatant.hp ?? 0;
  const max = typeof combatant.hpMax === 'number' && combatant.hpMax > 0 ? combatant.hpMax : null;
  const percent = max === null ? null : Math.min(100, Math.max(0, (hp / max) * 100));
  return { hasHp, hp, max, percent, temp: combatant.tempHp ?? 0 };
}

/** Condition text without its key: the id, and the rounds left when the duration counts rounds. */
export function conditionRounds(condition: ConditionState): number | null {
  return condition.duration === 'rounds' && typeof condition.rounds === 'number' ? condition.rounds : null;
}

/**
 * Parses an optional whole number from an input. An empty input is "not given" (undefined).
 * Anything else that is not a whole number is rejected with ok false.
 */
export function parseOptionalInt(raw: string): { ok: true; value: number | undefined } | { ok: false } {
  const text = raw.trim();
  if (text === '') return { ok: true, value: undefined };
  const value = Number(text);
  return Number.isInteger(value) ? { ok: true, value } : { ok: false };
}

/** A damage or heal amount: a whole number above zero. */
export function parseAmount(raw: string): number | null {
  const parsed = parseOptionalInt(raw);
  return parsed.ok && parsed.value !== undefined && parsed.value > 0 ? parsed.value : null;
}
