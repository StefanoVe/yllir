import assert from 'node:assert/strict';
import express from 'express';
import { afterEach, describe, it } from 'node:test';
import { createFakeProvider } from '../agent/fake-provider.js';
import type { AgentProvider } from '../agent/provider.js';
import { makeCampaign, waitFor, type TestCampaign } from '../chat/test-support.js';
import { startServer, request, type RunningServer } from '../testing.js';
import { registerChatRoutes } from './chat.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function serve(campaign: TestCampaign, provider: AgentProvider | null): Promise<RunningServer> {
  const server = await startServer((port) => {
    campaign.ctx.port = port;
    const app = express();
    app.use(express.json({ limit: '64kb' }));
    const api = express.Router();
    registerChatRoutes(api, campaign.ctx, { provider });
    app.use('/api', api);
    // Same as the real app for a malformed body: a plain 400, no stack in the output.
    app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if ((err as { type?: string }).type === 'entity.parse.failed') res.status(400).json({ error: 'The request could not be read.' });
      else next(err);
    });
    return app;
  });
  cleanups.push(async () => {
    await campaign.ctx.closeAll();
    await server.close();
    campaign.cleanup();
  });
  return server;
}

function post(port: number, path: string, body: unknown) {
  return request(port, {
    method: 'POST',
    path,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('chat routes without an agent', () => {
  it('answers 503 with the plain reason when no agent is available', async () => {
    const reason = 'Claude Code non è installato su questo computer';
    const campaign = makeCampaign({ agent: { available: false, reason } });
    const server = await serve(campaign, null);
    const res = await post(server.port, '/api/chat/messages', { text: 'ciao' });
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, { error: reason });
    assert.equal(campaign.of('message').length, 0);
  });

  it('still answers GET /chat with the empty state', async () => {
    const campaign = makeCampaign({ agent: { available: false, reason: 'no' } });
    const server = await serve(campaign, null);
    const res = await request(server.port, { path: '/api/chat' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { messages: [], turn: null });
  });
});

describe('chat routes with an agent', () => {
  it('accepts a message with 202, trims it, and answers when the turn is done', async () => {
    const campaign = makeCampaign();
    const server = await serve(campaign, createFakeProvider([{ type: 'delta', text: 'Ecco.' }, { type: 'done' }]));
    const res = await post(server.port, '/api/chat/messages', { text: '  Crea Mara  ' });
    assert.equal(res.status, 202);
    const { messageId, turnId } = res.json as { messageId: string; turnId: string };
    assert.ok(messageId && turnId);

    await waitFor(() => campaign.of('turn').some((e) => e.data.id === turnId && e.data.state === 'done'), 'done');
    const chat = await request(server.port, { path: '/api/chat' });
    const body = chat.json as { messages: Array<{ role: string; text: string }>; turn: unknown };
    assert.deepEqual(
      body.messages.map((m) => [m.role, m.text]),
      [
        ['master', 'Crea Mara'],
        ['agent', 'Ecco.'],
      ],
    );
    assert.equal(body.turn, null);
  });

  it('rejects an empty, too long or malformed message with 400', async () => {
    const campaign = makeCampaign();
    const server = await serve(campaign, createFakeProvider([{ type: 'done' }]));
    assert.equal((await post(server.port, '/api/chat/messages', { text: '   ' })).status, 400);
    assert.equal((await post(server.port, '/api/chat/messages', { text: 'x'.repeat(8001) })).status, 400);
    assert.equal((await post(server.port, '/api/chat/messages', { text: 3 })).status, 400);
    assert.equal((await post(server.port, '/api/chat/messages', '{not json')).status, 400);
    assert.equal((await post(server.port, '/api/chat/messages', { text: 'x'.repeat(8000) })).status, 202);
  });

  it('cancels a running turn with ok, and answers 404 for an unknown turn', async () => {
    const campaign = makeCampaign();
    const provider = createFakeProvider([], { hang: true });
    const server = await serve(campaign, provider);
    const { turnId } = (await post(server.port, '/api/chat/messages', { text: 'lunga' })).json as { turnId: string };
    await waitFor(() => provider.calls.length === 1, 'running');

    const cancelled = await post(server.port, `/api/chat/turns/${turnId}/cancel`, {});
    assert.equal(cancelled.status, 200);
    assert.deepEqual(cancelled.json, { ok: true });
    await waitFor(() => campaign.of('turn').some((e) => e.data.id === turnId && e.data.state === 'cancelled'), 'cancelled');

    const unknown = await post(server.port, '/api/chat/turns/00000000-0000-4000-8000-000000000000/cancel', {});
    assert.equal(unknown.status, 404);
    assert.equal(typeof (unknown.json as { error: unknown }).error, 'string');
  });

  it('reports the running turn in GET /chat', async () => {
    const campaign = makeCampaign();
    const provider = createFakeProvider([{ type: 'activity', text: 'Sto leggendo un documento…' }], { hang: true });
    const server = await serve(campaign, provider);
    const { turnId } = (await post(server.port, '/api/chat/messages', { text: 'ciao' })).json as { turnId: string };
    await waitFor(() => provider.calls.length === 1, 'running');
    const chat = await request(server.port, { path: '/api/chat' });
    const turn = (chat.json as { turn: { id: string; state: string; activity: string } }).turn;
    assert.equal(turn.id, turnId);
    assert.equal(turn.state, 'running');
    await post(server.port, `/api/chat/turns/${turnId}/cancel`, {});
  });
});
