// GET /api/changes, GET /api/changes/:id/diff, POST /api/changes/undo.
// Owner: history engineer.
import fs from 'node:fs';
import path from 'node:path';
import type { Router } from 'express';
import type { ChangesResponse, DiffResponse, UndoResponse } from '../../../shared/src/types.js';
import { readCampaignSummary } from '../campaign.js';
import type { Ctx } from '../context.js';
import { canonFiles, isHiddenPath, loadHistory, type HistoryItem } from '../history/groups.js';
import { diff, isCleanCanon, resolveCommit, revert, showFiles, SHA_PATTERN } from '../history/git.js';
import { langOf, messages, type Messages } from '../history/text.js';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function describe(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}

function parseLimit(raw: unknown): number {
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(value) || value < 1) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
}

async function textsFor(ctx: Ctx): Promise<Messages> {
  return messages(langOf((await readCampaignSummary(ctx)).campaign.language));
}

/** Runs tasks one after another. A failed task does not block the next one. */
function createQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

interface Refusal {
  status: number;
  body: UndoResponse;
}

function refuse(status: number, message: string): Refusal {
  return { status, body: { ok: false, message } };
}

async function performUndo(ctx: Ctx, requested: string | undefined): Promise<Refusal | { status: 200; body: UndoResponse }> {
  const texts = await textsFor(ctx);
  const root = ctx.campaignRoot;
  const items: HistoryItem[] = await loadHistory(ctx);

  let target: HistoryItem | undefined;
  if (requested !== undefined) {
    const wanted = requested.toLowerCase();
    target = items.find((item) => item.group.id.startsWith(wanted));
    if (!target) return refuse(404, texts.notFound);
    if (target.group.isUndo) return refuse(409, texts.undoOfUndo);
    if (target.group.undone) return refuse(409, texts.alreadyUndone);
  } else {
    target = items.find((item) => !item.group.undone && !item.group.isUndo);
    if (!target) return refuse(409, texts.nothingToUndo);
  }

  if (!(await isCleanCanon(root, isHiddenPath))) return refuse(409, texts.dirty);

  const touched = canonFiles(await showFiles(root, target.group.id));
  const outcome = await revert(root, target.group.id, target.subject);
  if (outcome === 'conflict') return refuse(409, texts.conflict);
  if (outcome === 'nothing') return refuse(409, texts.nothingToUndo);
  if (outcome === 'failed') return refuse(409, texts.failed);

  const paths = [...new Set(touched.flatMap((file) => (file.from ? [file.path, file.from] : [file.path])))];
  const changed = paths.filter((p) => fs.existsSync(path.join(root, p)));
  const removed = paths.filter((p) => !changed.includes(p));
  ctx.bus.publish('changes', {});
  ctx.bus.publish('files', { changed, removed });
  return { status: 200, body: { ok: true, message: texts.done(target.group.summary), groupId: target.group.id } };
}

export function registerChangesRoutes(app: Router, ctx: Ctx): void {
  const runUndo = createQueue();

  app.get('/changes', async (req, res) => {
    try {
      const limit = parseLimit(req.query.limit);
      const items = await loadHistory(ctx);
      const body: ChangesResponse = { groups: items.slice(0, limit).map((item) => item.group) };
      res.json(body);
    } catch (err) {
      ctx.log(`changes failed: ${describe(err)}`);
      res.status(500).json({ error: (await textsFor(ctx)).unreadable });
    }
  });

  app.get('/changes/:id/diff', async (req, res) => {
    const id = String(req.params.id);
    if (!SHA_PATTERN.test(id)) {
      res.status(400).json({ error: (await textsFor(ctx)).badId });
      return;
    }
    try {
      const sha = await resolveCommit(ctx.campaignRoot, id);
      if (sha === null) {
        res.status(404).json({ error: (await textsFor(ctx)).notFound });
        return;
      }
      const files = (await diff(ctx.campaignRoot, sha)).filter((file) => !isHiddenPath(file.path));
      const body: DiffResponse = { id: sha, files };
      res.json(body);
    } catch (err) {
      ctx.log(`change diff failed: ${describe(err)}`);
      res.status(500).json({ error: (await textsFor(ctx)).unreadable });
    }
  });

  app.post('/changes/undo', async (req, res) => {
    const input = (req.body ?? {}) as { id?: unknown };
    const raw = input.id ?? undefined;
    if (raw !== undefined && (typeof raw !== 'string' || !SHA_PATTERN.test(raw))) {
      res.status(400).json({ ok: false, message: (await textsFor(ctx)).badId } satisfies UndoResponse);
      return;
    }
    try {
      const result = await runUndo(() => performUndo(ctx, raw));
      res.status(result.status).json(result.body);
    } catch (err) {
      ctx.log(`undo failed: ${describe(err)}`);
      res.status(500).json({ ok: false, message: (await textsFor(ctx)).failed } satisfies UndoResponse);
    }
  });
}
