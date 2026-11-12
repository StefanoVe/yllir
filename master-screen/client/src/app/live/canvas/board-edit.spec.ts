import { describe, expect, it } from 'vitest';
import type { Board, BoardCard, BoardFrame } from '@shared/types';
import {
  CARD_MIN,
  addArrow,
  addCard,
  addFrame,
  moveCard,
  moveFrame,
  raiseCard,
  removeArrow,
  removeCard,
  removeFrame,
  removeSelection,
  resizeCard,
  setArrowLabel,
  setCardFrame,
  setCardText,
  setFrameTitle,
} from './board-edit';
import { COORD_LIMIT } from './geometry';

const card = (id: string, extra: Partial<BoardCard> = {}): BoardCard => ({
  id,
  kind: 'note',
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  z: 1,
  ...extra,
});

const frame = (id: string, extra: Partial<BoardFrame> = {}): BoardFrame => ({
  id,
  title: 'Scene',
  x: 0,
  y: 0,
  w: 400,
  h: 300,
  ...extra,
});

const empty = (): Board => ({ revision: 3, cards: [], frames: [], arrows: [] });

describe('card reducers', () => {
  it('adds a card on top and ignores a duplicate id', () => {
    let board = addCard(empty(), card('a', { z: 0 }));
    board = addCard(board, card('b', { z: 0 }));
    expect(board.cards.map((c) => c.z)).toEqual([1, 2]);
    expect(addCard(board, card('a'))).toBe(board);
  });

  it('moves a card and clamps it to the coordinate limit', () => {
    const board = addCard(empty(), card('a'));
    expect(moveCard(board, 'a', 40, 80).cards[0]).toMatchObject({ x: 40, y: 80 });
    expect(moveCard(board, 'a', 99999, -99999).cards[0]).toMatchObject({ x: COORD_LIMIT, y: -COORD_LIMIT });
  });

  it('resizes a card but not below the minimum', () => {
    const board = addCard(empty(), card('a'));
    expect(resizeCard(board, 'a', 10, 10).cards[0]).toMatchObject({ w: CARD_MIN.w, h: CARD_MIN.h });
    expect(resizeCard(board, 'a', 300, 200).cards[0]).toMatchObject({ w: 300, h: 200 });
  });

  it('removes a card together with the arrows that touch it', () => {
    let board = addCard(empty(), card('a'));
    board = addCard(board, card('b'));
    board = addCard(board, card('c'));
    board = addArrow(board, { id: 'x1', from: 'a', to: 'b' });
    board = addArrow(board, { id: 'x2', from: 'b', to: 'c' });
    const after = removeCard(board, 'a');
    expect(after.cards.map((c) => c.id)).toEqual(['b', 'c']);
    expect(after.arrows.map((a) => a.id)).toEqual(['x2']);
  });

  it('raises a card only when it is not already on top', () => {
    let board = addCard(empty(), card('a', { z: 1 }));
    board = addCard(board, card('b', { z: 2 }));
    expect(raiseCard(board, 'b')).toBe(board);
    const raised = raiseCard(board, 'a');
    expect(raised.cards.find((c) => c.id === 'a')?.z).toBe(3);
  });

  it('sets text and the frame, and removes the frame when given undefined', () => {
    let board = addCard(empty(), card('a'));
    board = setCardText(board, 'a', 'hello');
    board = setCardFrame(board, 'a', 'f1');
    expect(board.cards[0]).toMatchObject({ text: 'hello', frame: 'f1' });
    board = setCardFrame(board, 'a', undefined);
    expect(board.cards[0].frame).toBeUndefined();
    expect('frame' in board.cards[0]).toBe(false);
  });
});

describe('frame reducers', () => {
  it('moves a frame and carries the cards that belong to it, not the others', () => {
    let board = addFrame(empty(), frame('f1', { x: 100, y: 100 }));
    board = addCard(board, card('inside', { x: 120, y: 140, frame: 'f1' }));
    board = addCard(board, card('outside', { x: 500, y: 500 }));
    const moved = moveFrame(board, 'f1', 160, 60);
    expect(moved.frames[0]).toMatchObject({ x: 160, y: 60 });
    expect(moved.cards.find((c) => c.id === 'inside')).toMatchObject({ x: 180, y: 100 });
    expect(moved.cards.find((c) => c.id === 'outside')).toMatchObject({ x: 500, y: 500 });
  });

  it('removes a frame: its cards stay, lose the frame, and its arrows go', () => {
    let board = addFrame(empty(), frame('f1'));
    board = addCard(board, card('c1', { frame: 'f1' }));
    board = addCard(board, card('c2'));
    board = addArrow(board, { id: 'x1', from: 'f1', to: 'c2' });
    const after = removeFrame(board, 'f1');
    expect(after.frames).toEqual([]);
    expect(after.cards.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(after.cards[0].frame).toBeUndefined();
    expect(after.arrows).toEqual([]);
  });

  it('sets the title', () => {
    const board = addFrame(empty(), frame('f1'));
    expect(setFrameTitle(board, 'f1', 'Arrival').frames[0].title).toBe('Arrival');
  });
});

describe('arrow reducers', () => {
  it('accepts a link between two existing items only', () => {
    let board = addCard(empty(), card('a'));
    board = addCard(board, card('b'));
    expect(addArrow(board, { id: 'x', from: 'a', to: 'a' })).toBe(board);
    expect(addArrow(board, { id: 'x', from: 'a', to: 'missing' })).toBe(board);
    const linked = addArrow(board, { id: 'x', from: 'a', to: 'b' });
    expect(linked.arrows).toEqual([{ id: 'x', from: 'a', to: 'b' }]);
    expect(addArrow(linked, { id: 'y', from: 'a', to: 'b' })).toBe(linked);
  });

  it('trims and caps labels, and an empty label is removed', () => {
    let board = addArrow(addFrame(addCard(empty(), card('a')), frame('f')), { id: 'x', from: 'a', to: 'f' });
    board = setArrowLabel(board, 'x', '  leads to  ');
    expect(board.arrows[0].label).toBe('leads to');
    board = setArrowLabel(board, 'x', '   ');
    expect('label' in board.arrows[0]).toBe(false);
  });

  it('removes an arrow and dispatches removal by selection kind', () => {
    let board = addArrow(addFrame(addCard(empty(), card('a')), frame('f')), { id: 'x', from: 'a', to: 'f' });
    expect(removeArrow(board, 'x').arrows).toEqual([]);
    expect(removeSelection(board, { kind: 'arrow', id: 'x' }).arrows).toEqual([]);
    expect(removeSelection(board, { kind: 'card', id: 'a' }).cards).toEqual([]);
    expect(removeSelection(board, { kind: 'frame', id: 'f' }).frames).toEqual([]);
  });
});
