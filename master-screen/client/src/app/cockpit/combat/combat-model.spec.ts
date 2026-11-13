import { describe, expect, it } from 'vitest';
import type { BoardModuleView, Combatant } from '@shared/cockpit-types';
import type { ActionCard, CardAction } from '@shared/types';
import {
  buildCombatStart,
  byInitiative,
  cardGroups,
  cellAt,
  conditionSummary,
  fightCards,
  groupActions,
  hpPercent,
  nextTurnId,
  initials,
  noticeText,
  parseInitiative,
  percentAt,
  statsKey,
  stepCell,
} from './combat-model';
import { DICTIONARIES, lookup, type TranslationKey, type TranslationParams } from '../../i18n';

describe('combat model', () => {
  it('reads an empty initiative as not rolled and accepts a decimal comma', () => {
    expect(parseInitiative('')).toBeNull();
    expect(parseInitiative('  ')).toBeNull();
    expect(parseInitiative('14')).toBe(14);
    expect(parseInitiative('-1')).toBe(-1);
    expect(parseInitiative('12,7')).toBe(12);
    expect(parseInitiative('abc')).toBeNull();
  });

  it('builds the combat.start payload: players as pc, then the ticked creatures on their side', () => {
    const action = buildCombatStart(
      'Combat: Kaelen',
      [
        { name: 'Mira', path: 'Players/Mira.md', initiative: '14' },
        { name: 'Tor', path: '', initiative: '' },
      ],
      [
        { cardId: 'k', name: 'Kaelen', path: 'NPCs/Kaelen.md', checked: true, side: 'enemy', initiative: '12' },
        { cardId: 'o', name: 'Ogre', path: 'Enemies/Ogre.md', checked: false, side: 'enemy', initiative: '9' },
        { cardId: 'b', name: 'Brann', path: 'NPCs/Brann.md', checked: true, side: 'ally', initiative: '' },
      ],
    );
    expect(action).toEqual({
      type: 'combat.start',
      title: 'Combat: Kaelen',
      participants: [
        { name: 'Mira', kind: 'pc', initiative: 14, conditions: [], source: { path: 'Players/Mira.md' } },
        { name: 'Tor', kind: 'pc', initiative: null, conditions: [] },
        { name: 'Kaelen', kind: 'enemy', initiative: 12, conditions: [], source: { path: 'NPCs/Kaelen.md' } },
        { name: 'Brann', kind: 'ally', initiative: null, conditions: [], source: { path: 'NPCs/Brann.md' } },
      ],
    });
  });

  it('orders by initiative, highest first, not rolled last, ties keep their order', () => {
    const order = byInitiative([
      { name: 'a', initiative: null },
      { name: 'b', initiative: 10 },
      { name: 'c', initiative: 18 },
      { name: 'd', initiative: null },
      { name: 'e', initiative: 10 },
    ]).map((item) => item.name);
    expect(order).toEqual(['c', 'b', 'e', 'a', 'd']);
  });

  it('takes the first letters of the first two words as initials', () => {
    expect(initials('Kaelen')).toBe('KA');
    expect(initials('lord  vex the old')).toBe('LV');
    expect(initials('')).toBe('?');
  });

  it('maps points to cells with a grid and to fractions without one', () => {
    expect(cellAt(0.25, 0.25, { cols: 10, rows: 8 })).toEqual({ x: 2, y: 2 });
    expect(cellAt(1, 1, { cols: 10, rows: 8 })).toEqual({ x: 9, y: 7 });
    expect(cellAt(0.5123, 1.4, null)).toEqual({ x: 0.512, y: 1 });
  });

  it('centres a chip in its cell, or places it at the fraction without a grid', () => {
    expect(percentAt({ x: 0, y: 0 }, { cols: 4, rows: 4 })).toEqual({ left: 12.5, top: 12.5 });
    expect(percentAt({ x: 0.25, y: 0.5 }, null)).toEqual({ left: 25, top: 50 });
  });

  it('moves one cell with the arrow keys and stays inside the grid; does nothing without a grid', () => {
    const grid = { cols: 3, rows: 3 };
    expect(stepCell({ x: 1, y: 1 }, 'ArrowRight', grid)).toEqual({ x: 2, y: 1 });
    expect(stepCell({ x: 2, y: 0 }, 'ArrowRight', grid)).toEqual({ x: 2, y: 0 });
    expect(stepCell({ x: 0, y: 0 }, 'ArrowUp', grid)).toEqual({ x: 0, y: 0 });
    expect(stepCell({ x: 0, y: 0 }, 'a', grid)).toBeNull();
    expect(stepCell({ x: 0, y: 0 }, 'ArrowDown', null)).toBeNull();
  });

  it('gives the hit point percentage only when the maximum is known', () => {
    expect(hpPercent(15, 30)).toBe(50);
    expect(hpPercent(40, 30)).toBe(100);
    expect(hpPercent(undefined, 30)).toBeNull();
    expect(hpPercent(10, undefined)).toBeNull();
  });

  it('lists only character and creature cards that have a sheet', () => {
    const modules = [
      { id: '1', kind: 'npc', ref: { type: 'doc', path: 'NPCs/A.md' }, content: { title: 'A' } },
      { id: '2', kind: 'enemy', ref: { type: 'doc', path: 'Enemies/B.md' }, content: { title: 'B' } },
      { id: '3', kind: 'item', ref: { type: 'doc', path: 'Items/C.md' }, content: { title: 'C' } },
      { id: '4', kind: 'enemy', ref: { type: 'note', text: 'x' }, content: { title: 'D' } },
    ] as unknown as BoardModuleView[];
    expect(fightCards(modules)).toEqual([
      { cardId: '1', name: 'A', path: 'NPCs/A.md', kind: 'npc' },
      { cardId: '2', name: 'B', path: 'Enemies/B.md', kind: 'enemy' },
    ]);
  });
});

