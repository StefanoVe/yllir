import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express from 'express';
import { isAllowedHost, isAllowedOrigin, isStateChanging, securityMiddleware } from './security.js';
import { request, startServer, type RunningServer } from './testing.js';

describe('security helpers', () => {
  it('accepts only the loopback names with the exact port', () => {
    assert.equal(isAllowedHost('127.0.0.1:4317', 4317), true);
    assert.equal(isAllowedHost('localhost:4317', 4317), true);
    assert.equal(isAllowedHost('LOCALHOST:4317', 4317), true);
    assert.equal(isAllowedHost('127.0.0.1:4318', 4317), false);
    assert.equal(isAllowedHost('evil.com', 4317), false);
    assert.equal(isAllowedHost('127.0.0.1', 4317), false);
    assert.equal(isAllowedHost(undefined, 4317), false);
  });

  it('allows a missing Origin and only the loopback origins when present', () => {
    assert.equal(isAllowedOrigin(undefined, 4317), true);
    assert.equal(isAllowedOrigin('http://127.0.0.1:4317', 4317), true);
    assert.equal(isAllowedOrigin('http://localhost:4317', 4317), true);
    assert.equal(isAllowedOrigin('https://evil.example', 4317), false);
    assert.equal(isAllowedOrigin('null', 4317), false);
  });

  it('treats everything except GET, HEAD and OPTIONS as state-changing', () => {
    assert.equal(isStateChanging('GET'), false);
    assert.equal(isStateChanging('head'), false);
    assert.equal(isStateChanging('POST'), true);
    assert.equal(isStateChanging('DELETE'), true);
  });
});

describe('security middleware over HTTP', () => {
  let server: RunningServer;

  async function start(): Promise<RunningServer> {
    return startServer((port) => {
      const app = express();
      app.use(securityMiddleware(port));
      app.get('/x', (_req, res) => {
        res.json({ ok: true });
      });
      app.post('/x', (_req, res) => {
        res.json({ ok: true });
      });
      return app;
    });
  }

  it('serves a request with a loopback Host and sends the security headers', async () => {
    server = await start();
    try {
      const res = await request(server.port, { path: "/x", headers: { host: `127.0.0.1:${server.port}` } });
      assert.equal(res.status, 200);
      const csp = String(res.headers['content-security-policy']);
      assert.match(csp, /default-src 'self'/);
      assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
      assert.equal(res.headers['x-frame-options'], 'DENY');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    } finally {
      await server.close();
    }
  });

  it('accepts localhost and rejects a foreign Host or a wrong port', async () => {
    server = await start();
    try {
      const local = await request(server.port, { path: "/x", headers: { host: `localhost:${server.port}` } });
      assert.equal(local.status, 200);
      const foreign = await request(server.port, { path: "/x", headers: { host: 'evil.com' } });
      assert.equal(foreign.status, 403);
      assert.equal(typeof (foreign.json as { error?: unknown }).error, 'string');
      const wrongPort = await request(server.port, { path: "/x", headers: { host: '127.0.0.1:1' } });
      assert.equal(wrongPort.status, 403);
    } finally {
      await server.close();
    }
  });

  it('rejects a state-changing request from a foreign Origin, accepts a same-origin or missing one', async () => {
    server = await start();
    const host = `127.0.0.1:${server.port}`;
    try {
      const foreign = await request(server.port, {
        method: 'POST',
        path: '/x',
        headers: { host, origin: 'https://evil.example' },
      });
      assert.equal(foreign.status, 403);
      const same = await request(server.port, {
        method: 'POST',
        path: '/x',
        headers: { host, origin: `http://127.0.0.1:${server.port}` },
      });
      assert.equal(same.status, 200);
      const none = await request(server.port, { method: 'POST', path: '/x', headers: { host } });
      assert.equal(none.status, 200);
    } finally {
      await server.close();
    }
  });

  it('does not check Origin on GET requests', async () => {
    server = await start();
    try {
      const res = await request(server.port, {
        path: '/x',
        headers: { host: `127.0.0.1:${server.port}`, origin: 'https://evil.example' },
      });
      assert.equal(res.status, 200);
    } finally {
      await server.close();
    }
  });
});
