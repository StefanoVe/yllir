// GET /api/update, POST /api/update/check, POST /api/update/snooze, POST /api/update/apply,
// GET /api/update/align and POST /api/update/align/start: the framework update of the master screen
// and the campaign alignment after it. The logic lives in update/service.ts and update/align.ts.
// Owner: update engineer.
import type { Router } from 'express';
import type { Ctx } from '../context.js';
import { wrap } from '../http.js';
import { createAlignService, type AlignService } from '../update/align.js';
import { createUpdateService, type UpdateService } from '../update/service.js';

export interface UpdateRouteOptions {
  /** Service to use. Omitted: the one that checks the published framework and runs the update. */
  service?: UpdateService;
  /** Alignment to use. Omitted: the one that runs the alignment through the campaign's chat. */
  align?: AlignService;
}

export function registerUpdateRoutes(app: Router, ctx: Ctx, options: UpdateRouteOptions = {}): void {
  const service = options.service ?? createUpdateService(ctx);
  const align = options.align ?? createAlignService(ctx);

  app.get(
    '/update',
    wrap(async (_req, res) => {
      res.json(await service.status());
    }),
  );

  app.post(
    '/update/check',
    wrap(async (_req, res) => {
      res.json(await service.check());
    }),
  );

  app.post(
    '/update/snooze',
    wrap(async (_req, res) => {
      res.json(await service.snooze());
    }),
  );

  app.post(
    '/update/apply',
    wrap(async (_req, res) => {
      // The campaign alignment owns the campaign while it runs or waits for the master.
      const blocked = align.applyBlocked();
      if (blocked !== null) {
        res.status(409).json({ error: blocked });
        return;
      }
      // The 202 is sent before the update starts, so the shutdown that follows a restart never cuts it off.
      const result = await service.apply(() => {
        res.status(202).json({ ok: true });
      });
      if (!result.ok) res.status(409).json({ error: result.error });
    }),
  );

  app.get(
    '/update/align',
    wrap(async (_req, res) => {
      res.json(await align.status());
    }),
  );

  app.post(
    '/update/align/start',
    wrap(async (_req, res) => {
      const started = await align.start();
      if (started.ok) res.status(202).json(started.status);
      else res.status(started.code).json({ error: started.error });
    }),
  );
}
