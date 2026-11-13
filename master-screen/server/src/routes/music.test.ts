import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { MusicResponse } from '../../../shared/src/types.js';
import { get, send, startApp, type Harness } from '../live/test-support.js';
import { musicAvailable } from '../music/availability.js';
import { MUSIC_OFF_YAML, MUSIC_ON_YAML, musicCampaign, oldFramework, REAL_FRAMEWORK, silentCampaign } from '../music/test-support.js';

const harnesses: Harness[] = [];
after(async () => {
  for (const h of harnesses) {
    await h.server.close();
    await h.ctx.closeAll();
  }
});

async function start(yaml: string, framework: string = REAL_FRAMEWORK, campaign?: string): Promise<Harness> {
  const h = await startApp(campaign ?? musicCampaign(yaml), framework);
  harnesses.push(h);
  // The music cache is filled shortly after boot in the app; fill it now so the first request sees it.
  await musicAvailable(h.ctx);
  return h;
}

describe('GET /api/music/tracks', () => {
  it('lists the master-only tracks, preferred first, when the module is on', async () => {
    const h = await start(MUSIC_ON_YAML);
    const res = await get(h, '/music/tracks');
    assert.equal(res.status, 200);
    const body = res.json as MusicResponse;
    assert.equal(body.enabled, true);
    assert.equal(body.tracks.length, 8);
    assert.equal(body.tracks[0].title, 'Forest theme');
    assert.equal(body.tracks.some((t) => t.title === 'Public leak'), false);
    assert.equal('note' in (res.json as object), false);
  });

  it('filters by q and by doc', async () => {
    const h = await start(MUSIC_ON_YAML);
    const byWord = (await get(h, '/music/tracks?q=nebbia')).json as MusicResponse;
    assert.deepEqual(byWord.tracks.map((t) => t.title), ['Nebbia']);
    const byDoc = (await get(h, '/music/tracks?doc=Places%2FMercato%2FMercato.md')).json as MusicResponse;
    assert.deepEqual(byDoc.tracks, []);
    const combined = (await get(h, '/music/tracks?q=porto&doc=Places%2FPorto%2FPorto.md')).json as MusicResponse;
    assert.equal(combined.tracks[0].title, 'Nebbia');
  });

  it('answers enabled false with no tracks when the module is off and no document has a music item', async () => {
    const h = await start(MUSIC_OFF_YAML, REAL_FRAMEWORK, silentCampaign(MUSIC_OFF_YAML));
    const res = await get(h, '/music/tracks');
    assert.deepEqual(res.json, { enabled: false, tracks: [] });
  });

  it('answers enabled false with a plain note when the framework has no music parser', async () => {
    const h = await start(MUSIC_ON_YAML, oldFramework());
    const body = (await get(h, '/music/tracks')).json as { enabled: boolean; tracks: unknown[]; note?: string };
    assert.equal(body.enabled, false);
    assert.deepEqual(body.tracks, []);
    assert.match(body.note ?? '', /newer Yllir/);
  });
});

describe('Content-Security-Policy: YouTube only for thumbnails', () => {
  it('with the module on, ytimg is allowed in img-src only; no YouTube script, frame or connect host', async () => {
    const h = await start(MUSIC_ON_YAML);
    const csp = String((await get(h, '/music/tracks')).headers['content-security-policy']);
    assert.doesNotMatch(csp, /(script|style|frame|connect|font|object|default)-src[^;]*(youtube|ytimg)/);
    assert.doesNotMatch(csp, /frame-src/);
    assert.match(csp, /img-src 'self' data: https:\/\/i\.ytimg\.com(;|$)/);
  });
});

describe('GET /api/music/state', () => {
  it('answers the inactive state quietly when the module is off', async () => {
    const h = await start(MUSIC_OFF_YAML, REAL_FRAMEWORK, silentCampaign(MUSIC_OFF_YAML));
    const res = await get(h, '/music/state');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { available: false, phase: 'idle', trackId: null, position: 0, duration: 0, volume: 80, loop: true });
  });
});

describe('POST /api/music/command', () => {
  it('refuses a malformed command with a plain-language 400, before anything runs', async () => {
    const h = await start(MUSIC_ON_YAML);
    const cases: unknown[] = [
      undefined,
      [],
      { command: 'explode' },
      { command: 'play' },
      { command: 'play', trackId: 'NOT-HEX-ID!!' },
      { command: 'play', trackId: 'abcdef012345', url: 'https://example.org' },
      { command: 'seek', value: -1 },
      { command: 'seek', value: '5' },
      { command: 'volume', value: 101 },
      { command: 'loop', value: 'yes' },
      { command: 'pause', extra: true },
    ];
    for (const body of cases) {
      const res = await send(h, 'POST', '/music/command', body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(typeof (res.json as { error?: unknown }).error, 'string');
    }
    assert.equal(h.events.some((e) => e.event === 'musicstate'), false);
  });

  it('answers the inactive state with 200 when the module is off', async () => {
    const h = await start(MUSIC_OFF_YAML, REAL_FRAMEWORK, silentCampaign(MUSIC_OFF_YAML));
    const res = await send(h, 'POST', '/music/command', { command: 'play', trackId: 'abcdef012345' });
    assert.equal(res.status, 200);
    assert.equal((res.json as { available: boolean }).available, false);
  });

  it('applies volume and loop, answers the new state and publishes it on the bus', async () => {
    const h = await start(MUSIC_ON_YAML);
    const volume = await send(h, 'POST', '/music/command', { command: 'volume', value: 35 });
    assert.equal(volume.status, 200);
    assert.equal((volume.json as { volume: number }).volume, 35);
    const loop = await send(h, 'POST', '/music/command', { command: 'loop', value: false });
    assert.equal((loop.json as { loop: boolean }).loop, false);
    const state = (await get(h, '/music/state')).json as { volume: number; loop: boolean; phase: string };
    assert.equal(state.volume, 35);
    assert.equal(state.loop, false);
    assert.equal(state.phase, 'idle');
    const published = h.events.filter((e) => e.event === 'musicstate');
    assert.equal(published.length >= 2, true);
  });

  it('a play of a track the library does not know answers unavailable and starts nothing', async () => {
    const h = await start(MUSIC_ON_YAML);
    const res = await send(h, 'POST', '/music/command', { command: 'play', trackId: 'abcdef012345' });
    assert.equal(res.status, 200);
    assert.equal((res.json as { phase: string }).phase, 'loading');
    // The lookup runs in the background: poll until it answers.
    let body: { phase: string; error?: string } = { phase: 'loading' };
    for (let i = 0; i < 50 && body.phase === 'loading'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      body = (await get(h, '/music/state')).json as { phase: string; error?: string };
    }
    assert.equal(body.phase, 'error');
    assert.equal(body.error, 'unavailable');
  });
});
