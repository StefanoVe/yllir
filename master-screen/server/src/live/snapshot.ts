// The live snapshot (GET /api/live) and its revision. The revision is a sha1 over the
// mtimes and sizes of the four state files of the active session, so it changes whenever
// one of them changes on disk, whoever wrote it (this server, the agent, the terminal).
// It reads only the live state folder, never canon.
// Owner: live engineer.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LiveSnapshot } from '../../../shared/src/types.js';
import type { Ctx } from '../context.js';
import { readBoard, emptyBoard } from './board.js';
import { callCombat, callLog, type LibResult } from './framework.js';

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const SESSION_FILES = ['session.json', 'log.json', 'combat.json', 'board.json'];

export function liveDirOf(root: string): string {
  return path.join(root, '.campaign', 'state', 'live');
}

/** The active session id from live/active.json, or null when none is open or the file is odd. */
export async function readActiveId(root: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(liveDirOf(root), 'active.json'), 'utf8'));
    const id = (parsed as { sessionId?: unknown } | null)?.sessionId;
    return typeof id === 'string' && SESSION_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Hash of the active session id and of the mtimes and sizes of its four files. Never throws. */
export async function liveRevision(root: string): Promise<string> {
  const id = await readActiveId(root);
  const hash = crypto.createHash('sha1');
  hash.update(`active:${id ?? ''}\n`);
  if (id !== null) {
    for (const name of SESSION_FILES) {
      const rel = `${id}/${name}`;
      try {
        const stat = await fs.stat(path.join(liveDirOf(root), rel), { bigint: true });
        hash.update(`${rel}:${stat.mtimeNs}:${stat.size}\n`);
      } catch {
        hash.update(`${rel}:-\n`);
      }
    }
  }
  return hash.digest('hex');
}

/** The snapshot of the live session. Nothing is read from canon. */
export async function buildSnapshot(ctx: Ctx): Promise<LibResult<{ snapshot: LiveSnapshot }>> {
  const root = ctx.campaignRoot;
  const revision = await liveRevision(root);
  const active = await callLog(ctx, (lib) => lib.getActive(root));
  if (!active.ok) return active;
  const session = active.session;
  if (session === null) {
    return { ok: true, snapshot: { session: null, log: [], combat: null, board: emptyBoard(), revision } };
  }
  const entries = await callLog(ctx, (lib) => lib.listEntries(root));
  if (!entries.ok) return entries;
  const combat = await callCombat(ctx, (lib) => lib.getCombat(root));
  if (!combat.ok) return combat;
  const board = await readBoard(root, session.id, ctx.log);
  return {
    ok: true,
    snapshot: { session, log: entries.entries, combat: combat.combat, board, revision },
  };
}

/**
 * Publishes the SSE `live` event. The shared LiveEvent union does not list it yet, so the
 * publish is typed here instead of in shared/src/types.ts.
 */
export function publishLive(ctx: Ctx, revision: string): void {
  (ctx.bus as unknown as { publish(event: string, data: { revision: string }): number }).publish('live', {
    revision,
  });
}
