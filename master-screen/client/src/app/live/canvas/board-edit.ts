import type { Board, BoardArrow, BoardCard, BoardFrame } from '@shared/types';
import { clampCoord } from './geometry';

/** Smallest sizes a user can resize to. */
export const CARD_MIN = { w: 120, h: 80 };
export const FRAME_MIN = { w: 160, h: 120 };
export const ARROW_LABEL_MAX = 80;

export type ItemSelection = { kind: 'card' | 'frame' | 'arrow'; id: string };

/** Pure reducers over Board. Each returns a new Board and never mutates its input. */

export function addCard(board: Board, card: BoardCard): Board {
  if (board.cards.some((c) => c.id === card.id)) return board;
  return { ...board, cards: [...board.cards, { ...card, z: nextZ(board) }] };
}

export function moveCard(board: Board, id: string, x: number, y: number): Board {
  return mapCard(board, id, (c) => ({ ...c, x: clampCoord(x), y: clampCoord(y) }));
}

export function resizeCard(board: Board, id: string, w: number, h: number): Board {
  return mapCard(board, id, (c) => ({
    ...c,
    w: Math.max(CARD_MIN.w, w),
    h: Math.max(CARD_MIN.h, h),
  }));
}

export function setCardText(board: Board, id: string, text: string): Board {
  return mapCard(board, id, (c) => ({ ...c, text }));
}

export function setCardFrame(board: Board, id: string, frame: string | undefined): Board {
  return mapCard(board, id, (c) => {
    const { frame: _previous, ...rest } = c;
    return frame === undefined ? rest : { ...rest, frame };
  });
}

/** Brings the card to the front. A no-op when it is already the top card. */
export function raiseCard(board: Board, id: string): Board {
  const card = board.cards.find((c) => c.id === id);
  if (!card) return board;
  const top = Math.max(...board.cards.map((c) => c.z));
  if (card.z >= top) return board;
  return mapCard(board, id, (c) => ({ ...c, z: top + 1 }));
}

/** Removes a card and every arrow that starts or ends on it. */
export function removeCard(board: Board, id: string): Board {
  return {
    ...board,
    cards: board.cards.filter((c) => c.id !== id),
    arrows: board.arrows.filter((a) => a.from !== id && a.to !== id),
  };
}

export function addFrame(board: Board, frame: BoardFrame): Board {
  if (board.frames.some((f) => f.id === frame.id)) return board;
  return { ...board, frames: [...board.frames, frame] };
}

/** Moves a frame and every card that belongs to it by the same offset. */
export function moveFrame(board: Board, id: string, x: number, y: number): Board {
  const frame = board.frames.find((f) => f.id === id);
  if (!frame) return board;
  const nx = clampCoord(x);
  const ny = clampCoord(y);
  const dx = nx - frame.x;
  const dy = ny - frame.y;
  return {
    ...board,
    frames: board.frames.map((f) => (f.id === id ? { ...f, x: nx, y: ny } : f)),
    cards: board.cards.map((c) =>
      c.frame === id ? { ...c, x: clampCoord(c.x + dx), y: clampCoord(c.y + dy) } : c,
    ),
  };
}

export function resizeFrame(board: Board, id: string, w: number, h: number): Board {
  return mapFrame(board, id, (f) => ({ ...f, w: Math.max(FRAME_MIN.w, w), h: Math.max(FRAME_MIN.h, h) }));
}

export function setFrameTitle(board: Board, id: string, title: string): Board {
  return mapFrame(board, id, (f) => ({ ...f, title }));
}

/** Removes a frame. Its cards stay on the table; its arrows are removed. */
export function removeFrame(board: Board, id: string): Board {
  return {
    ...board,
    frames: board.frames.filter((f) => f.id !== id),
    cards: board.cards.map((c) => {
      if (c.frame !== id) return c;
      const { frame: _gone, ...rest } = c;
      return rest;
    }),
    arrows: board.arrows.filter((a) => a.from !== id && a.to !== id),
  };
}

/** Adds an arrow between two existing cards or frames. Self-links, duplicates and dangling ends are ignored. */
export function addArrow(board: Board, arrow: BoardArrow): Board {
  if (arrow.from === arrow.to) return board;
  if (!hasItem(board, arrow.from) || !hasItem(board, arrow.to)) return board;
  if (board.arrows.some((a) => a.from === arrow.from && a.to === arrow.to)) return board;
  return { ...board, arrows: [...board.arrows, arrow] };
}

export function setArrowLabel(board: Board, id: string, label: string): Board {
  const trimmed = label.trim().slice(0, ARROW_LABEL_MAX);
  return {
    ...board,
    arrows: board.arrows.map((a) => {
      if (a.id !== id) return a;
      const { label: _previous, ...rest } = a;
      return trimmed === '' ? rest : { ...rest, label: trimmed };
    }),
  };
}

export function removeArrow(board: Board, id: string): Board {
  return { ...board, arrows: board.arrows.filter((a) => a.id !== id) };
}

export function removeSelection(board: Board, selection: ItemSelection): Board {
  if (selection.kind === 'card') return removeCard(board, selection.id);
  if (selection.kind === 'frame') return removeFrame(board, selection.id);
  return removeArrow(board, selection.id);
}

/** Whether a card or frame with this id exists on the board. */
export function hasItem(board: Board, id: string): boolean {
  return board.cards.some((c) => c.id === id) || board.frames.some((f) => f.id === id);
}

function nextZ(board: Board): number {
  return board.cards.length === 0 ? 1 : Math.max(...board.cards.map((c) => c.z)) + 1;
}

function mapCard(board: Board, id: string, change: (card: BoardCard) => BoardCard): Board {
  if (!board.cards.some((c) => c.id === id)) return board;
  return { ...board, cards: board.cards.map((c) => (c.id === id ? change(c) : c)) };
}

function mapFrame(board: Board, id: string, change: (frame: BoardFrame) => BoardFrame): Board {
  if (!board.frames.some((f) => f.id === id)) return board;
  return { ...board, frames: board.frames.map((f) => (f.id === id ? change(f) : f)) };
}