describe('nextTurnId', () => {
  const pc = (id: string, initiative: number | null): Combatant => ({ id, name: id, kind: 'pc', initiative, conditions: [] });
  const foe = (id: string, initiative: number | null, hp?: number): Combatant => ({ id, name: id, kind: 'enemy', initiative, hp, conditions: [] });
  const order = [pc('mira', 14), foe('ogre', 9, 20), foe('imp', 5, 4)];

  it('gives the turn to the next combatant in initiative order and wraps around', () => {
    expect(nextTurnId(order, 'mira')).toBe('ogre');
    expect(nextTurnId(order, 'ogre')).toBe('imp');
    expect(nextTurnId(order, 'imp')).toBe('mira');
  });

  it('skips defeated creatures but never skips player characters', () => {
    const list = [pc('mira', 14), foe('ogre', 9, 0), foe('imp', 5, 4), pc('tor', 1)];
    expect(nextTurnId(list, 'mira')).toBe('imp');
    expect(nextTurnId(list, 'imp')).toBe('tor');
    const pcAtZero: Combatant = { ...pc('tor', 1), hp: 0 };
    expect(nextTurnId([pc('mira', 14), pcAtZero], 'mira')).toBe('tor');
  });

  it('starts with the first combatant when there is no active one', () => {
    expect(nextTurnId(order, null)).toBe('mira');
    expect(nextTurnId(order, 'unknown')).toBe('mira');
  });

  it('returns the first playable one when everyone but the player characters is defeated', () => {
    const list = [foe('ogre', 9, 0), pc('mira', 14), foe('imp', 5, 0)];
    expect(nextTurnId(list, 'ogre')).toBe('mira');
    expect(nextTurnId(list, 'mira')).toBe('mira');
  });

  it('returns null when nobody can take the turn', () => {
    expect(nextTurnId([], null)).toBeNull();
    expect(nextTurnId([foe('ogre', 9, 0), foe('imp', 5, 0)], null)).toBeNull();
  });
});

