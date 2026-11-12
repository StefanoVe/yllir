import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { MusicResponse } from '../../../shared/src/types.js';
import { get, startApp, type Harness } from '../live/test-support.js';
import { MUSIC_OFF_YAML, MUSIC_ON_YAML, musicCampaign, oldFramework, REAL_FRAMEWORK } from '../music/test-support.js';

const harnesses: Harness[] = [];
after(async () => {
  await Promise.all(harnesses.map((h) => h.server.close()));
});

async function start(yaml: string, framework: string = REAL_FRAMEWORK): Promise<Harness> {
  const h = await startApp(musicCampaign(yaml), framework);
  harnesses.push(h);
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

  it('answers enabled false with no tracks when the module is off', async () => {
    const h = await start(MUSIC_OFF_YAML);
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

describe('Content-Security-Policy follows the music flag', () => {
  it('has no YouTube host when the module is off', async () => {
    const h = await start(MUSIC_OFF_YAML);
    const csp = String((await get(h, '/status')).headers['content-security-policy']);
    assert.doesNotMatch(csp, /youtube|ytimg/);
    assert.doesNotMatch(csp, /frame-src/);
  });

  it('adds exactly the three YouTube allowances when the module is on', async () => {
    const h = await start(MUSIC_ON_YAML);
    const csp = String((await get(h, '/music/tracks')).headers['content-security-policy']);
    assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com(;|$)/);
    assert.match(csp, /script-src 'self' https:\/\/www\.youtube\.com;/);
    assert.match(csp, /img-src 'self' data: https:\/\/i\.ytimg\.com;/);
  });
});
