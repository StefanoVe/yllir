// GET /api/atlas, POST /api/atlas/generate, POST /api/atlas/render, GET /api/atlas/preview.png, and the
// built master site at /atlas/* (read-only, its own strict CSP). Owner: master-screen server.
import fs from 'node:fs/promises';
import express, { type Router } from 'express';
import { z } from 'zod';
import { campaignLanguage } from '../chat/text.js';
import type { Ctx } from '../context.js';
import { wrap } from '../http.js';
import { resolveSiteFile } from '../encyclopedia/site.js';
import { type AtlasService, createAtlasService } from '../atlas/service.js';
import { ATLAS_SITE_CSP, resolveAtlasSiteRoot } from '../atlas/site.js';
import { ATLAS_TEXTS } from '../atlas/texts.js';

export interface AtlasRouteOptions {
  /** Service to use. Omitted: the one that reads the framework and runs the generation through the campaign's chat. */
  service?: AtlasService;
}

const startSchema = z.object({ mode: z.enum(['create', 'update']) });

function textsOf(ctx: Ctx) {
  return ATLAS_TEXTS[campaignLanguage(ctx.campaignRoot)];
}

export function registerAtlasRoutes(api: Router, ctx: Ctx, options: AtlasRouteOptions = {}): void {
  const service = options.service ?? createAtlasService(ctx);
  const texts = () => textsOf(ctx);

  api.get(
    '/atlas',
    wrap(async (_req, res) => {
      try {
        res.json(await service.status());
      } catch (err) {
        ctx.log(`atlas status failed: ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ error: texts().readFailed });
      }
    }),
  );

  api.post(
    '/atlas/generate',
    wrap(async (req, res) => {
      const body = startSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: texts().invalidMode });
        return;
      }
      try {
        const started = await service.generation.start(body.data.mode);
        if (!started.ok) {
          res.status(started.code).json({ error: started.error });
          return;
        }
        res.status(202).json({ ok: true, status: await service.status() });
      } catch (err) {
        ctx.log(`atlas generation failed: ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ error: texts().readFailed });
      }
    }),
  );

  api.post(
    '/atlas/render',
    wrap(async (_req, res) => {
      try {
        const answer = await service.render();
        res.status(answer.status).json(answer.body);
      } catch (err) {
        ctx.log(`atlas redraw failed: ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ ok: false, error: texts().redrawFailed });
      }
    }),
  );

  api.get(
    '/atlas/preview.png',
    wrap(async (_req, res) => {
      const file = service.previewPath();
      let data: Buffer;
      try {
        if (file === null) throw new Error('no preview');
        data = await fs.readFile(file);
      } catch {
        res.status(404).json({ error: texts().noSite });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.type('png').send(data);
    }),
  );
}

/** The router mounted at /atlas. Every request is answered here; it never falls through to the client. */
export function createAtlasSiteRouter(ctx: Ctx): Router {
  const router = express.Router();
  router.use(
    wrap(async (req, res) => {
      const notFound = (message: string): void => {
        res.status(404).json({ error: message });
      };
      const siteRoot = await resolveAtlasSiteRoot(ctx.campaignRoot);
      if (siteRoot === null) {
        notFound(textsOf(ctx).noSite);
        return;
      }
      const file = await resolveSiteFile(siteRoot, req.path);
      if (file === null) {
        notFound(textsOf(ctx).notFound);
        return;
      }
      res.setHeader('Content-Security-Policy', ATLAS_SITE_CSP);
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache');
      const serve = express.static(siteRoot, { dotfiles: 'deny', index: ['index.html'], fallthrough: true });
      serve(req, res, () => notFound(textsOf(ctx).notFound));
    }),
  );
  return router;
}
