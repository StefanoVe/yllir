// GET /api/live and the live session endpoints: open, end, log, combat, board.
// The log and combat state belong to the framework libraries (session-log, combat-tracker);
// the board belongs to this server. Every write publishes SSE `live` with the new revision.
// Owner: live engineer.
import type { Response, Router } from 'express';
import { z } from 'zod';
import type { CombatOp } from '../../../shared/src/types.js';
import { campaignLanguage } from '../chat/text.js';
import type { Ctx } from '../context.js';
import { saveBoard, boardSchema } from '../live/board.js';
import { callCombat, callLog, INTERNAL, LIB_MISSING, type LibError } from '../live/framework.js';
import {
  combatOpBody,
  ENTRY_ID_PATTERN,
  logAddBody,
  logPatchBody,
  openBody,
} from '../live/schemas.js';
import { buildSnapshot, liveRevision, publishLive } from '../live/snapshot.js';
import { liveTexts, type LiveTexts } from '../live/text.js';
import { wrap } from '../http.js';

/** Plain-language sentence for a framework code, or its English message when the code is unknown. */
export function domainMessage(texts: LiveTexts, error: LibError): string {
  if (Object.prototype.hasOwnProperty.call(texts.codes, error.code)) return texts.codes[error.code];
  const message = error.message;
  const safe =
    typeof message === 'string' &&
    message !== '' &&
    message.length <= 300 &&
    !/[/\\]|\.(mjs|json|md)\b/.test(message);
  return safe ? message : 'The action could not be completed.';
}

/** Sends a framework refusal: 503 when the framework is too old, 500 when it broke, else 409. */
function sendRefusal(res: Response, texts: LiveTexts, error: LibError): void {
  if (error.code === LIB_MISSING) {
    res.status(503).json({ error: texts.libMissing });
    return;
  }
  if (error.code === INTERNAL) {
    res.status(500).json({ error: texts.failed });
    return;
  }
  res.status(409).json({ error: domainMessage(texts, error) });
}

function sendInvalid(res: Response, texts: LiveTexts): void {
  res.status(400).json({ error: texts.invalid });
}

/** Publishes the new revision and answers with the whole snapshot (or the refusal). */
async function sendSnapshot(ctx: Ctx, res: Response, texts: LiveTexts): Promise<void> {
  const result = await buildSnapshot(ctx);
  if (!result.ok) {
    sendRefusal(res, texts, result.error);
    return;
  }
  publishLive(ctx, result.snapshot.revision);
  res.json(result.snapshot);
}

/** Publishes after a write that has no snapshot of its own (the board). */
async function publishCurrent(ctx: Ctx): Promise<void> {
  publishLive(ctx, await liveRevision(ctx.campaignRoot));
}

export function registerLiveRoutes(app: Router, ctx: Ctx): void {
  const root = ctx.campaignRoot;
  const texts = (): LiveTexts => liveTexts(campaignLanguage(root));

  app.get(
    '/live',
    wrap(async (_req, res) => {
      const result = await buildSnapshot(ctx);
      if (!result.ok) {
        sendRefusal(res, texts(), result.error);
        return;
      }
      res.json(result.snapshot);
    }),
  );

  app.post(
    '/live/open',
    wrap(async (req, res) => {
      const parsed = openBody.safeParse(req.body ?? {});
      if (!parsed.success) return sendInvalid(res, texts());
      const result = await callLog(ctx, (lib) => lib.openSession(root, parsed.data));
      if (!result.ok) return sendRefusal(res, texts(), result.error);
      await sendSnapshot(ctx, res, texts());
    }),
  );

  app.post(
    '/live/end',
    wrap(async (_req, res) => {
      const result = await callLog(ctx, (lib) => lib.endSession(root));
      if (!result.ok) return sendRefusal(res, texts(), result.error);
      await sendSnapshot(ctx, res, texts());
    }),
  );

  app.post(
    '/live/log',
    wrap(async (req, res) => {
      const parsed = logAddBody.safeParse(req.body ?? {});
      if (!parsed.success) return sendInvalid(res, texts());
      const input = { ...parsed.data, by: 'master' as const };
      const result = await callLog(ctx, (lib) => lib.addEntry(root, input));
      if (!result.ok) return sendRefusal(res, texts(), result.error);
      await sendSnapshot(ctx, res, texts());
    }),
  );

  app.patch(
    '/live/log/:id',
    wrap(async (req, res) => {
      const id = String(req.params.id);
      if (!ENTRY_ID_PATTERN.test(id)) return sendInvalid(res, texts());
      const parsed = logPatchBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        const nothing = parsed.error.issues.some((issue) => issue.message === 'nothing to change');
        res.status(400).json({ error: nothing ? texts().emptyPatch : texts().invalid });
        return;
      }
      const result = await callLog(ctx, (lib) => lib.updateEntry(root, id, parsed.data));
      if (!result.ok) return sendRefusal(res, texts(), result.error);
      await sendSnapshot(ctx, res, texts());
    }),
  );

  app.delete(
    '/live/log/:id',
    wrap(async (req, res) => {
      const id = String(req.params.id);
      if (!ENTRY_ID_PATTERN.test(id)) return sendInvalid(res, texts());
      const result = await callLog(ctx, (lib) => lib.removeEntry(root, id));
      if (!result.ok) return sendRefusal(res, texts(), result.error);
      await sendSnapshot(ctx, res, texts());
    }),
  );

  app.post(
    '/live/combat',
    wrap(async (req, res) => {
      const parsed = combatOpBody.safeParse(req.body ?? {});
      if (!parsed.success) return sendInvalid(res, texts());
      const op = parsed.data as CombatOp;
      const result = await callCombat(ctx, (lib) => lib.applyOp(root, op));
      if (!result.ok) return sendRefusal(res, texts(), result.error);
      await sendSnapshot(ctx, res, texts());
    }),
  );

  app.put(
    '/live/board',
    wrap(async (req, res) => {
      const current = texts();
      const session = await callLog(ctx, (lib) => lib.getActive(root));
      if (!session.ok) return sendRefusal(res, current, session.error);
      if (session.session === null) {
        sendRefusal(res, current, { code: 'no-live-session', message: 'No live session is open.' });
        return;
      }
      const parsed = boardSchema.safeParse(req.body);
      if (!parsed.success) return sendInvalid(res, current);
      const saved = await saveBoard(root, session.session.id, parsed.data);
      if (!saved.ok) {
        res.status(409).json({ error: current.boardConflict, board: saved.board });
        return;
      }
      await publishCurrent(ctx);
      res.json({ board: saved.board });
    }),
  );
}
