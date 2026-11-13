import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { MusicCommand, MusicPlayback, MusicTrack } from '@shared/types';
import { LiveService } from '../core/live.service';
import { MusicApiService } from './music-api.service';

/** What the bar shows: the server's phase, or 'loading' while a play is on its way. */
export type MusicUiState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

/** Before the server has answered: nothing playing, and no reason to show the unavailable panel. */
export const INITIAL_PLAYBACK: MusicPlayback = {
  available: true,
  phase: 'idle',
  trackId: null,
  position: 0,
  duration: 0,
  volume: 80,
  loop: true,
};

/** A track the server plays in the app: YouTube or SoundCloud. External links open in a new tab. */
export function isInAppTrack(track: Pick<MusicTrack, 'provider'>): boolean {
  return track.provider === 'youtube' || track.provider === 'soundcloud';
}

/** The next (dir 1) or previous (dir -1) track of the queue that plays in the app. */
export function neighbourTrack(
  queue: readonly MusicTrack[],
  current: MusicTrack | null,
  dir: 1 | -1,
): MusicTrack | null {
  if (!current) return null;
  const index = queue.findIndex((track) => track.id === current.id);
  if (index < 0) return null;
  for (let i = index + dir; i >= 0 && i < queue.length; i += dir) {
    const candidate = queue[i];
    if (isInAppTrack(candidate)) return candidate;
  }
  return null;
}

