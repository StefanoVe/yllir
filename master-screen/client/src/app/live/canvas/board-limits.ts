import type { Board } from '@shared/types';
import { COORD_LIMIT } from './geometry';

/** Mirrors the server's board validation (master-screen/API.md): at most 300 cards, coordinates within +-20000, relative refs. */
export const MAX_CARDS = 300;
export const MAX_REF_LENGTH = 512;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg)$/i;

export interface BoardCheck {
  ok: boolean;
  /** English, for logs and tests. Never shown to the master as is. */
  problems: string[];
}

/** A campaign-relative path: no leading slash, no backslash, no `..` segment, no control characters. */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_REF_LENGTH) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  if (/[\u0000-\u001f]/.test(path)) return false;
  return !path.split('/').some((part) => part === '..');
}

export function isImagePath(path: string): boolean {
  return isSafeRelativePath(path) && IMAGE_EXTENSION.test(path);
}

export function validateBoard(board: Board): BoardCheck {
  const problems: string[] = [];
  if (!Number.isInteger(board.revision) || board.revision < 0) problems.push('revision must be a non-negative integer');
  if (board.cards.length > MAX_CARDS) problems.push(`at most ${MAX_CARDS} cards`);

  const inRange = (value: number): boolean => Number.isFinite(value) && Math.abs(value) <= COORD_LIMIT;
  const sized = (value: number): boolean => Number.isFinite(value) && value > 0 && value <= 2 * COORD_LIMIT;

  for (const card of board.cards) {
    if (!inRange(card.x) || !inRange(card.y)) problems.push(`card ${card.id} is outside +-${COORD_LIMIT}`);
    if (!sized(card.w) || !sized(card.h)) problems.push(`card ${card.id} has an invalid size`);
    if (card.kind === 'document' || card.kind === 'image') {
      if (card.ref === undefined || !isSafeRelativePath(card.ref)) problems.push(`card ${card.id} needs a campaign-relative ref`);
    }
  }
  for (const frame of board.frames) {
    if (!inRange(frame.x) || !inRange(frame.y)) problems.push(`frame ${frame.id} is outside +-${COORD_LIMIT}`);
    if (!sized(frame.w) || !sized(frame.h)) problems.push(`frame ${frame.id} has an invalid size`);
  }
  return { ok: problems.length === 0, problems };
}