describe('notices and conditions', () => {
  const t = (key: TranslationKey, params?: TranslationParams) => lookup(DICTIONARIES, 'en', key, params);
  const rules = {
    conditions: [{ id: 'prone', label: 'Prone' }, { id: 'stunned', label: 'Stunned' }],
    durations: [{ id: 'until_removed', label: 'Until removed' }, { id: 'rounds', label: 'Rounds' }],
  };
  const at = '2026-11-13T10:00:00Z';

  it('writes each kind of notice as a sentence, with the condition label', () => {
    expect(noticeText({ at, kind: 'condition-ended', id: 'c-ogre', name: 'Ogre', condition: 'prone' }, rules, t)).toBe('Ogre: Prone ends');
    expect(noticeText({ at, kind: 'defeated', id: 'c-ogre', name: 'Ogre' }, rules, t)).toBe('Ogre is defeated');
    expect(noticeText({ at, kind: 'unconscious', id: 'c-mira', name: 'Mira' }, rules, t)).toBe('Mira is unconscious');
    expect(noticeText({ at, kind: 'turn', id: 'c-ogre', name: 'Ogre' }, rules, t)).toBe("It is Ogre's turn");
    expect(noticeText({ at, kind: 'turn', id: 'c-ogre', name: 'Ogre', round: 3, newRound: true }, rules, t)).toBe("Round 3: Ogre's turn");
  });

  it('falls back to the condition id when the rules do not name it', () => {
    expect(noticeText({ at, kind: 'condition-ended', id: 'c-ogre', name: 'Ogre', condition: 'Blessed' }, null, t)).toBe('Ogre: Blessed ends');
  });

  it('summarises a condition with its duration and rounds', () => {
    expect(conditionSummary('prone', { duration: 'until_removed' }, rules, t)).toBe('Prone · Until removed');
    expect(conditionSummary('stunned', { duration: 'rounds', rounds: 2 }, rules, t)).toBe('Stunned · Rounds · 2 round');
    expect(conditionSummary('prone', undefined, null, t)).toBe('prone');
  });

  it('groups actions by group label in first-appearance order', () => {
    const groups = groupActions([
      { name: 'a', groupLabel: 'Attacks' },
      { name: 'b', groupLabel: 'Reactions' },
      { name: 'c', groupLabel: 'Attacks' },
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Attacks', 'Reactions']);
    expect(groups[0]!.actions.map((a) => a.name)).toEqual(['a', 'c']);
  });
});

describe('cardGroups', () => {
  const act = (name: string, cost: CardAction['cost'], timing: CardAction['timing']): CardAction => ({
    name,
    cost,
    timing,
    kind: 'attack',
    effect: name,
  });
  const card: ActionCard = {
    sheet: 'Enemies/Ogre.md',
    sheetHash: 'h',
    at: '2026-11-13T10:00:00Z',
    actions: [
      act('Legend', 'legendary', 'others_turns'),
      act('Parry', 'reaction', 'others_turns'),
      act('Greatclub', 'action', 'own_turn'),
      act('Shove', 'action', 'own_turn'),
      act('Rush', 'movement', 'own_turn'),
      act('Breath', 'free', 'any_turn'),
      act('Bonus claw', 'bonus', 'own_turn'),
      act('Hidden', 'action', 'others_turns'),
    ],
  };

  it('groups the own-turn actions by cost in the fixed order and drops empty groups', () => {
    const groups = cardGroups(card, ['own_turn']);
    expect(groups.map((g) => g.cost)).toEqual(['action', 'bonus', 'movement']);
    expect(groups[0]!.actions.map((a) => a.name)).toEqual(['Greatclub', 'Shove']);
  });

  it('keeps only the actions with one of the given timings', () => {
    const groups = cardGroups(card, ['any_turn', 'others_turns']);
    expect(groups.map((g) => g.cost)).toEqual(['action', 'free', 'reaction', 'legendary']);
    expect(groups.flatMap((g) => g.actions.map((a) => a.name))).toEqual(['Hidden', 'Breath', 'Parry', 'Legend']);
  });

  it('returns no groups when no action matches', () => {
    expect(cardGroups({ ...card, actions: [] }, ['own_turn'])).toEqual([]);
  });
});

describe('statsKey with pending', () => {
  const goblin = { kind: 'enemy' as const, hp: 7, maxHp: 7, tempHp: undefined };

  it('differs when the card is pending, so the stats are asked again when it arrives', () => {
    expect(statsKey(goblin, true)).not.toBe(statsKey(goblin, false));
    expect(statsKey(goblin)).toBe(statsKey(goblin, false));
    expect(statsKey(goblin, true)).toBe('7/7/|p');
  });

  it('stays null for player characters, pending or not', () => {
    expect(statsKey({ kind: 'pc', hp: 7, maxHp: 7 }, true)).toBeNull();
    expect(statsKey({ kind: 'pc', hp: 7, maxHp: 7 }, false)).toBeNull();
  });
});
