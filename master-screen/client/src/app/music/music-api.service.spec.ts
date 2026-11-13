import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicResponse } from '@shared/types';
import { MAX_SUGGESTIONS, MUSIC_DEBOUNCE_MS, MusicApiService, MusicSearch } from './music-api.service';
import { FakeMusicServer, settle, youtubeTrack } from './testing';

/** Lets promise callbacks run while fake timers are on (settle() uses real timers). */
async function microtasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe('MusicSearch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for a pause in typing, then asks once', () => {
    vi.useFakeTimers();
    const tracks = vi.fn(async () => ({ enabled: true, tracks: [] }));
    const search = new MusicSearch({ tracks });
    search.type('p');
    search.type('po');
    search.type('por');
    expect(tracks).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MUSIC_DEBOUNCE_MS);
    expect(tracks).toHaveBeenCalledTimes(1);
    expect(tracks).toHaveBeenCalledWith('por');
  });

  it('shows everything at once when the query is cleared', () => {
    vi.useFakeTimers();
    const tracks = vi.fn(async () => ({ enabled: true, tracks: [] }));
    const search = new MusicSearch({ tracks });
    search.type('');
    expect(tracks).toHaveBeenCalledWith('');
  });

  it('keeps only the answer of the newest request', async () => {
    vi.useFakeTimers();
    const first = deferred<MusicResponse>();
    const second = deferred<MusicResponse>();
    const tracks = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const search = new MusicSearch({ tracks });

    search.type('a');
    vi.advanceTimersByTime(MUSIC_DEBOUNCE_MS);
    search.type('ab');
    vi.advanceTimersByTime(MUSIC_DEBOUNCE_MS);
    expect(tracks).toHaveBeenNthCalledWith(2, 'ab');

    second.resolve({ enabled: true, tracks: [youtubeTrack('B', { title: 'Bravo' })] });
    await microtasks();
    expect(search.tracks().map((track) => track.title)).toEqual(['Bravo']);

    first.resolve({ enabled: true, tracks: [youtubeTrack('A', { title: 'Alpha' })] });
    await microtasks();
    expect(search.tracks().map((track) => track.title)).toEqual(['Bravo']);
  });

  it('reports a failed search with its message and clears the results', async () => {
    const search = new MusicSearch({ tracks: async () => Promise.reject(new Error('The music could not be searched.')) });
    await search.run('x');
    expect(search.status()).toBe('error');
    expect(search.error()).toBe('The music could not be searched.');
    expect(search.tracks()).toEqual([]);
  });
});

describe('MusicApiService', () => {
  let server: FakeMusicServer;

  beforeEach(() => {
    server = new FakeMusicServer();
    server.tracks = [youtubeTrack('one'), youtubeTrack('two')];
    server.install();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...server.providers()] });
  });

  afterEach(() => {
    server.unstub();
    TestBed.resetTestingModule();
  });

  it('remembers every track it sees, so the player can show a title by id', async () => {
    const api = TestBed.inject(MusicApiService);
    await api.tracks('');
    expect(api.known().get('one')?.title).toBe('Track one');
    expect(api.known().has('two')).toBe(true);
  });

  it('sends the query and the sheet to the tracks endpoint', async () => {
    const api = TestBed.inject(MusicApiService);
    await api.tracks('  pioggia  ', 'places/port.md');
    expect(server.searches).toEqual(['pioggia']);
  });

  it('rejects a failed tracks call with a plain message', async () => {
    server.failSearch = true;
    await expect(TestBed.inject(MusicApiService).tracks('x')).rejects.toThrow('The music could not be searched. Try again.');
  });

  it('keeps the newest suggestions first and at most the maximum', () => {
    const api = TestBed.inject(MusicApiService);
    const many = Array.from({ length: MAX_SUGGESTIONS + 2 }, (_, i) => youtubeTrack(`s${i}`));
    api.addSuggestions(many, 'The port');
    expect(api.suggestions()).toHaveLength(MAX_SUGGESTIONS);
    expect(api.suggestions()[0].track.id).toBe('s0');
    expect(api.suggestions()[0].reason).toBe('The port');
    api.dismiss(api.suggestions()[0].id);
    expect(api.suggestions()).toHaveLength(MAX_SUGGESTIONS - 1);
  });

  it('receives the live music suggestions and never plays them', async () => {
    const api = TestBed.inject(MusicApiService);
    server.emit('music', { tracks: [youtubeTrack('fog')], reason: 'fog' });
    await settle();
    expect(api.suggestions()).toHaveLength(1);
    expect(server.commands).toEqual([]);
  });
});
