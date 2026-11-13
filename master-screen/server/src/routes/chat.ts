// GET /api/chats, POST /api/chats, DELETE /api/chats/:id, GET /api/chat, POST /api/chat/messages,
// POST /api/chat/turns/:id/cancel. Owner: chat engineer.
import type { Router } from 'express';
import { z } from 'zod';
import type { AgentProvider } from '../agent/provider.js';
import { createProvider } from '../agent/index.js';
import { createChatService } from '../chat/index.js';
import { campaignLanguage, TEXTS } from '../chat/text.js';
import type { Ctx } from '../context.js';
import type { ChatChoice } from '../../../shared/src/types.js';

export interface ChatRouteOptions {
  /** Provider to use. Omitted: the one createProvider finds. Null: no agent. */
  provider?: AgentProvider | null;
}

const messageBody = z.object({
  text: z.string().trim().min(1).max(8000),
  model: z.enum(['sonnet', 'opus', 'haiku']).optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  conversationId: z.string().optional(),
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
  const { store, runner } = service;

  app.get('/chats', (_req, res) => {
    res.json({ conversations: store.conversations(), currentId: store.currentId(), turn: runner.current() });
  });

  app.post('/chats', async (_req, res, next) => {
    try {
      const conversation = await store.createConversation();
      ctx.bus.publish('conversations', {});
      res.status(201).json(conversation);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/chats/:id', async (req, res, next) => {
    const id = req.params.id;
    if (!store.has(id)) {
      res.status(404).json({ error: t.noSuchConversation });
      return;
    }
    try {
      runner.cancelConversation(id);
      // No write of this conversation may land after the delete: wait for its running turn to end.
      await runner.settleConversation(id);
      await store.deleteConversation(id);
      ctx.bus.publish('conversations', {});
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/chat', (req, res) => {
    const raw = req.query.conversationId;
    const id = raw === undefined ? store.currentId() : String(raw);
    if (!store.has(id)) {
      res.status(404).json({ error: t.noSuchConversation });
      return;
    }
    res.json({ conversationId: id, messages: store.messages(id), turn: runner.currentFor(id) });
  });

  app.post('/chat/messages', async (req, res, next) => {
    const status = ctx.agentStatus();
    if (!status.available || provider === null) {
      res.status(503).json({ error: status.reason ?? t.unavailable });
      return;
    }
    const parsed = messageBody.safeParse(req.body);
    if (!parsed.success) {
      const onText = parsed.error.issues.some((issue) => issue.path[0] === 'text');
      res.status(400).json({ error: onText ? t.invalidText : t.invalidChoice });
      return;
    }
    const conversationId = parsed.data.conversationId ?? store.currentId();
    if (!store.has(conversationId)) {
      res.status(404).json({ error: t.noSuchConversation });
      return;
    }
    const choice: ChatChoice = { model: parsed.data.model, effort: parsed.data.effort };
    try {
      const submitted = await runner.submit(conversationId, parsed.data.text, choice);
      if (submitted === null) {
        res.status(503).json({ error: t.closing });
        return;
      }
      // The title and the order of the conversations changed with the message.
      ctx.bus.publish('conversations', {});
      res.status(202).json(submitted);
    } catch (err) {
      next(err);
    }
  });

  app.post('/chat/turns/:id/cancel', (req, res) => {
    if (!runner.cancel(req.params.id)) {
      res.status(404).json({ error: t.noSuchTurn });
      return;
    }
    res.json({ ok: true });
  });
}
