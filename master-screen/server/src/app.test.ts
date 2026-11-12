import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { createApp } from './app.js';
import { createCtx } from './context.js';
import { request, startServer, type RunningServer } from './testing.js';

// The real framework in this repository: its plugin.json and yaml-lite module are read.
const REAL_FRAMEWORK = fileURLToPath(new URL('../../../yllir', import.meta.url));

const CAMPAIGN_YAML = `schema: 1
campaign:
  name: Test Campaign
  slug: test-campaign
language:
  main: it
modules:
  music: true
`;

describe('app and status route', () => {
  let tmp: string;
  let server: RunningServer;
  let shutdownRequested = false;
  let ctx: ReturnType<typeof createCtx> | undefined;

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ms-app-'));
    await fs.writeFile(path.join(tmp, 'campaign.yaml'), CAMPAIGN_YAML, 'utf8');
    server = await startServer((port) => {
      ctx = createCtx({
        campaignRoot: tmp,
        frameworkRoot: REAL_FRAMEWORK,
        port,
        log: () => {},
        requestShutdown: () => {
          shutdownRequested = true;
        },
      });
      return createApp(ctx);
    });
  });

  after(async () => {
    await server.close();
    await ctx?.closeAll();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('answers GET /api/status with the campaign summary, framework version and modules', async () => {
    const res = await request(server.port, { path: '/api/status', headers: { host: `127.0.0.1:${server.port}` } });
    assert.equal(res.status, 200);
    const body = res.json as {
      ok: boolean;
      campaign: { name: string; slug: string; language: string };
      frameworkVersion: string;
      modules: Record<string, boolean>;
      agent: { available: boolean; reason?: string };
      git: { ok: boolean };
    };
    assert.equal(body.ok, true);
    assert.deepEqual(body.campaign, { name: 'Test Campaign', slug: 'test-campaign', language: 'it' });
    assert.match(body.frameworkVersion, /^\d+\.\d+\.\d+$/);
    assert.equal(body.modules.music, true);
    assert.equal(body.modules.print, false);
    assert.deepEqual(body.agent, { available: false, reason: 'Not configured' });
    assert.equal(typeof body.git.ok, 'boolean');
  });

  it('rejects a foreign Host with 403 and a JSON error', async () => {
    const res = await request(server.port, { path: '/api/status', headers: { host: 'evil.com' } });
    assert.equal(res.status, 403);
    assert.equal(typeof (res.json as { error?: unknown }).error, 'string');
  });

  it('answers an unknown /api path with a JSON 404', async () => {
    const res = await request(server.port, { path: '/api/nothing-here', headers: { host: `127.0.0.1:${server.port}` } });
    assert.equal(res.status, 404);
    assert.equal(typeof (res.json as { error?: unknown }).error, 'string');
  });

  it('rejects a malformed JSON body with a plain error and no stack', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/shutdown',
      headers: { host: `127.0.0.1:${server.port}`, 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(res.status, 400);
    assert.doesNotMatch(res.text, /at |stack/i);
  });

  it('answers POST /api/shutdown and asks the process to shut down', async () => {
    const res = await request(server.port, {
      method: 'POST',
      path: '/api/shutdown',
      headers: { host: `127.0.0.1:${server.port}` },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(shutdownRequested, true);
  });
});
