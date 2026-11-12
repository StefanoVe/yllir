import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { createCtx, type Ctx } from '../context.js';
import { startServer, type RunningServer } from '../testing.js';
import { registerEventsRoutes } from './events.js';

interface Stream {
  text(): string;
  close(): void;
}

function waitUntil(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (cond()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function openStream(port: number, headers: Record<string, string> = {}): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers }, (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
      });
      res.on('error', () => {});
      resolve({
        text: () => buffer,
        close: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

function idsIn(text: string): number[] {
  return [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
}

describe('GET /api/events', () => {
  let ctx: Ctx;
  let server: RunningServer;

  before(async () => {
    server = await startServer((port) => {
      ctx = createCtx({
        campaignRoot: os.tmpdir(),
        frameworkRoot: os.tmpdir(),
        port,
        log: () => {},
      });
      const app = express();
      const router = express.Router();
      registerEventsRoutes(router, ctx);
      app.use('/api', router);
      return app;
    });
  });

  after(async () => {
    ctx.bus.close();
    await server.close();
  });

  it('sends the SSE headers, the retry line and a hello frame to the client only', async () => {
    const stream = await openStream(server.port);
    await waitUntil(() => stream.text().includes('event: hello'));
    assert.match(stream.text(), /^retry: 3000$/m);
    assert.match(stream.text(), /event: hello\ndata: \{"serverTime":"[^"]+"\}\n\n/);
    // hello is not in the ring buffer: the first published event gets id 1
    assert.equal(ctx.bus.publish('changes', {}), 1);
    await waitUntil(() => stream.text().includes('event: changes'));
    stream.close();
    await waitUntil(() => ctx.bus.clientCount() === 0);
  });

  it('replays missed events from the Last-Event-ID header', async () => {
    const first = ctx.bus.publish('changes', {});
    const second = ctx.bus.publish('changes', {});
    const third = ctx.bus.publish('changes', {});
    const stream = await openStream(server.port, { 'Last-Event-ID': String(first) });
    try {
      await waitUntil(() => stream.text().includes('event: hello'));
      await waitUntil(() => idsIn(stream.text()).length >= 2);
      assert.deepEqual(idsIn(stream.text()), [second, third]);
    } finally {
      stream.close();
      await waitUntil(() => ctx.bus.clientCount() === 0);
    }
  });

  it('accepts ?lastEventId= as a fallback', async () => {
    const earlier = ctx.bus.publish('changes', {});
    const latest = ctx.bus.publish('changes', {});
    const stream = await new Promise<Stream>((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port: server.port, path: `/api/events?lastEventId=${earlier}` },
        (res) => {
          let buffer = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buffer += chunk;
          });
          res.on('error', () => {});
          resolve({ text: () => buffer, close: () => req.destroy() });
        },
      );
      req.on('error', reject);
    });
    try {
      await waitUntil(() => idsIn(stream.text()).length >= 1);
      assert.deepEqual(idsIn(stream.text()), [latest]);
    } finally {
      stream.close();
      await waitUntil(() => ctx.bus.clientCount() === 0);
    }
  });
});
