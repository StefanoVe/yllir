import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express from 'express';
import { buildCsp, isAllowedHost, isAllowedOrigin, isStateChanging, securityMiddleware } from './security.js';
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

describe('Content-Security-Policy matrix', () => {
  const off = buildCsp({ music: false });
  const on = buildCsp({ music: true });
  const directives = (csp: string): string[] => csp.split('; ');

  it('music off: no third-party host at all', () => {
    assert.doesNotMatch(off, /youtube|ytimg|https?:/);
    assert.equal(off, "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  });

  it('music on: exactly the three allowances and nothing else changes', () => {
    const offDirectives = directives(off);
    const onDirectives = directives(on);
    assert.equal(onDirectives.length, offDirectives.length + 1);
    const changed = onDirectives.filter((d) => !offDirectives.includes(d));
    assert.deepEqual(changed, [
      "script-src 'self' https://www.youtube.com",
      "img-src 'self' data: https://i.ytimg.com",
      'frame-src https://www.youtube-nocookie.com',
    ]);
    assert.deepEqual(
      offDirectives.filter((d) => !onDirectives.includes(d)),
      ["script-src 'self'", "img-src 'self' data:"],
    );
  });

  it('music on: no wildcard and no new unsafe value', () => {
    assert.doesNotMatch(on, /\*/);
    assert.equal(on.match(/unsafe-/g)?.length, off.match(/unsafe-/g)?.length);
    assert.equal(on.match(/unsafe-eval|unsafe-hashes/g), null);
    assert.doesNotMatch(on, /https?:\/\/(?!www\.youtube\.com|i\.ytimg\.com|www\.youtube-nocookie\.com)/);
  });

  it('the middleware sends the CSP of its music flag', async () => {
    const server = await startServer((port) => {
      const app = express();
      app.use(securityMiddleware(port, { music: true }));
      app.get('/x', (_req, res) => {
        res.json({ ok: true });
      });
      return app;
    });
    try {
      const res = await request(server.port, { path: '/x', headers: { host: `127.0.0.1:${server.port}` } });
      assert.equal(res.headers['content-security-policy'], on);
    } finally {
      await server.close();
    }
  });
});

describe('Content-Security-Policy with the encyclopedia module', () => {
  const base = buildCsp({ music: false });
  const enc = buildCsp({ music: false, encyclopedia: true });
  const both = buildCsp({ music: true, encyclopedia: true });
  const musicOnly = buildCsp({ music: true });

  it('encyclopedia off is the unchanged main policy', () => {
    assert.equal(buildCsp({ music: false, encyclopedia: false }), base);
    assert.doesNotMatch(base, /frame-src/);
  });

  it('encyclopedia on adds exactly one frame-src self and nothing else', () => {
    assert.equal(enc, `${base}; frame-src 'self'`);
  });

  it('music and encyclopedia share one frame-src directive', () => {
    assert.equal(both, `${musicOnly}`.replace('frame-src https://www.youtube-nocookie.com', "frame-src 'self' https://www.youtube-nocookie.com"));
    assert.equal(both.match(/frame-src/g)?.length, 1);
    assert.doesNotMatch(both, /\*/);
  });

  it('the middleware sends the policy of both flags', async () => {
    const server = await startServer((port) => {
      const app = express();
      app.use(securityMiddleware(port, { music: false, encyclopedia: true }));
      app.get('/x', (_req, res) => {
        res.json({ ok: true });
      });
      return app;
    });
    try {
      const res = await request(server.port, { path: '/x', headers: { host: `127.0.0.1:${server.port}` } });
      assert.equal(res.headers['content-security-policy'], enc);
    } finally {
      await server.close();
    }
  });
});

describe('securityMiddleware music option as a function', () => {
  it('allows the YouTube origins when the function returns true and not when it returns false', async () => {
    let on = false;
    const server = await startServer((port) => {
      const app = express();
      app.use(securityMiddleware(port, { music: () => on }));
      app.get('/x', (_req, res) => {
        res.json({ ok: true });
      });
      return app;
    });
    try {
      const headers = { host: `127.0.0.1:${server.port}` };
      const off = await request(server.port, { path: '/x', headers });
      assert.doesNotMatch(String(off.headers['content-security-policy']), /youtube/);
      on = true;
      const onRes = await request(server.port, { path: '/x', headers });
      const csp = String(onRes.headers['content-security-policy']);
      assert.match(csp, /script-src 'self' https:\/\/www\.youtube\.com;/);
      assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com/);
    } finally {
      await server.close();
    }
  });
});
