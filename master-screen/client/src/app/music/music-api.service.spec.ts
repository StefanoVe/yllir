import { signal, computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EMPTY, Subject, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicResponse, MusicTrack } from '@shared/types';
import { LiveService } from '../core/live.service';
import { MAX_SUGGESTIONS, MUSIC_DEBOUNCE_MS, MusicApiService, MusicSearch } from './music-api.service';
import { settle, youtubeTrack } from './testing';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe('MusicSearch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for a pause in typing, then asks once', async () => {
    vi.useFakeTimers();
    const tracks = vi.fn(async () => ({ enabled: true, tracks: [] as MusicTrack[] }));
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
    const tracks = vi.fn(async () => ({ enabled: true, tracks: [] as MusicTrack[] }));
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
    await second.promise;
    await settle();
    expect(search.tracks().map((track) => track.title)).toEqual(['Bravo']);

    first.resolve({ enabled: true, tracks: [youtubeTrack('A', { title: 'Alpha' })] });
    await first.promise;
    await settle();
    expect(search.tracks().map((track) => track.title)).toEqual(['Bravo']);
    expect(search.status()).toBe('done');
  });

  it('drops late answers after dispose', async () => {
    const pending = deferred<MusicResponse>();
    const search = new MusicSearch({ tracks: vi.fn().mockReturnValue(pending.promise) });
    search.start();
    search.dispose();
    pending.resolve({ enabled: true, tracks: [youtubeTrack('late')] });
    await pending.promise;
    await settle();
    expect(search.tracks()).toEqual([]);
  });

  it('shows the plain error when the search fails', async () => {
    const search = new MusicSearch({ tracks: vi.fn().mockRejectedValue(new Error('Could not search.')) });
    await search.run('x');
    expect(search.status()).toBe('error');
    expect(search.error()).toBe('Could not search.');
    expect(search.tracks()).toEqual([]);
  });
});

describe('MusicApiService', () => {
  let live: Subject<{ tracks: MusicTrack[]; reason?: string }>;

  beforeEach(() => {
    live = new Subject();
    const fakeLive = {
      on: () => live.asObservable() as Observable<unknown>,
      resync$: EMPTY,
      connected: signal(false).asReadonly(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: LiveService, useValue: fakeLive }] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  function api(): MusicApiService {
    return TestBed.inject(MusicApiService);
  }

  it('asks the tracks endpoint with the query and the sheet', async () => {
    const fetchMock = vi.fn(async (_input: string) => new Response(JSON.stringify({ enabled: true, tracks: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await api().tracks('porto nebbia', 'places/porto.md');
    expect(response).toEqual({ enabled: true, tracks: [] });
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://127.0.0.1');
    expect(url.pathname).toBe('/api/music/tracks');
    expect(url.searchParams.get('q')).toBe('porto nebbia');
    expect(url.searchParams.get('doc')).toBe('places/porto.md');
  });

  it('turns a failed call into a plain message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await expect(api().tracks('x')).rejects.toThrow(/could not be searched/i);
  });

  it('shows music suggestions with their reason, newest first, at most five', () => {
    const service = api();
    for (let i = 0; i < 4; i++) {
      live.next({ tracks: [youtubeTrack(`old${i}`)], reason: `reason ${i}` });
    }
    live.next({ tracks: [youtubeTrack('n1'), youtubeTrack('n2'), youtubeTrack('n3')], reason: 'fog' });
    const shown = service.suggestions();
    expect(shown).toHaveLength(MAX_SUGGESTIONS);
    expect(shown.slice(0, 3).map((item) => item.track.id)).toEqual(['n1', 'n2', 'n3']);
    expect(shown[0].reason).toBe('fog');
    expect(shown[3].track.id).toBe('old3');
  });

  it('dismisses one suggestion, or all of them', () => {
    const service = api();
    live.next({ tracks: [youtubeTrack('a'), youtubeTrack('b')], reason: 'calm' });
    const [first] = service.suggestions();
    service.dismiss(first.id);
    expect(service.suggestions().map((item) => item.track.id)).toEqual(['b']);
    service.clearSuggestions();
    expect(service.suggestions()).toEqual([]);
  });

  it('exposes the suggestions as a read-only list signal', () => {
    const service = api();
    const count = computed(() => service.suggestions().length);
    live.next({ tracks: [youtubeTrack('a')] });
    expect(count()).toBe(1);
  });
});