/** Opens an external link in a new tab, without giving the page a handle to the opener. */
export function openExternalTrack(track: MusicTrack): void {
  if (typeof window === 'undefined' || !/^https:\/\//.test(track.url)) return;
  window.open(track.url, '_blank', 'noopener,noreferrer');
}

/**
 * Sends one kind of slider value (volume or seek) at a time. A value set while a request is in
 * flight is sent next, so a drag never queues a backlog. `draft` is what the slider shows until the
 * server has answered with nothing newer to send.
 */
class LatestValue {
  readonly draft = signal<number | null>(null);
  private inFlight = false;
  private wanted: number | null = null;

  constructor(private readonly send: (value: number) => Promise<void>) {}

  set(value: number): void {
    this.draft.set(value);
    this.wanted = value;
    if (!this.inFlight) void this.flush();
  }

  private async flush(): Promise<void> {
    this.inFlight = true;
    while (this.wanted !== null) {
      const value = this.wanted;
      this.wanted = null;
      await this.send(value);
    }
    this.inFlight = false;
    this.draft.set(null);
  }
}

/**
 * The music player of the app, as the browser sees it. The sound is played by the server
 * (mpv on the machine that runs the app), so this service holds no audio: it mirrors the server's
 * state (`playback`, from GET /api/music/state and the live `musicstate` event) and sends commands.
 * The UI shows only what the server reported, except for a brief 'loading' after a play request.
 */
@Injectable({ providedIn: 'root' })
export class MusicPlayerService {
  private readonly api = inject(MusicApiService);
  private readonly resolving = new Set<string>();

  /** The server's state, as last reported. */
  readonly playback = signal<MusicPlayback>(INITIAL_PLAYBACK);
  /** True once the server has answered a state read. */
  readonly ready = signal(false);
  /** The tracks of the current queue, in order. Next and previous move through it. */
  readonly queue = signal<MusicTrack[]>([]);
  /** A plain-language failure of the last command, or null. */
  readonly failure = signal<string | null>(null);
  /** The track asked for, before the server confirms it. */
  private readonly pendingId = signal<string | null>(null);

  private readonly volumeLane = new LatestValue((value) => this.send({ command: 'volume', value }));
  private readonly seekLane = new LatestValue((value) => this.send({ command: 'seek', value }));
  /** What the volume slider shows while the user drags it. Null otherwise. */
  readonly volumeDraft = this.volumeLane.draft.asReadonly();
  /** What the seek slider shows while the user drags it. Null otherwise. */
  readonly seekDraft = this.seekLane.draft.asReadonly();

  readonly available = computed(() => this.playback().available);
  /** Why playback is unavailable, or null when it is available. */
  readonly unavailableReason = computed(() => (this.available() ? null : (this.playback().unavailableReason ?? null)));
  readonly trackId = computed(() => this.pendingId() ?? this.playback().trackId);
  /** The track in the player, with its title and sheet when the app knows it. Null when nothing is loaded. */
  readonly current = computed<MusicTrack | null>(() => {
    const id = this.trackId();
    if (!id) return null;
    return this.api.known().get(id) ?? unknownTrack(id);
  });
  readonly state = computed<MusicUiState>(() => (this.pendingId() !== null ? 'loading' : this.playback().phase));
  readonly position = computed(() => this.seekDraft() ?? this.playback().position);
  readonly duration = computed(() => this.playback().duration);
  readonly volume = computed(() => this.volumeDraft() ?? this.playback().volume);
  readonly loop = computed(() => this.playback().loop);
  /** The server's error kind when the phase is 'error', or null. */
  readonly error = computed(() => (this.playback().phase === 'error' ? (this.playback().error ?? 'failed') : null));
  readonly hasNext = computed(() => neighbourTrack(this.queue(), this.current(), 1) !== null);
  readonly hasPrevious = computed(() => neighbourTrack(this.queue(), this.current(), -1) !== null);

  constructor() {
    this.refresh();
    const live = inject(LiveService);
    live
      .on('musicstate')
      .pipe(takeUntilDestroyed())
      .subscribe((next) => this.apply(next));
    live.resync$.pipe(takeUntilDestroyed()).subscribe(() => this.refresh());
    // A track the server plays but the app has not seen (after a reload, say) is looked up once.
    effect(() => {
      const id = this.trackId();
      if (!id || this.api.known().has(id)) return;
      untracked(() => this.resolve(id));
    });
  }

  /** Starts a track on the server. External tracks never reach the server: they open in a new tab. */
  playTrack(track: MusicTrack, list?: readonly MusicTrack[]): void {
    if (track.provider === 'external') {
      openExternalTrack(track);
      return;
    }
    this.api.remember(list ? [track, ...list] : [track]);
    const queue = this.queue();
    this.queue.set(list ? [...list] : queue.some((item) => item.id === track.id) ? queue : [track]);
    this.failure.set(null);
    this.pendingId.set(track.id);
    void this.send({ command: 'play', trackId: track.id });
  }

  /** Play/pause for the current track. From idle or error it starts the current track again. */
  toggle(): void {
    const track = this.current();
    switch (this.state()) {
      case 'playing':
      case 'loading':
        void this.send({ command: 'pause' });
        return;
      case 'paused':
        void this.send({ command: 'resume' });
        return;
      case 'idle':
      case 'error':
        if (track) this.playTrack(track, this.queue());
        return;
    }
  }

  /** Starts the current track again, after an error. */
  retry(): void {
    const track = this.current();
    if (track) this.playTrack(track, this.queue());
    else this.refresh();
  }

  next(): void {
    const target = neighbourTrack(this.queue(), this.current(), 1);
    if (target) this.playTrack(target, this.queue());
  }

  previous(): void {
    const target = neighbourTrack(this.queue(), this.current(), -1);
    if (target) this.playTrack(target, this.queue());
  }

  /** Moves the playhead, clamped to the length when known. Sent as the slider moves; the server decides where it lands. */
  seek(seconds: number): void {
    if (!this.current() || !Number.isFinite(seconds)) return;
    const length = this.duration();
    let target = Math.max(0, seconds);
    if (length > 0) target = Math.min(target, length);
    this.seekLane.set(target);
  }

  setVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    this.volumeLane.set(Math.min(100, Math.max(0, Math.round(value))));
  }

  toggleLoop(): void {
    void this.send({ command: 'loop', value: !this.loop() });
  }

  /** The server ramps the volume down and pauses. */
  fadeOut(): void {
    if (this.state() !== 'playing') return;
    void this.send({ command: 'fadeout' });
  }

  /** Stops the server's player and clears the queue. */
  stop(): void {
    this.queue.set([]);
    void this.send({ command: 'stop' });
  }

  /** GET /api/music/state. Failures are silent: the bar keeps what it has. */
  refresh(): void {
    this.api
      .playback()
      .then((next) => this.apply(next))
      .catch(() => undefined);
  }

  /** Copies a state the server reported. A pending play ends when the server reports that track. */
  private apply(next: MusicPlayback): void {
    this.playback.set(next);
    this.ready.set(true);
    if (this.pendingId() !== null && next.trackId === this.pendingId()) this.pendingId.set(null);
  }

  /** Sends a command and shows the state the server answers with. Never rejects. */
  private async send(command: MusicCommand): Promise<void> {
    try {
      const next = await this.api.command(command);
      this.failure.set(null);
      this.apply(next);
    } catch (failure) {
      this.failure.set(failure instanceof Error ? failure.message : null);
    } finally {
      // The answer ends any pending play: if the server did not start the track, the bar shows that.
      if (command.command === 'play') this.pendingId.set(null);
    }
  }

  /** Looks the track up in the whole list, once per id. */
  private async resolve(id: string): Promise<void> {
    if (this.resolving.has(id)) return;
    this.resolving.add(id);
    try {
      await this.api.tracks('');
    } catch {
      // The bar keeps the placeholder title.
    } finally {
      this.resolving.delete(id);
    }
  }
}

/** Stands in for a track the app has not seen: no title, no sheet. The bar says it plays on the server. */
function unknownTrack(id: string): MusicTrack {
  return { id, title: '', url: '', mood: '', provider: 'youtube', docPath: '', docTitle: '' };
}
