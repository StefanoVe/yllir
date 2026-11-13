import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, describe, it } from 'node:test';
import { createCtx, type Ctx } from '../context.js';
import { musicAvailable, musicAvailableCached } from './availability.js';
import { musicEnabledAtStartup } from './config.js';
import { invalidateMusicLibrary } from './library.js';
import { MUSIC_OFF_YAML, MUSIC_ON_YAML, musicCampaign, REAL_FRAMEWORK, silentCampaign } from './test-support.js';
import { queryMusic } from './service.js';
import { get, startApp } from '../live/test-support.js';
import { buildStatus } from '../routes/status.js';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

function ctxFor(campaignRoot: string): Ctx {
  return createCtx({ campaignRoot, frameworkRoot: REAL_FRAMEWORK, port: 4317, log: () => undefined });
}

describe('music availability', () => {
  it('is on when a document has a valid music item, with the module flag off', async () => {
    const root = musicCampaign(MUSIC_OFF_YAML);
    cleanup.push(root);
    invalidateMusicLibrary(root);
    const ctx = ctxFor(root);
    assert.equal(await musicAvailable(ctx), true);
    assert.equal(musicAvailableCached(root), true);
    const result = await queryMusic(ctx, {});
    assert.equal(result.enabled, true);
    assert.ok(result.tracks.length > 0);
    const status = await buildStatus(ctx);
    assert.equal(status.modules.music, true);
  });

  it('is off when the module flag is off and no document has a music item', async () => {
    const root = silentCampaign(MUSIC_OFF_YAML);
    cleanup.push(root);
    invalidateMusicLibrary(root);
    const ctx = ctxFor(root);
    assert.equal(await musicAvailable(ctx), false);
    assert.equal(musicAvailableCached(root), false);
    assert.deepEqual(await queryMusic(ctx, {}), { enabled: false, tracks: [] });
    assert.equal((await buildStatus(ctx)).modules.music, false);
  });

  it('is on when the module flag is on, even with no items', async () => {
    const root = silentCampaign(MUSIC_ON_YAML);
    cleanup.push(root);
    invalidateMusicLibrary(root);
    assert.equal(await musicAvailable(ctxFor(root)), true);
  });

  it('answers false and never throws for a campaign folder that does not exist', async () => {
    const missing = '/definitely/not/a/campaign/folder';
    assert.equal(await musicAvailable(ctxFor(missing)), false);
    assert.equal(musicAvailableCached(missing), false);
  });

  it('starts from the startup flag before anything has been computed', () => {
    const root = silentCampaign(MUSIC_ON_YAML);
    cleanup.push(root);
    assert.equal(musicAvailableCached(root), musicEnabledAtStartup(root));
    assert.equal(musicAvailableCached(root), true);
  });

  it('the app serves a CSP with no YouTube script, style, frame or connect host, whatever the music cache says', async () => {
    const root = musicCampaign(MUSIC_OFF_YAML);
    cleanup.push(root);
    invalidateMusicLibrary(root);
    const h = await startApp(root, REAL_FRAMEWORK);
    try {
      await musicAvailable(h.ctx);
      const csp = String((await get(h, '/status')).headers['content-security-policy']);
      // Thumbnails only: ytimg may appear in img-src and nowhere else.
      assert.doesNotMatch(csp, /(script|style|frame|connect|font|object|default)-src[^;]*(youtube|ytimg)/);
      assert.match(csp, /img-src 'self' data: https:\/\/i\.ytimg\.com(;|$)/);
    } finally {
      await h.server.close();
      await h.ctx.closeAll();
    }
  });
});
