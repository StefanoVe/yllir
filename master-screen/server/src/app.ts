// Express application: security, JSON body, /api routes, static client with SPA fallback,
// JSON errors. Owner: server skeleton.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Ctx } from './context.js';
import { registerBattleRoutes } from './routes/battle.js';
import { registerChangesRoutes } from './routes/changes.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerDocsRoutes } from './routes/docs.js';
import { registerEventsRoutes } from './routes/events.js';
import { registerLiveRoutes } from './routes/live.js';
import { registerMusicRoutes } from './routes/music.js';
import { registerPlotRoutes } from './routes/plot.js';
import { registerStatusRoutes } from './routes/status.js';
import { createSiteRouter, registerEncyclopediaRoutes } from './routes/encyclopedia.js';
import { registerPrintRoutes } from './routes/print.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerUpdateRoutes } from './routes/update.js';
import { encyclopediaEnabledAtStartup } from './encyclopedia/config.js';
import { securityMiddleware } from './security.js';
import { createCampaignCockpit } from './cockpit/wiring.js';
import { webHandlerMiddleware } from './cockpit/http-bridge.js';

// Next to server.mjs in the distribution. In development there is no public folder.
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

function errorHandler(ctx: Ctx): express.ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const kind = (err as { type?: unknown } | null)?.type;
    let status = 500;
    let message = 'Something went wrong. Try again.';
    if (kind === 'entity.too.large') {
      status = 413;
      message = 'The message is too long.';
    } else if (typeof kind === 'string' && /^(entity|encoding|charset)\./.test(kind)) {
      status = 400;
      message = 'The request could not be read.';
    }
    ctx.log(
      `request failed (${req.method} ${req.path}): ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    res.status(status).json({ error: message });
  };
}

export function createApp(ctx: Ctx): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    securityMiddleware(ctx.port, {
      encyclopedia: encyclopediaEnabledAtStartup(ctx.campaignRoot),
    }),
  );
  // The cockpit (live table) answers /api/cockpit and /mcp/cockpit. It is mounted before
  // express.json so its Web handlers read the raw request body, and after the security
  // middleware, so the Host, Origin and security headers apply to it too.
  const { cockpit, battle } = createCampaignCockpit(ctx);
  ctx.onClose(() => cockpit.close());
  ctx.cancelCockpitTurns = () => cockpit.cancelAllTurns();
  app.use(['/api/cockpit', '/mcp/cockpit'], webHandlerMiddleware((req) => cockpit.handle(req)));
  app.use(express.json({ limit: '64kb' }));

  const api = express.Router();
  registerStatusRoutes(api, ctx);
  registerEventsRoutes(api, ctx);
  registerDocsRoutes(api, ctx);
  registerChangesRoutes(api, ctx);
  registerChatRoutes(api, ctx);
  registerLiveRoutes(api, ctx);
  registerBattleRoutes(api, battle);
  registerPlotRoutes(api, ctx);
  registerMusicRoutes(api, ctx);
  registerEncyclopediaRoutes(api, ctx);
  registerPrintRoutes(api, ctx);
  registerSettingsRoutes(api, ctx);
  registerUpdateRoutes(api, ctx);
  app.use('/api', api);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'There is no such action.' });
  });
  // The built encyclopedia site, same origin, read-only. Answers every /enc request itself.
  app.use('/enc', createSiteRouter(ctx));

  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use(express.static(PUBLIC_DIR, { index: false }));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res, next) => {
      res.sendFile(indexFile, (err) => {
        if (err) next(err);
      });
    });
  }

  app.use(errorHandler(ctx));
  return app;
}
