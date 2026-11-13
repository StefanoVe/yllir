import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { MusicCommand, MusicPlayback, MusicResponse, MusicTrack } from '@shared/types';
import { callJson } from '../encyclopedia/call-json';
import { LiveService } from '../core/live.service';
import { I18n } from '../i18n';

export const MUSIC_DEBOUNCE_MS = 150;
/** The suggestion tray keeps this many suggestions, newest first. */
export const MAX_SUGGESTIONS = 5;

/** A track the assistant showed, with the reason it gave. Suggestions never play by themselves. */
export interface MusicSuggestion {
  id: string;
  track: MusicTrack;
  reason?: string;
}

/**
 * Typed calls to the music endpoints, plus the live `music` suggestions. Every track the app has
 * seen (search results, suggestions, the queue) is kept in `known`, so the player can show the
 * title of whatever the server is playing without asking again.
 */
@Injectable({ providedIn: 'root' })
export class MusicApiService {
  private readonly i18n = inject(I18n);
  private seq = 0;

  /** Newest first, at most MAX_SUGGESTIONS. Cleared one by one with dismiss(). */
  readonly suggestions = signal<MusicSuggestion[]>([]);
  /** Every track seen so far, by id. */
  readonly known = signal<ReadonlyMap<string, MusicTrack>>(new Map());

  constructor() {
    inject(LiveService)
      .on('music')
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((event) => this.addSuggestions(event.tracks, event.reason));
  }

  /** GET /api/music/tracks. Rejects with a plain-language message when the call fails. */
  async tracks(q: string, doc?: string): Promise<MusicResponse> {
    const params = new URLSearchParams();
    if (q.trim() !== '') params.set('q', q.trim());
    if (doc) params.set('doc', doc);
    const qs = params.toString();

    let response: Response;
    try {
      response = await fetch(`/api/music/tracks${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
    } catch {
      throw new Error(this.i18n.t('errors.network'));
    }
    if (!response.ok) throw new Error(this.i18n.t('music.error.search'));
    const body = (await response.json()) as MusicResponse;
    const tracks = Array.isArray(body.tracks) ? body.tracks : [];
    this.remember(tracks);
    return { enabled: body.enabled === true, tracks };
  }

  /** GET /api/music/state: what the server's player is doing now. */
  playback(): Promise<MusicPlayback> {
    return callJson<MusicPlayback>(this.i18n, 'GET', '/api/music/state');
  }

  /** POST /api/music/command: the server answers with the state after the command. */
  command(command: MusicCommand): Promise<MusicPlayback> {
    return callJson<MusicPlayback>(this.i18n, 'POST', '/api/music/command', command);
  }

  /** Adds tracks to `known`. Nothing is replaced when every track is already there. */
  remember(tracks: readonly MusicTrack[]): void {
    const fresh = tracks.filter((track) => this.known().get(track.id) !== track);
    if (fresh.length === 0) return;
    const next = new Map(this.known());
    for (const track of fresh) next.set(track.id, track);
    this.known.set(next);
  }

  addSuggestions(tracks: readonly MusicTrack[], reason?: string): void {
    this.remember(tracks);
    const fresh = tracks.slice(0, MAX_SUGGESTIONS).map((track) => ({
      id: `${track.id}:${++this.seq}`,
      track,
      reason: reason?.trim() ? reason.trim() : undefined,
    }));
    if (fresh.length === 0) return;
    this.suggestions.update((current) => [...fresh, ...current].slice(0, MAX_SUGGESTIONS));
  }

  dismiss(id: string): void {
    this.suggestions.update((current) => current.filter((item) => item.id !== id));
  }
}

export type MusicSearchStatus = 'idle' | 'loading' | 'done' | 'error';

/**
 * Debounced, race-safe track search for the library page and the dock popover. Only the newest
 * request may change the results. An empty query shows everything at once. Call dispose() when
 * the page closes.
 */
export class MusicSearch {
  readonly text = signal('');
  readonly tracks = signal<MusicTrack[]>([]);
  readonly enabled = signal<boolean | null>(null);
  readonly status = signal<MusicSearchStatus>('idle');
  readonly error = signal<string | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(private readonly api: Pick<MusicApiService, 'tracks'>) {}

  /** First load: everything, preferred first. */
  start(): void {
    void this.run('');
  }

  /** The user typed: wait for a pause before asking the server. */
  type(raw: string): void {
    this.text.set(raw);
    this.clearTimer();
    const query = raw.trim();
    if (query === '') {
      this.seq++;
      void this.run('');
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(query);
    }, MUSIC_DEBOUNCE_MS);
  }

  /** Asks again for the current text, at once (after an error, for example). */
  retry(): void {
    void this.run(this.text().trim());
  }

  async run(query: string): Promise<void> {
    const id = ++this.seq;
    this.status.set('loading');
    this.error.set(null);
    try {
      const res = await this.api.tracks(query);
      if (id !== this.seq) return;
      this.enabled.set(res.enabled);
      this.tracks.set(res.tracks);
      this.status.set('done');
    } catch (failure) {
      if (id !== this.seq) return;
      this.tracks.set([]);
      this.error.set(failure instanceof Error ? failure.message : null);
      this.status.set('error');
    }
  }

  dispose(): void {
    this.clearTimer();
    this.seq++;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
