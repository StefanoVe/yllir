// GET /api/encyclopedia, POST /api/encyclopedia/build, and the read-only built site at /enc/*.
// Off module: no framework call. The site is served only with a build present, with its own
// strict CSP. Owner: master-screen server.
import express, { type Router } from 'express';
import type { Ctx } from '../context.js';
import { wrap } from '../http.js';
import {
  buildEncyclopedia,
  encyclopediaEnabled,
  encyclopediaTexts,
  readEncyclopediaStatus,
} from '../encyclopedia/service.js';
import { resolveSiteFile, resolveSiteRoot } from '../encyclopedia/site.js';

/** The strict CSP of the built site. Only these responses carry it, never the main app. */
export const SITE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

export function registerEncyclopediaRoutes(api: Router, ctx: Ctx): void {
  api.get(
    '/encyclopedia',
    wrap(async (_req, res) => {
      if (!(await encyclopediaEnabled(ctx))) {
        res.json({ enabled: false, built: false, report: null, publishing: 'not-configured' });
        return;
      }
      try {
        res.json(await readEncyclopediaStatus(ctx));
      } catch (err) {
        ctx.log(`encyclopedia status failed: ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ error: encyclopediaTexts(ctx).readFailed });
      }
    }),
  );

  api.post(
    '/encyclopedia/build',
    wrap(async (_req, res) => {
      try {
        const answer = await buildEncyclopedia(ctx);
        res.status(answer.status).json(answer.body);
      } catch (err) {
        ctx.log(`encyclopedia build failed: ${err instanceof Error ? err.message : String(err)}`);
        res.status(500).json({ error: encyclopediaTexts(ctx).buildFailed });
      }
    }),
  );
}

/** The router mounted at /enc. Every request is answered here (never falls through to the client). */
export function createSiteRouter(ctx: Ctx): Router {
  const router = express.Router();
  router.use(
    wrap(async (req, res) => {
      const texts = encyclopediaTexts(ctx);
      const notFound = (message: string): void => {
        res.status(404).json({ error: message });
      };
      if (!(await encyclopediaEnabled(ctx))) {
        notFound(texts.noSite);
        return;
      }
      const siteRoot = await resolveSiteRoot(ctx.campaignRoot);
      if (siteRoot === null) {
        notFound(texts.noSite);
        return;
      }
      const file = await resolveSiteFile(siteRoot, req.path);
      if (file === null) {
        notFound(texts.notFound);
        return;
      }
      res.setHeader('Content-Security-Policy', SITE_CSP);
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache');
      const serve = express.static(siteRoot, { dotfiles: 'deny', index: ['index.html'], fallthrough: true });
      serve(req, res, () => notFound(texts.notFound));
    }),
  );
  return router;
}
