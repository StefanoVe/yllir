import { describe, expect, it } from 'vitest';
import type { Board, BoardCard } from '@shared/types';
import { MAX_CARDS, isImagePath, isSafeRelativePath, validateBoard } from './board-limits';

const doc = (id: string, extra: Partial<BoardCard> = {}): BoardCard => ({
  id,
  kind: 'document',
  ref: 'characters/alia.md',
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  z: 1,
  ...extra,
});

const board = (cards: BoardCard[]): Board => ({ revision: 0, cards, frames: [], arrows: [] });

describe('validateBoard', () => {
  it('accepts a board at the limits', () => {
    const cards = Array.from({ length: MAX_CARDS }, (_, i) => doc(`c${i}`));
    expect(validateBoard(board(cards)).ok).toBe(true);
    expect(validateBoard(board([doc('edge', { x: 20000, y: -20000 })])).ok).toBe(true);
  });

  it('rejects more than 300 cards', () => {
    const cards = Array.from({ length: MAX_CARDS + 1 }, (_, i) => doc(`c${i}`));
    const check = validateBoard(board(cards));
    expect(check.ok).toBe(false);
    expect(check.problems.join(' ')).toMatch(/at most 300/);
  });

  it('rejects coordinates outside +-20000', () => {
    expect(validateBoard(board([doc('far', { x: 20001 })])).ok).toBe(false);
    expect(validateBoard(board([doc('far', { y: -20001 })])).ok).toBe(false);
    expect(validateBoard(board([doc('nan', { x: Number.NaN })])).ok).toBe(false);
  });

  it('needs a campaign-relative ref on document and image cards', () => {
    expect(validateBoard(board([doc('none', { ref: undefined })])).ok).toBe(false);
    expect(validateBoard(board([doc('up', { ref: '../secret.md' })])).ok).toBe(false);
    expect(validateBoard(board([doc('abs', { ref: '/etc/passwd' })])).ok).toBe(false);
    expect(validateBoard(board([doc('note', { kind: 'note', ref: undefined })])).ok).toBe(true);
  });

  it('rejects a negative revision', () => {
    expect(validateBoard({ ...board([]), revision: -1 }).ok).toBe(false);
  });
});

describe('paths', () => {
  it('accepts campaign-relative paths only', () => {
    expect(isSafeRelativePath('characters/alia.md')).toBe(true);
    expect(isSafeRelativePath('')).toBe(false);
    expect(isSafeRelativePath('a/../b.md')).toBe(false);
    expect(isSafeRelativePath('a\\b.md')).toBe(false);
    expect(isSafeRelativePath('a\u0000b')).toBe(false);
  });

  it('accepts image paths with a known extension', () => {
    expect(isImagePath('images/map.PNG')).toBe(true);
    expect(isImagePath('images/map.svg')).toBe(true);
    expect(isImagePath('notes/map.md')).toBe(false);
    expect(isImagePath('/images/map.png')).toBe(false);
  });
});
