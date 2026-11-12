import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createCtx, type Ctx } from '../context.js';
import { invalidateMusicLibrary, loadMusicLibrary } from './library.js';
import { OLD_FRAMEWORK_NOTE } from './framework.js';
import { musicCampaign, oldFramework, REAL_FRAMEWORK } from './test-support.js';
import type { MusicTrack } from '../../../shared/src/types.js';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

function ctxFor(campaignRoot: string, frameworkRoot: string = REAL_FRAMEWORK): Ctx {
  return createCtx({ campaignRoot, frameworkRoot, port: 4317, log: () => undefined });
}

async function tracksOf(campaignRoot: string, frameworkRoot?: string): Promise<MusicTrack[]> {
  const result = await loadMusicLibrary(ctxFor(campaignRoot, frameworkRoot));
  assert.equal(result.ok, true);
  return result.ok ? result.tracks : [];
}

describe('music library on a temporary campaign', () => {
  let campaign: string;
  let tracks: MusicTrack[];

  before(async () => {
    campaign = musicCampaign();
    cleanup.push(campaign);
    tracks = await tracksOf(campaign);
  });

  it('reads only the master-only music items, never the public part, CLAUDE.md or .campaign', () => {
    const titles = tracks.map((t) => t.title);
    assert.ok(!titles.includes('Public leak'));
    assert.ok(!titles.includes('Agent file'));
    assert.ok(!titles.includes('Hidden'));
    assert.ok(!titles.includes('Fake'));
    assert.deepEqual(
      tracks.map((t) => t.docPath),
      [
        'Places/Foresta/Foresta.md',
        'Places/Porto/Porto.md',
        'Places/Porto/Porto.md',
        'Places/Porto/Porto.md',
        'Places/Porto/Porto.md',
        'Places/Porto/Porto.md',
        'Places/Porto/Porto.md',
        'Places/Porto/Porto.md',
      ].sort(),
    );
  });

  it('drops http and javascript links and keeps https ones', () => {
    const titles = tracks.map((t) => t.title);
    assert.ok(!titles.includes('Insecure'));
    assert.ok(!titles.includes('Script'));
    assert.ok(tracks.every((t) => t.url.startsWith('https://')));
  });

  it('classifies providers and extracts video ids', () => {
    const byTitle = Object.fromEntries(tracks.map((t) => [t.title, t]));
    assert.deepEqual(
      { provider: byTitle['Taverna rumori'].provider, videoId: byTitle['Taverna rumori'].videoId },
      { provider: 'youtube', videoId: 'abcdefghijk' },
    );
    assert.equal(byTitle['Nebbia'].videoId, 'ABCDEFGHIJK');
    assert.equal(byTitle['Music site'].videoId, 'MUSIC012345');
    assert.equal(byTitle['Short'].videoId, 'SHORTID1234');
    assert.equal(byTitle['Embed'].videoId, 'EMBEDID1234');
    assert.equal(byTitle['Lista'].provider, 'external');
    assert.equal(byTitle['Lista'].videoId, undefined);
    assert.equal(byTitle['Ext'].provider, 'external');
  });

  it('marks the preferred track from the Preferita or Preferred mood prefix', () => {
    const byTitle = Object.fromEntries(tracks.map((t) => [t.title, t]));
    assert.equal(byTitle['Nebbia'].preferred, true);
    assert.equal(byTitle['Forest theme'].preferred, true);
    assert.equal(byTitle['Taverna rumori'].preferred, undefined);
    assert.equal(byTitle['Taverna rumori'].mood, 'caldo, affollato');
  });

  it('uses the first H1 as the sheet title, or the file name when there is none', () => {
    const byTitle = Object.fromEntries(tracks.map((t) => [t.title, t]));
    assert.equal(byTitle['Nebbia'].docTitle, 'Porto di Vetro');
    assert.equal(byTitle['Forest theme'].docTitle, 'Foresta');
  });

  it('gives stable ids that do not repeat', () => {
    const ids = tracks.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => /^[0-9a-f]{12}$/.test(id)));
  });

  it('rescans after a document changes once the cache is invalidated', async () => {
    const dir = musicCampaign();
    cleanup.push(dir);
    const ctx = ctxFor(dir);
    assert.equal((await loadMusicLibrary(ctx)).ok, true);
    const extra = path.join(dir, 'Places', 'Mercato', 'Mercato.md');
    fs.writeFileSync(extra, `${fs.readFileSync(extra, 'utf8')}\n<!-- master -->\n### Musica\n- [Nuovo](https://youtu.be/NUOVOBRANO1) — nuovo\n<!-- /master -->\n`);
    invalidateMusicLibrary(dir);
    const after = await loadMusicLibrary(ctx);
    assert.ok(after.ok && after.tracks.some((t) => t.title === 'Nuovo'));
  });
});

describe('music library with an old framework', () => {
  it('reports a plain note and never throws when links.mjs is missing', async () => {
    const campaign = musicCampaign();
    cleanup.push(campaign);
    const old = oldFramework();
    cleanup.push(old);
    const result = await loadMusicLibrary(ctxFor(campaign, old));
    assert.deepEqual(result, { ok: false, note: OLD_FRAMEWORK_NOTE });
  });
});
