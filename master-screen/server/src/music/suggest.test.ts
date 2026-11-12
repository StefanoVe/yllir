import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Bus } from '../bus.js';
import { createCtx, type Ctx } from '../context.js';
import { suggestMusic } from './suggest.js';
import { MUSIC_OFF_YAML, MUSIC_ON_YAML, musicCampaign, oldFramework, REAL_FRAMEWORK, silentCampaign } from './test-support.js';

interface Published {
  event: string;
  data: unknown;
}

/** A context whose bus records the publishes instead of sending them. */
function ctxWith(campaignRoot: string, frameworkRoot: string = REAL_FRAMEWORK): { ctx: Ctx; published: Published[] } {
  const ctx = createCtx({ campaignRoot, frameworkRoot, port: 4317, log: () => undefined });
  const published: Published[] = [];
  const fakeBus = {
    publish(event: string, data: unknown): number {
      published.push({ event, data });
      return published.length;
    },
  };
  ctx.bus = fakeBus as unknown as Bus;
  return { ctx, published };
}

describe('suggest_music tool', () => {
  it('refuses a call with neither query nor doc, and publishes nothing', async () => {
    const { ctx, published } = ctxWith(musicCampaign());
    const result = await suggestMusic(ctx, { reason: 'nothing to search' });
    assert.equal(result.isError, true);
    assert.equal(published.length, 0);
  });

  it('says the module is off, publishes nothing and writes no file', async () => {
    const root = silentCampaign(MUSIC_OFF_YAML);
    const { ctx, published } = ctxWith(root);
    const result = await suggestMusic(ctx, { query: 'nebbia' });
    assert.match(result.text, /music module is off/);
    assert.equal(published.length, 0);
  });

  it('publishes one music event with at most five tracks and the reason, for a query', async () => {
    const root = musicCampaign(MUSIC_ON_YAML);
    const { ctx, published } = ctxWith(root);
    const result = await suggestMusic(ctx, { query: 'porto', reason: 'the arrival' });
    assert.equal(result.isError, undefined);
    assert.equal(published.length, 1);
    assert.equal(published[0].event, 'music');
    const data = published[0].data as { tracks: Array<{ title: string }>; reason?: string };
    assert.equal(data.reason, 'the arrival');
    assert.ok(data.tracks.length >= 1 && data.tracks.length <= 5);
    assert.equal(data.tracks[0].title, 'Nebbia');
  });

  it('limits a sheet call to that sheet and returns titles only, never the master text', async () => {
    const root = musicCampaign(MUSIC_ON_YAML);
    const { ctx, published } = ctxWith(root);
    const result = await suggestMusic(ctx, { doc: 'Places/Porto/Porto.md' });
    const data = published[0].data as { tracks: Array<{ docPath: string }>; reason?: string };
    assert.ok(data.tracks.every((t) => t.docPath === 'Places/Porto/Porto.md'));
    assert.ok(result.text.includes('Nebbia'));
    assert.ok(!result.text.includes('Secret plot'));
    assert.ok(!result.text.includes('Porto di Vetro'));
    assert.ok(!result.text.includes('https://'));
    assert.equal(data.reason, undefined);
  });

  it('publishes nothing when no track matches', async () => {
    const { ctx, published } = ctxWith(musicCampaign(MUSIC_ON_YAML));
    const result = await suggestMusic(ctx, { query: 'zzzzzz' });
    assert.match(result.text, /No music matches/);
    assert.equal(published.length, 0);
  });

  it('says why when the framework is too old, and publishes nothing', async () => {
    const { ctx, published } = ctxWith(musicCampaign(MUSIC_ON_YAML), oldFramework());
    const result = await suggestMusic(ctx, { query: 'porto' });
    assert.match(result.text, /newer Yllir/);
    assert.equal(published.length, 0);
  });
});
