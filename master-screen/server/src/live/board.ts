// The board of a live session: a free canvas of cards, frames and arrows, owned by the
// server alone. Stored per session at <campaign>/.campaign/state/live/<sessionId>/board.json,
// written atomically (temp file + rename), mode 0600, one write at a time, with an
// optimistic revision check. Not part of undo.
// Owner: live engineer.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Board } from '../../../shared/src/types.js';
import { campaignRef, idField } from './schemas.js';

export const MAX_CARDS = 300;
export const MAX_FRAMES = 100;
export const MAX_ARROWS = 300;
export const COORD_LIMIT = 20000;

const coord = z.number().min(-COORD_LIMIT).max(COORD_LIMIT);
const side = z.number().min(40).max(4000);

const cardSchema = z.strictObject({
  id: idField,
  kind: z.enum(['document', 'image', 'note']),
  ref: campaignRef.optional(),
  text: z.string().max(4000).optional(),
  x: coord,
  y: coord,
  w: side,
  h: side,
  z: z.number().int().min(-100000).max(100000),
  frame: idField.optional(),
});

const frameSchema = z.strictObject({
  id: idField,
  title: z.string().max(200),
  x: coord,
  y: coord,
  w: side,
  h: side,
});

const arrowSchema = z.strictObject({
  id: idField,
  from: idField,
  to: idField,
  label: z.string().max(200).optional(),
});

/** Strict board validation: limits, ranges, unique ids, and arrows that point at existing items. */
export const boardSchema = z
  .strictObject({
    revision: z.number().int().min(0).max(1_000_000_000),
    cards: z.array(cardSchema).max(MAX_CARDS),
    frames: z.array(frameSchema).max(MAX_FRAMES),
    arrows: z.array(arrowSchema).max(MAX_ARROWS),
  })
  .superRefine((board, ctx) => {
    const targets = new Set<string>();
    for (const item of [...board.cards, ...board.frames]) {
      if (targets.has(item.id)) {
        ctx.addIssue({ code: 'custom', message: 'duplicate id', input: item.id });
      }
      targets.add(item.id);
    }
    const arrowIds = new Set<string>();
    for (const arrow of board.arrows) {
      if (arrowIds.has(arrow.id)) {
        ctx.addIssue({ code: 'custom', message: 'duplicate arrow id', input: arrow.id });
      }
      arrowIds.add(arrow.id);
      for (const end of [arrow.from, arrow.to]) {
        if (!targets.has(end)) {
          ctx.addIssue({ code: 'custom', message: 'arrow points at a missing item', input: end });
        }
      }
    }
  });

export function emptyBoard(): Board {
  return { revision: 0, cards: [], frames: [], arrows: [] };
}

export type ParsedBoard = { ok: true; board: Board } | { ok: false };

/** Validates unknown input as a Board. Never throws. */
export function parseBoard(input: unknown): ParsedBoard {
  const parsed = boardSchema.safeParse(input);
  return parsed.success ? { ok: true, board: parsed.data as Board } : { ok: false };
}

export function boardFile(root: string, sessionId: string): string {
  return path.join(root, '.campaign', 'state', 'live', sessionId, 'board.json');
}

/** The stored board: the empty board when there is no file, null when it cannot be read or is invalid. */
async function readStored(root: string, sessionId: string): Promise<Board | null> {
  let raw: string;
  try {
    raw = await fs.readFile(boardFile(root, sessionId), 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? emptyBoard() : null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = parseBoard(json);
  return parsed.ok ? parsed.board : null;
}

/** The board of a session. A missing or unreadable file gives the empty board. */
export async function readBoard(root: string, sessionId: string, log?: (msg: string) => void): Promise<Board> {
  const stored = await readStored(root, sessionId);
  if (stored === null) {
    log?.(`board of session ${sessionId} is not readable; showing an empty board`);
    return emptyBoard();
  }
  return stored;
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs tasks one after another; a failed task does not block the next. */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => undefined).then(task);
  queue = run.catch(() => undefined);
  return run;
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.chmod(temp, 0o600);
    await fs.rename(temp, file);
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export type SaveResult = { ok: true; board: Board } | { ok: false; board: Board };

/**
 * Replaces the board when `input.revision` equals the stored one; the stored revision then
 * grows by one. Otherwise returns the stored board with ok false (a conflict).
 */
export function saveBoard(root: string, sessionId: string, input: Board): Promise<SaveResult> {
  return serialize(async () => {
    const current = (await readStored(root, sessionId)) ?? emptyBoard();
    if (input.revision !== current.revision) return { ok: false, board: current };
    const saved: Board = {
      revision: current.revision + 1,
      cards: input.cards,
      frames: input.frames,
      arrows: input.arrows,
    };
    await writeAtomic(boardFile(root, sessionId), `${JSON.stringify(saved, null, 2)}\n`);
    return { ok: true, board: saved };
  });
}
