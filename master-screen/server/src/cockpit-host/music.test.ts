import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { Ctx } from '../context.js';
import { createCockpitMusic } from './music.js';
import { contextFor, copyFixture, removeCampaign } from './test-support.js';

const OFF_IT = 'Il modulo musica è disattivato per questa campagna.';
const roots: string[] = [];
const contexts: Ctx[] = [];

async function campaign(musicOn: boolean): Promise<Ctx> {
  const root = await copyFixture();
  roots.push(root);
  if (musicOn) {
    const yaml = await fs.readFile(path.join(root, 'campaign.yaml'), 'utf8');
    await fs.writeFile(path.join(root, 'campaign.yaml'), `${yaml}\nmodules:\n  music: true\n`);
  }
  const ctx = contextFor(root);
  contexts.push(ctx);
  return ctx;
}

const archive = { generation: () => 0, onChange: () => () => {} };

after(async () => {
  for (const ctx of contexts) await ctx.closeAll();
  for (const root of roots) await removeCampaign(root);
});

describe('cockpit music', () => {
  it('answers nothing and refuses playback when the music module is off', async () => {
    const music = createCockpitMusic(await campaign(false), archive);
    assert.deepEqual(await music.search('valle'), []);
    assert.deepEqual(await music.library(), []);
    await assert.rejects(music.request({ command: 'play', trackId: 'x' }), (error: Error) => error.message === OFF_IT);
    await assert.rejects(music.request({ command: 'stop' }), (error: Error) => error.message === OFF_IT);
  });

  it('reports the state on subscribe: off when the module is off', async () => {
    const music = createCockpitMusic(await campaign(false), archive);
    const states: string[] = [];
    music.subscribe?.((state) => states.push(state.phase));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(states, ['off']);
  });

  it('reads the library when the module is on, and refuses an unknown track', async () => {
    const music = createCockpitMusic(await campaign(true), archive);
    const library = await music.library();
    assert.ok(Array.isArray(library));
    await assert.rejects(music.request({ command: 'play', trackId: 'missing' }), (error: Error) => error.message.length > 0);
    await assert.rejects(music.request({ command: 'stop' }), (error: Error) => error.message.length > 0);
  });
});
