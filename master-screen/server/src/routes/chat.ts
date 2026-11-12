// GET /api/chat, POST /api/chat/messages, POST /api/chat/turns/:id/cancel.
// Owner: chat engineer.
import type { Router } from 'express';
import { z } from 'zod';
import type { AgentProvider } from '../agent/provider.js';
import { createProvider } from '../agent/index.js';
import { createChatService } from '../chat/index.js';
import { campaignLanguage, TEXTS } from '../chat/text.js';
import type { Ctx } from '../context.js';

export interface ChatRouteOptions {
  /** Provider to use. Omitted: the one createProvider finds. Null: no agent. */
  provider?: AgentProvider | null;
}

const messageBody = z.object({
  text: z.string().trim().min(1).max(8000),
});

/** Stands in for a missing provider: the routes answer 503 before it is ever asked to run. */
function unavailableProvider(message: string): AgentProvider {
  return {
    async *run() {
      yield { type: 'error', message };
    },
  };
}

export function registerChatRoutes(app: Router, ctx: Ctx, options: ChatRouteOptions = {}): void {
  const lang = campaignLanguage(ctx.campaignRoot);
  const t = TEXTS[lang];
  const provider = 'provider' in options ? options.provider ?? null : createProvider(ctx);
  const service = createChatService(ctx, provider ?? unavailableProvider(t.unavailable));

  app.get('/chat', (_req, res) => {
    res.json({ messages: service.store.messages(), turn: service.runner.current() });
  });

  app.post('/chat/messages', async (req, res, next) => {
    const status = ctx.agentStatus();
    if (!status.available || provider === null) {
      res.status(503).json({ error: status.reason ?? t.unavailable });
      return;
    }
    const parsed = messageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: t.invalidText });
      return;
    }
    try {
      const submitted = await service.runner.submit(parsed.data.text);
      if (submitted === null) {
        res.status(503).json({ error: t.closing });
        return;
      }
      res.status(202).json(submitted);
    } catch (err) {
      next(err);
    }
  });

  app.post('/chat/turns/:id/cancel', (req, res) => {
    if (!service.runner.cancel(req.params.id)) {
      res.status(404).json({ error: t.noSuchTurn });
      return;
    }
    res.json({ ok: true });
  });
}
