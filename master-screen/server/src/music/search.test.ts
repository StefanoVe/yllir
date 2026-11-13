import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MusicTrack } from '../../../shared/src/types.js';
import { createCtx } from '../context.js';
import { loadFrameworkModule } from '../engine.js';
import { searchTracks, type FoldModule, type MusicEntry } from './search.js';
import { STOPWORDS, SYNONYM_GROUPS, VIBE_GROUPS } from './lexicon.js';
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

  it('matches any query word (OR): "porto zzz" still finds the port tracks', async () => {
    const f = await fold();
    assert.deepEqual(
      searchTracks(TRACKS, { query: 'porto zzz', fold: f }).map((t) => t.title),
      ['Nebbia', 'Porto di notte', 'Taverna rumori'],
    );
    assert.deepEqual(searchTracks(TRACKS, { query: 'zzzzzz qqqqqq', fold: f }), []);
  });

  it('ranks tracks covering more query words first, then by total score', async () => {
    const f = await fold();
    // Nebbia covers both words ("porto" in its mood, "nebbia" in its title); the others cover one.
    const ranked = searchTracks(TRACKS, { query: 'porto nebbia', fold: f }).map((t) => t.title);
    assert.equal(ranked[0], 'Nebbia');
    assert.deepEqual(ranked.slice(1), ['Porto di notte', 'Taverna rumori']);
  });

  it('ranks preferred first on ties, then the alphabet', async () => {
    const f = await fold();
    // Every track matches "porto" in a field with the same weight; Nebbia is the preferred one.
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

  it('finds a tavern track by the vibe words of a place: "locanda affollata" finds "taverna" in the mood', async () => {
    const f = await fold();
    const tracks = [track({ title: 'Rumori', mood: 'taverna, caldo', docPath: 'Places/Osteria/Osteria.md', docTitle: 'Osteria' })];
    assert.deepEqual(searchTracks(tracks, { query: 'locanda affollata', fold: f }).map((t) => t.title), ['Rumori']);
    assert.deepEqual(searchTracks(tracks, { query: 'affollata', fold: f }), []);
  });

  it('matches by synonym group: "fight" finds a battle track and "castello" a fortress track', async () => {
    const f = await fold();
    const tracks = [
      track({ title: 'Scontro finale', mood: 'ritmo', docPath: 'Scenes/A.md', docTitle: 'A' }),
      track({ title: 'Mura', mood: 'fortezza di pietra', docPath: 'Scenes/B.md', docTitle: 'B' }),
    ];
    assert.deepEqual(searchTracks(tracks, { query: 'fight', fold: f }).map((t) => t.title), ['Scontro finale']);
    assert.deepEqual(searchTracks(tracks, { query: 'castello', fold: f }).map((t) => t.title), ['Mura']);
  });

  it('matches by mood group: "tensione" finds a "suspense" track', async () => {
    const f = await fold();
    const tracks = [
      track({ title: 'Passo lento', mood: 'suspense, buio', docPath: 'Scenes/A.md', docTitle: 'A' }),
      track({ title: 'Fiera', mood: 'allegra', docPath: 'Scenes/B.md', docTitle: 'B' }),
    ];
    assert.deepEqual(searchTracks(tracks, { query: 'tensione', fold: f }).map((t) => t.title), ['Passo lento']);
  });

  it('matches stems: "boschi" finds a "bosco" track and "bosco" finds "boschi"', async () => {
    const f = await fold();
    const tracks = [track({ title: 'Canto', mood: 'nel bosco', docPath: 'Scenes/A.md', docTitle: 'A' })];
    assert.deepEqual(searchTracks(tracks, { query: 'boschi', fold: f }).map((t) => t.title), ['Canto']);
    const other = [track({ title: 'Passi tra i boschi', mood: 'lenti', docPath: 'Scenes/A.md', docTitle: 'A' })];
    assert.deepEqual(searchTracks(other, { query: 'bosco', fold: f }).map((t) => t.title), ['Passi tra i boschi']);
  });

  it('keeps loose vibe results only when no track matches directly', async () => {
    const f = await fold();
    // "viaggio" and "montagna" are vibe neighbours (0.6), not synonyms.
    const loose = track({ title: 'Cime', mood: 'vento sulla montagna', docPath: 'Scenes/A.md', docTitle: 'A' });
    const direct = track({ title: 'Cammino', mood: 'passi', docPath: 'Scenes/B.md', docTitle: 'B' });
    assert.deepEqual(searchTracks([loose], { query: 'viaggio', fold: f }).map((t) => t.title), ['Cime']);
    assert.deepEqual(
      searchTracks([loose, direct], { query: 'viaggio', fold: f }).map((t) => t.title),
      ['Cammino'],
    );
  });

  it('returns a snippet and the matched words when a passage matches, and none when only a field does', async () => {
    const f = await fold();
    const entry: MusicEntry = {
      track: track({ title: 'Ombre', mood: 'lenta', docPath: 'Places/Porto/Porto.md', docTitle: 'Porto di Vetro' }),
      area: 'Porto',
      passages: ['La nave arriva al molo.', 'Il contrabbandiere nasconde il carico sotto la nebbia del mattino.'],
    };
    const [hit] = searchTracks([entry], { query: 'nebbia', fold: f });
    assert.equal(hit.snippet, 'Il contrabbandiere nasconde il carico sotto la nebbia del mattino.');
    assert.deepEqual(hit.matches, ['nebbia']);
    const [titleOnly] = searchTracks([entry], { query: 'lenta', fold: f });
    assert.equal(titleOnly.snippet, undefined);
    assert.equal(titleOnly.matches, undefined);
  });

  it('puts the passage covering most query words in the snippet', async () => {
    const f = await fold();
    const entry: MusicEntry = {
      track: track({ title: 'Ombre', mood: 'lenta', docPath: 'Scenes/A.md', docTitle: 'A' }),
      area: '',
      passages: ['La piazza è vuota.', 'La piazza è piena di fumo e di canti.', 'Fumo sul mare.'],
    };
    const [hit] = searchTracks([entry], { query: 'piazza fumo', fold: f });
    assert.equal(hit.snippet, 'La piazza è piena di fumo e di canti.');
    assert.deepEqual(hit.matches?.sort(), ['fumo', 'piazza']);
  });

  it('a query made only of stopwords or short words matches nothing', async () => {
    const f = await fold();
    assert.deepEqual(searchTracks(TRACKS, { query: 'la musica di un', fold: f }), []);
    assert.deepEqual(searchTracks(TRACKS, { query: 'ab', fold: f }), []);
    assert.ok(STOPWORDS.has('musica') && STOPWORDS.has('ost'));
  });

  it('keeps the doc filter with a query and the empty query returns all, preferred first', async () => {
    const f = await fold();
    assert.deepEqual(
      searchTracks(TRACKS, { query: 'porto', doc: 'Places/Porto/Porto.md', fold: f }).map((t) => t.title),
      ['Nebbia', 'Taverna rumori'],
    );
    assert.equal(searchTracks(TRACKS, { query: '', fold: f }).length, TRACKS.length);
    assert.equal(searchTracks(TRACKS, { query: '   ', fold: f }).length, TRACKS.length);
  });

  it('keeps the lexicon in lowercase, accent-free, single words', () => {
    const words = [...SYNONYM_GROUPS, ...VIBE_GROUPS].flat();
    assert.ok(words.every((word) => /^[a-z]+$/.test(word)), words.filter((w) => !/^[a-z]+$/.test(w)).join(', '));
    assert.ok(SYNONYM_GROUPS.length + VIBE_GROUPS.length >= 40);
  });
});
