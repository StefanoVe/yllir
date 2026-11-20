import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { createCtx, type Ctx } from '../context.js';
import { JOB_BUSY_TEXT } from '../jobs.js';
import { makeCampaign } from '../live/test-support.js';
import { ATLAS_STATUS_CACHE_MS, createAtlasService, isApproved, readFrameworkAtlas, type AtlasService } from './service.js';
import { atlasSiteDir } from './site.js';
import { ATLAS_TEXTS } from './texts.js';
import { atlasStatus, makeFakeAtlasCli, NO_ATLAS, type FakeAtlasCli } from './test-support.js';

const EN = ATLAS_TEXTS.en;
const cleanups: Array<() => Promise<void> | void> = [];
after(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

interface Setup {
  ctx: Ctx;
  fake: FakeAtlasCli;
  service: AtlasService;
  root: string;
  clock: { now: number };
}

async function setup(): Promise<Setup> {
  const root = makeCampaign({}, 'en');
  const fake = await makeFakeAtlasCli();
  const ctx = createCtx({ campaignRoot: root, frameworkRoot: fake.frameworkRoot, port: 0, log: () => {} });
  const clock = { now: 1_000_000 };
  const service = createAtlasService(ctx, { now: () => clock.now });
  cleanups.push(async () => {
    await ctx.closeAll();
    await fake.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { ctx, fake, service, root, clock };
}

function writeSite(root: string): void {
  fs.mkdirSync(atlasSiteDir(root), { recursive: true });
  fs.writeFileSync(path.join(atlasSiteDir(root), 'index.html'), '<h1>atlas</h1>');
}

describe('atlas status', () => {
  it('is empty without an atlas folder: exists false, nothing pending, not built', async () => {
    const s = await setup();
    await s.fake.respond('status', NO_ATLAS);
    const status = await s.service.status();
    assert.equal(status.exists, false);
    assert.equal(status.pending, 0);
    assert.equal(status.built, false);
    assert.deepEqual(status.generation, { state: 'idle', conversationId: null, mode: null });
    assert.equal(status.agent.available, false);
  });

  it('reports the atlas and its pending places, and built only when the master site is on disk', async () => {
    const s = await setup();
    await s.fake.respond('status', atlasStatus(3));
    const before = await s.service.status();
    assert.equal(before.exists, true);
    assert.equal(before.pending, 3);
    assert.equal(before.built, false);

    writeSite(s.root);
    s.clock.now += ATLAS_STATUS_CACHE_MS + 1;
    const after = await s.service.status();
    assert.equal(after.built, true);
  });

  it('keeps the framework answer for 10 seconds while nothing runs', async () => {
    const s = await setup();
    await s.fake.respond('status', atlasStatus(1));
    await s.service.status();
    await s.fake.respond('status', atlasStatus(5));
    s.clock.now += ATLAS_STATUS_CACHE_MS - 1;
    assert.equal((await s.service.status()).pending, 1, 'still the cached answer');
    assert.equal((await s.fake.calls()).filter((c) => c.args[0] === 'status').length, 1);

    s.clock.now += 2;
    assert.equal((await s.service.status()).pending, 5, 'asked again after 10 seconds');
  });

  it('rejects when the framework answer cannot be read, so the route can say so plainly', async () => {
    const s = await setup();
    await s.fake.respond('status', { code: 0, raw: 'not json at all' });
    await assert.rejects(() => s.service.status());
  });
});

describe('atlas approval from the framework status', () => {
  it('is false without an atlas folder', async () => {
    const s = await setup();
    await s.fake.respond('status', NO_ATLAS);
    assert.deepEqual(await readFrameworkAtlas(s.ctx), { exists: false, approved: false, pending: 0 });
  });

  it('is false when the terrain is present but not locked', async () => {
    const s = await setup();
    await s.fake.respond('status', atlasStatus(2));
    assert.deepEqual(await readFrameworkAtlas(s.ctx), { exists: true, approved: false, pending: 2 });
  });

  it('is true when the terrain is locked', async () => {
    const s = await setup();
    await s.fake.respond('status', atlasStatus(0, { locked: true }));
    assert.deepEqual(await readFrameworkAtlas(s.ctx), { exists: true, approved: true, pending: 0 });
  });

  it('follows the ground of an urban atlas', async () => {
    const s = await setup();
    await s.fake.respond('status', atlasStatus(0, { layer: 'ground', locked: false }));
    assert.equal((await readFrameworkAtlas(s.ctx)).approved, false);
    await s.fake.respond('status', atlasStatus(0, { layer: 'ground', locked: true }));
    assert.equal((await readFrameworkAtlas(s.ctx)).approved, true);
  });

  it('needs every present approval layer locked, and none present means not approved', () => {
    assert.equal(isApproved(undefined), false);
    assert.equal(isApproved({}), false);
    assert.equal(isApproved({ terrain: { present: false, locked: true } }), false);
    assert.equal(isApproved({ terrain: { present: true, locked: true }, ground: { present: true, locked: false } }), false);
    assert.equal(isApproved({ terrain: { present: true, locked: true }, ground: { present: false, locked: false } }), true);
  });
});

describe('atlas redraw', () => {
  it('is refused without an atlas, and runs no render', async () => {
    const s = await setup();
    await s.fake.respond('status', NO_ATLAS);
    const answer = await s.service.render();
    assert.deepEqual(answer, { status: 409, body: { ok: false, error: EN.noAtlas } });
    assert.equal((await s.fake.calls()).some((c) => c.args[0] === 'render'), false);
  });

  it('redraws from the existing data and answers ok', async () => {
    const s = await setup();
    await s.fake.respond('status', atlasStatus(0));
    await s.fake.respond('render', { code: 0, json: { ok: true } });
    const answer = await s.service.render();
    assert.deepEqual(answer, { status: 200, body: { ok: true } });
    const render = (await s.fake.calls()).find((c) => c.args[0] === 'render');
    assert.deepEqual(render?.args, ['render', s.root]);
  });

  it('answers a plain failure when the render fails', async () => {
    const s = await setup();
    await s.fake.respond('status', atlasStatus(0));
    await s.fake.respond('render', { code: 1, json: { ok: false } });
    const answer = await s.service.render();
    assert.deepEqual(answer, { status: 200, body: { ok: false, error: EN.redrawFailed } });
  });

  it('refuses a second redraw while one runs (one job per campaign)', async () => {
    const s = await setup();
    await s.fake.respond('status', atlasStatus(0));
    await s.fake.respond('render', { code: 0, json: { ok: true }, sleepMs: 600 });
    const first = s.service.render();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const second = await s.service.render();
    assert.equal(second.status, 409);
    assert.deepEqual(second.body, { ok: false, error: JOB_BUSY_TEXT.en });
    assert.deepEqual(await first, { status: 200, body: { ok: true } });
  });
});

describe('atlas preview file', () => {
  it('is null without a preview, and the path once the file is there', async () => {
    const s = await setup();
    assert.equal(s.service.previewPath(), null);
    const file = path.join(s.root, '.campaign', 'cache', 'atlas', 'preview.png');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    assert.equal(s.service.previewPath(), file);
  });
});
