// GET /projector: the current projection. GET /projector/events: SSE stream of the projection.
// GET /projector/check: whether a source may be projected. POST /projector: set the projection.
// A combat projection is rebuilt from the server state (battle host and live session), never
// from the client. Owner: projector.
import type { Router } from 'express';
import type { ProjectableResponse, ProjectRequest, Projection } from '../../../shared/src/types.js';
import type { BattleHost } from '../cockpit-host/battle.js';
import type { Ctx } from '../context.js';
import { wrap } from '../http.js';
import { projectorFor, resolveSrc } from '../projector/projector.js';

const MAX_SRC_LENGTH = 2048;

/** The body of POST /projector, or null when it is not exactly one of the three kinds. */
function parseProjectRequest(body: unknown): ProjectRequest | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.kind === 'blank') return Object.keys(record).length === 1 ? { kind: 'blank' } : null;
  if (record.kind === 'combat') return Object.keys(record).length === 1 ? { kind: 'combat' } : null;
  if (record.kind === 'image') {
    if (Object.keys(record).length !== 2 || typeof record.src !== 'string') return null;
    if (record.src.length > MAX_SRC_LENGTH) return null;
    return { kind: 'image', src: record.src };
  }
  return null;
}

export function registerProjectorRoutes(app: Router, ctx: Ctx, battle: BattleHost): void {
  app.get(
    '/projector',
    wrap(async (_req, res) => {
      res.json(await projectorFor(ctx, battle).current());
    }),
  );

  app.get('/projector/events', (_req, res) => {
    void projectorFor(ctx, battle).subscribe(res);
  });

  app.get(
    '/projector/check',
    wrap(async (req, res) => {
      const src = typeof req.query.src === 'string' ? req.query.src : '';
      const body: ProjectableResponse = { projectable: (await resolveSrc(ctx, src, req.headers.host)) !== null };
      res.json(body);
    }),
  );

  app.post(
    '/projector',
    wrap(async (req, res) => {
      const request = parseProjectRequest(req.body);
      if (request === null) {
        res.status(400).json({ error: 'The request could not be read.' });
        return;
      }
      const projector = projectorFor(ctx, battle);
      if (request.kind === 'blank') {
        projector.set({ kind: 'blank' });
        res.json(await projector.current());
        return;
      }
      if (request.kind === 'combat') {
        res.json(await projector.showCombat());
        return;
      }
      const src = await resolveSrc(ctx, request.src, req.headers.host);
      if (src === null) {
        res.status(403).json({ error: 'This image cannot be shown to the players.' });
        return;
      }
      const projection: Projection = { kind: 'image', src };
      projector.set(projection);
      res.json(projection);
    }),
  );
}
