import { describe, expect, it } from 'vitest';
import type { BoardModuleView } from '@shared/cockpit-types';
import {
  buildCombatStart,
  byInitiative,
  cellAt,
  fightCards,
  hpPercent,
  initials,
  parseInitiative,
  percentAt,
  stepCell,
} from './combat-model';

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
