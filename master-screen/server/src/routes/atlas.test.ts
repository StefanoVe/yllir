import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createChatService, type ChatService } from '../chat/index.js';
import { createCtx, type Ctx } from '../context.js';
import { createFakeProvider } from '../agent/fake-provider.js';
import { makeCampaign } from '../live/test-support.js';
import { ATLAS_TEXTS, ATLAS_PROMPTS } from '../atlas/texts.js';
import { ATLAS_SITE_CSP, atlasSiteDir } from '../atlas/site.js';
import { atlasStatus, makeFakeAtlasCli, NO_ATLAS, type FakeAtlasCli } from '../atlas/test-support.js';
import { request, startServer, type RunningServer, type TestResponse } from '../testing.js';
import { createAtlasSiteRouter, registerAtlasRoutes } from './atlas.js';
import type { AgentEvent } from '../agent/provider.js';

const EN = ATLAS_TEXTS.en;

interface Opened {
  root: string;
  fake: FakeAtlasCli;
  ctx: Ctx;
  chat: ChatService;
  agent: { available: boolean; reason?: string };
  call(method: string, urlPath: string, body?: unknown): Promise<TestResponse>;
  close(): Promise<void>;
}

async function open(script: AgentEvent[] = [{ type: 'done' }], opts: { hang?: boolean; delayMs?: number } = {}): Promise<Opened> {
  const root = makeCampaign({}, 'en');
  const fake = await makeFakeAtlasCli();
  const agent = { available: true } as { available: boolean; reason?: string };
  let ctx!: Ctx;
  const app = express();
  app.use(express.json());
  const server: RunningServer = await startServer(() => {
    ctx = createCtx({ campaignRoot: root, frameworkRoot: fake.frameworkRoot, port: 0, log: () => {}, agentStatus: () => agent });
    return app;
  });
  const provider = createFakeProvider(script, { hang: opts.hang, delayMs: opts.delayMs });
  const chat = createChatService(ctx, provider, { idleTimeoutMs: 5000, hardLimitMs: 5000, headSha: async () => '' });
  ctx.chat = chat;
  const api = express.Router();
  registerAtlasRoutes(api, ctx);
  app.use('/api', api);
  app.use('/atlas', createAtlasSiteRouter(ctx));
  return {
    root,
    fake,
    ctx,
    chat,
    agent,
    call(method, urlPath, body) {
      return request(server.port, {
        method,
        path: urlPath,
        headers: body !== undefined ? { 'content-type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    },
    async close() {
      await chat.runner.close();
      await server.close();
      await ctx.closeAll();
      await fake.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

async function waitFor(f: Opened, pred: (state: string) => boolean): Promise<void> {
  const started = Date.now();
  for (;;) {
    const res = await f.call('GET', '/api/atlas');
    if (pred((res.json as { generation: { state: string } }).generation.state)) return;
    if (Date.now() - started > 8000) throw new Error('timed out waiting for the generation state');
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe('GET /api/atlas', () => {
  let f: Opened;
  beforeEach(async () => {
    f = await open();
  });
  afterEach(async () => {
    await f.close();
  });

  it('answers the status with no atlas', async () => {
    await f.fake.respond('status', NO_ATLAS);
    const res = await f.call('GET', '/api/atlas');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, {
      exists: false,
      built: false,
      pending: 0,
      generation: { state: 'idle', conversationId: null, mode: null },
      agent: { available: true },
    });
  });

  it('answers 500 with a plain sentence when the framework answer cannot be read', async () => {
    await f.fake.respond('status', { code: 0, raw: 'garbage /Users/x/secret' });
    const res = await f.call('GET', '/api/atlas');
    assert.equal(res.status, 500);
    assert.equal((res.json as { error: string }).error, EN.readFailed);
    assert.doesNotMatch(res.text, /secret|Users/);
  });
});

describe('POST /api/atlas/generate', () => {
  it('answers 400 for a mode that is not create or update', async () => {
    const f = await open();
    try {
      const res = await f.call('POST', '/api/atlas/generate', { mode: 'delete' });
      assert.equal(res.status, 400);
      assert.equal((res.json as { error: string }).error, EN.invalidMode);
      assert.equal((await f.fake.calls()).length, 0);
    } finally {
      await f.close();
    }
  });

  it('answers 409 when create is asked while the atlas exists', async () => {
    const f = await open();
    try {
      await f.fake.respond('status', atlasStatus(0));
      const res = await f.call('POST', '/api/atlas/generate', { mode: 'create' });
      assert.equal(res.status, 409);
      assert.equal((res.json as { error: string }).error, EN.alreadyExists);
    } finally {
      await f.close();
    }
  });

  it('answers 409 when update is asked while there is no atlas', async () => {
    const f = await open();
    try {
      await f.fake.respond('status', NO_ATLAS);
      const res = await f.call('POST', '/api/atlas/generate', { mode: 'update' });
      assert.equal(res.status, 409);
      assert.equal((res.json as { error: string }).error, EN.noAtlas);
    } finally {
      await f.close();
    }
  });

  it('answers 503 with the reason when the assistant is not available', async () => {
    const f = await open();
    try {
      await f.fake.respond('status', NO_ATLAS);
      f.agent.available = false;
      f.agent.reason = 'No Claude Code found';
      const res = await f.call('POST', '/api/atlas/generate', { mode: 'create' });
      assert.equal(res.status, 503);
      assert.deepEqual(res.json, { error: 'No Claude Code found' });
    } finally {
      await f.close();
    }
  });

  it('answers 202 with the status and runs the fixed prompt in a new conversation', async () => {
    const f = await open([{ type: 'delta', text: 'Atlas made.' }, { type: 'done' }], { delayMs: 60 });
    try {
      await f.fake.respond('status', NO_ATLAS);
      const res = await f.call('POST', '/api/atlas/generate', { mode: 'create' });
      assert.equal(res.status, 202);
      const body = res.json as { ok: boolean; status: { generation: { state: string; mode: string; conversationId: string } } };
      assert.equal(body.ok, true);
      assert.equal(body.status.generation.state, 'running');
      assert.equal(body.status.generation.mode, 'create');
      assert.ok(f.chat.store.has(body.status.generation.conversationId));
      assert.equal(ATLAS_PROMPTS.create.split('\n')[0], 'Campaign atlas.', 'the conversation takes its title from the first line');
      await waitFor(f, (state) => state !== 'running');
    } finally {
      await f.close();
    }
  });
});

describe('POST /api/atlas/render', () => {
  it('answers 409 while a generation runs, and renders nothing', async () => {
    const f = await open([{ type: 'delta', text: '...' }], { hang: true });
    try {
      await f.fake.respond('status', NO_ATLAS);
      const started = await f.call('POST', '/api/atlas/generate', { mode: 'create' });
      assert.equal(started.status, 202);
      const res = await f.call('POST', '/api/atlas/render');
      assert.equal(res.status, 409);
      assert.deepEqual(res.json, { ok: false, error: EN.redrawBusy });
      assert.equal((await f.fake.calls()).some((c) => c.args[0] === 'render'), false);
    } finally {
      await f.close();
    }
  });

  it('answers 409 without an atlas', async () => {
    const f = await open();
    try {
      await f.fake.respond('status', NO_ATLAS);
      const res = await f.call('POST', '/api/atlas/render');
      assert.equal(res.status, 409);
      assert.deepEqual(res.json, { ok: false, error: EN.noAtlas });
    } finally {
      await f.close();
    }
  });

  it('answers ok after a redraw, and a plain failure when the redraw fails', async () => {
    const f = await open();
    try {
      await f.fake.respond('status', atlasStatus(0));
      await f.fake.respond('render', { code: 0, json: { ok: true } });
      assert.deepEqual((await f.call('POST', '/api/atlas/render')).json, { ok: true });
      await f.fake.respond('render', { code: 1, json: { ok: false } });
      assert.deepEqual((await f.call('POST', '/api/atlas/render')).json, { ok: false, error: EN.redrawFailed });
    } finally {
      await f.close();
    }
  });
});

describe('GET /api/atlas/preview.png', () => {
  it('answers 404 without a preview, and the image with no-store when there is one', async () => {
    const f = await open();
    try {
      assert.equal((await f.call('GET', '/api/atlas/preview.png')).status, 404);
      const file = path.join(f.root, '.campaign', 'cache', 'atlas', 'preview.png');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const res = await f.call('GET', '/api/atlas/preview.png');
      assert.equal(res.status, 200);
      assert.match(String(res.headers['content-type']), /image\/png/);
      assert.equal(res.headers['cache-control'], 'no-store');
    } finally {
      await f.close();
    }
  });
});

describe('the built atlas site at /atlas', () => {
  let f: Opened;
  let site: string;
  beforeEach(async () => {
    f = await open();
    site = atlasSiteDir(f.root);
  });
  afterEach(async () => {
    await f.close();
  });

  it('answers 404 with no build, and never the main application', async () => {
    const res = await f.call('GET', '/atlas/index.html');
    assert.equal(res.status, 404);
    assert.equal((res.json as { error: string }).error, EN.noSite);
  });

  it('serves the built site with its own CSP and the framing and sniffing headers', async () => {
    fs.mkdirSync(path.join(site, 'p'), { recursive: true });
    fs.writeFileSync(path.join(site, 'index.html'), '<h1>atlas home</h1>');
    fs.writeFileSync(path.join(site, 'p', 'index.html'), '<h1>a place</h1>');
    const res = await f.call('GET', '/atlas/index.html');
    assert.equal(res.status, 200);
    assert.match(res.text, /atlas home/);
    assert.equal(res.headers['content-security-policy'], ATLAS_SITE_CSP);
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(
      ATLAS_SITE_CSP,
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    );
    const folder = await f.call('GET', '/atlas/p/');
    assert.equal(folder.status, 200);
    assert.match(folder.text, /a place/);
  });

  it('refuses dotfiles, traversal and a symlink that leaves the site', async () => {
    fs.mkdirSync(site, { recursive: true });
    fs.writeFileSync(path.join(site, 'index.html'), '<h1>atlas home</h1>');
    fs.writeFileSync(path.join(site, '.env'), 'TOKEN=1');
    const outside = path.join(f.root, 'secret.txt');
    fs.writeFileSync(outside, 'campaign secret');
    fs.symlinkSync(outside, path.join(site, 'leak.txt'));

    assert.equal((await f.call('GET', '/atlas/.env')).status, 404);
    assert.equal((await f.call('GET', '/atlas/leak.txt')).status, 404);
    const traversal = await f.call('GET', '/atlas/..%2F..%2Fcampaign.yaml');
    assert.equal(traversal.status, 404);
    assert.doesNotMatch(traversal.text, /campaign/);
    const encoded = await f.call('GET', '/atlas/%2e%2e/secret.txt');
    assert.equal(encoded.status, 404);
    assert.doesNotMatch(encoded.text, /secret/);
  });
});
