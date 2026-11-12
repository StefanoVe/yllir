import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MusicTrack } from '../../../shared/src/types.js';
import { createCtx } from '../context.js';
import { loadFrameworkModule } from '../engine.js';
import { searchTracks, type FoldModule } from './search.js';
import { REAL_FRAMEWORK } from './test-support.js';

function track(over: Partial<MusicTrack> & { title: string; docPath: string; docTitle: string }): MusicTrack {
  return {
    id: `${over.docPath}-${over.title}`.replace(/\W/g, '').slice(0, 12),
    url: 'https://youtu.be/ABCDEFGHIJK',
    mood: '',
    provider: 'youtube',
    ...over,
  };
}

const TRACKS: MusicTrack[] = [
  track({ title: 'Taverna rumori', mood: 'caldo, affollato', docPath: 'Places/Porto/Porto.md', docTitle: 'Porto di Vetro' }),
  track({ title: 'Nebbia', mood: 'nebbia sul porto, lenta', docPath: 'Places/Porto/Porto.md', docTitle: 'Porto di Vetro', preferred: true }),
  track({ title: 'Fiera', mood: 'allegra', docPath: 'Places/Mercato/Mercato.md', docTitle: 'Mercato' }),
  track({ title: 'Bosco', mood: 'vento', docPath: 'Places/Foresta/Foresta.md', docTitle: 'Foresta', preferred: true }),
  track({ title: 'Porto di notte', mood: 'buio', docPath: 'Places/Mercato/Mercato.md', docTitle: 'Mercato' }),
];

async function fold(): Promise<FoldModule> {
  const ctx = createCtx({ campaignRoot: '/unused', frameworkRoot: REAL_FRAMEWORK, port: 1, log: () => undefined });
  return loadFrameworkModule<FoldModule>(ctx, 'fold');
}

describe('searchTracks', () => {
  it('matches folded whole words and prefixes across title, mood and sheet', async () => {
    const f = await fold();
    assert.deepEqual(searchTracks(TRACKS, { query: 'NEBBIA', fold: f }).map((t) => t.title), ['Nebbia']);
    assert.deepEqual(searchTracks(TRACKS, { query: 'affol', fold: f }).map((t) => t.title), ['Taverna rumori']);
    assert.deepEqual(searchTracks(TRACKS, { query: 'mercat', fold: f }).map((t) => t.title), ['Fiera', 'Porto di notte']);
  });

  it('requires every term: "porto nebbia" finds the foggy track of the port sheet', async () => {
    const f = await fold();
    assert.deepEqual(searchTracks(TRACKS, { query: 'porto nebbia', fold: f }).map((t) => t.title), ['Nebbia']);
    assert.deepEqual(searchTracks(TRACKS, { query: 'porto zzz', fold: f }), []);
  });

  it('ranks title and mood matches above sheet matches, and preferred first on ties', async () => {
    const f = await fold();
    // Nebbia and Porto di notte match in title or mood (strong); Taverna only in its sheet title (weak).
    const ranked = searchTracks(TRACKS, { query: 'porto', fold: f }).map((t) => t.title);
    assert.deepEqual(ranked, ['Nebbia', 'Porto di notte', 'Taverna rumori']);
  });

  it('filters by sheet path with doc', async () => {
    const f = await fold();
    assert.deepEqual(
      searchTracks(TRACKS, { doc: 'Places/Mercato/Mercato.md', fold: f }).map((t) => t.title),
      ['Fiera', 'Porto di notte'],
    );
    assert.deepEqual(searchTracks(TRACKS, { query: 'vento', doc: 'Places/Porto/Porto.md', fold: f }), []);
    assert.deepEqual(
      searchTracks(TRACKS, { doc: './Places\\Foresta\\Foresta.md', fold: f }).map((t) => t.title),
      ['Bosco'],
    );
  });

  it('without a query lists all tracks, preferred first, then by sheet and title', async () => {
    const f = await fold();
    assert.deepEqual(
      searchTracks(TRACKS, { fold: f }).map((t) => t.title),
      ['Bosco', 'Nebbia', 'Fiera', 'Porto di notte', 'Taverna rumori'],
    );
  });

  it('a query with no word matches nothing, and the limit is applied', async () => {
    const f = await fold();
    assert.deepEqual(searchTracks(TRACKS, { query: '!!!', fold: f }), []);
    assert.equal(searchTracks(TRACKS, { fold: f, limit: 2 }).length, 2);
  });
});
