// GET /api/update, POST /api/update/check, POST /api/update/snooze and POST /api/update/apply:
// the framework update of the master screen. The logic lives in update/service.ts. Owner: update engineer.
import type { Router } from 'express';
import type { Ctx } from '../context.js';
import { wrap } from '../http.js';
import { createUpdateService, type UpdateService } from '../update/service.js';

export interface UpdateRouteOptions {
  /** Service to use. Omitted: the one that checks the published framework and runs the update. */
  service?: UpdateService;
}

export function registerUpdateRoutes(app: Router, ctx: Ctx, options: UpdateRouteOptions = {}): void {
  const service = options.service ?? createUpdateService(ctx);

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
      // The 202 is sent before the update starts, so the shutdown that follows a restart never cuts it off.
      const result = await service.apply(() => {
        res.status(202).json({ ok: true });
      });
      if (!result.ok) res.status(409).json({ error: result.error });
    }),
  );
}
