// GET /api/events (SSE). Owner: core engineer. Replays missed events from Last-Event-ID
// (header, or ?lastEventId= as fallback) and sends a `hello` frame to this client only.
import type { Router } from 'express';
import type { Ctx } from '../context.js';

export function registerEventsRoutes(app: Router, ctx: Ctx): void {
  app.get('/events', (req, res) => {
    const header = req.headers['last-event-id'];
    const query = req.query.lastEventId;
    const lastEventId =
      typeof header === 'string' ? header : typeof query === 'string' ? query : undefined;
    ctx.bus.subscribe(res, lastEventId);
    res.write(`event: hello\ndata: ${JSON.stringify({ serverTime: new Date().toISOString() })}\n\n`);
  });
}
