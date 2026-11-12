import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { MusicTrack } from '@shared/types';
import { PrefsService } from '../core/prefs.service';
import type { TranslationKey } from '../i18n';
import { YOUTUBE_PLAYER, type PlayerEvent, clampVolume } from './youtube-player';

export type MusicPlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export const DEFAULT_VOLUME = 70;
export const FADE_OUT_MS = 3000;
export const FADE_IN_MS = 2000;
const RAMP_STEP_MS = 50;

export const PREF_VOLUME = 'music.volume';
export const PREF_LOOP = 'music.loop';
export const PREF_FADE = 'music.fade';

/** The next (dir 1) or previous (dir -1) track that can play in the app. External tracks are skipped. */
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
    if (candidate.provider === 'youtube' && candidate.videoId) return candidate;
  }
  return null;
}

/** Opens an external link in a new tab, without giving the page a handle to the opener. */
export function openExternalTrack(track: MusicTrack): void {
  if (typeof window === 'undefined' || !/^https:\/\//.test(track.url)) return;
  window.open(track.url, '_blank', 'noopener,noreferrer');
}

/**
 * The one music player of the app. It lives for the whole session, so playback survives route
 * changes. Nothing plays unless playTrack() or toggle() is called from a user action. The state
 * shown is only what the player reported, so while the player has not answered it stays 'loading'.
 */
@Injectable({ providedIn: 'root' })
export class MusicPlayerService {
  private readonly player = inject(YOUTUBE_PLAYER);
  private readonly prefs = inject(PrefsService);

  readonly queue = signal<MusicTrack[]>([]);
  readonly current = signal<MusicTrack | null>(null);
  readonly state = signal<MusicPlayerState>('idle');
  /** The volume the user chose (0..100). A fade changes the player's volume, never this value. */
  readonly volume = signal(DEFAULT_VOLUME);
  readonly loop = signal(false);
  /** Preference: fade in on start and fade out with fadeOut(). Default off. */
  readonly fade = signal(false);
  /** Plain-language message key for the current error, or null. */
  readonly error = signal<TranslationKey | null>(null);
  /** 'in' or 'out' while a fade runs. */
  readonly fading = signal<'in' | 'out' | null>(null);

  readonly hasNext = computed(() => neighbourTrack(this.queue(), this.current(), 1) !== null);
  readonly hasPrevious = computed(() => neighbourTrack(this.queue(), this.current(), -1) !== null);

  private token = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.restore();
    // The campaign slug arrives after /api/status: read the saved preferences again then.
    effect(() => {
      this.prefs.slug();
      untracked(() => this.restore());
    });
    this.player.events.pipe(takeUntilDestroyed()).subscribe((event) => this.onPlayerEvent(event));
  }

  /** Starts a track. External tracks never reach the player: they open in a new tab. */
  playTrack(track: MusicTrack, list?: readonly MusicTrack[]): void {
    if (track.provider === 'external') {
      this.openExternal(track);
      return;
    }
    this.cancelRamp();
    const token = ++this.token;
    const inList = list?.some((item) => item.id === track.id) ?? false;
    this.queue.set(inList && list ? [...list] : [track]);
    this.current.set(track);
    this.error.set(null);
    this.state.set('loading');
    void this.start(track, token);
  }

  /** Play/pause for the current track. From idle or error it starts the current track again. */
  toggle(): void {
    const track = this.current();
    if (!track) return;
    switch (this.state()) {
      case 'playing':
      case 'loading':
        this.cancelRamp();
        this.player.pause();
        return;
      case 'paused':
        this.player.play();
        return;
      case 'idle':
      case 'error':
        this.playTrack(track, this.queue());
        return;
    }
  }

  next(): void {
    const target = neighbourTrack(this.queue(), this.current(), 1);
    if (target) this.playTrack(target, this.queue());
  }

  previous(): void {
    const target = neighbourTrack(this.queue(), this.current(), -1);
    if (target) this.playTrack(target, this.queue());
  }

  setVolume(value: number): void {
    const next = clampVolume(value);
    this.volume.set(next);
    this.prefs.set(PREF_VOLUME, String(next));
    if (this.fading() === null) this.player.setVolume(next);
  }

  toggleLoop(): void {
    this.loop.update((on) => !on);
    this.prefs.set(PREF_LOOP, this.loop() ? '1' : '0');
  }

  toggleFade(): void {
    this.fade.update((on) => !on);
    this.prefs.set(PREF_FADE, this.fade() ? '1' : '0');
  }

  /** Volume ramps down to 0, then the player pauses and the stored volume is restored. */
  fadeOut(ms: number = FADE_OUT_MS): void {
    if (this.state() !== 'playing') return;
    this.runRamp(this.volume(), 0, ms, 'out', () => {
      this.player.pause();
      this.player.setVolume(this.volume());
    });
  }

  /** Volume ramps up from 0 to the stored volume. */
  fadeIn(ms: number = FADE_IN_MS): void {
    this.runRamp(0, this.volume(), ms, 'in', () => undefined);
  }

  /** Closes the player: stops playback, clears the queue and the current track. */
  stop(): void {
    this.cancelRamp();
    this.token++;
    this.player.stop();
    this.current.set(null);
    this.queue.set([]);
    this.state.set('idle');
    this.error.set(null);
  }

  /** Opens an external track in a new tab. Used by the library and the suggestion tray. */
  openExternal(track: MusicTrack): void {
    openExternalTrack(track);
  }

  private async start(track: MusicTrack, token: number): Promise<void> {
    if (!track.videoId) {
      this.fail(token, 'music.error.failed');
      return;
    }
    try {
      await this.player.load(track.videoId);
      if (token !== this.token) return;
      const fadeIn = this.fade();
      this.player.setVolume(fadeIn ? 0 : this.volume());
      this.player.play();
      if (fadeIn) this.fadeIn();
    } catch {
      this.fail(token, 'music.error.player');
    }
  }

  private onPlayerEvent(event: PlayerEvent): void {
    if (!this.current()) return;
    if (event.type === 'error') {
      this.cancelRamp(false);
      this.fail(this.token, event.kind === 'unavailable' ? 'music.error.unavailable' : 'music.error.failed');
      return;
    }
    switch (event.state) {
      case 'playing':
        this.error.set(null);
        this.state.set('playing');
        return;
      case 'paused':
        this.state.set('paused');
        return;
      case 'ended':
        this.onEnded();
        return;
      case 'buffering':
      case 'cued':
      case 'unstarted':
        this.state.set('loading');
        return;
    }
  }

  /** With loop on, the same track starts again. Without it, playback stops; nothing moves on by itself. */
  private onEnded(): void {
    if (this.loop()) {
      this.state.set('loading');
      this.player.seek(0);
      this.player.play();
      return;
    }
    this.cancelRamp(false);
    this.state.set('idle');
  }

  private fail(token: number, key: TranslationKey): void {
    if (token !== this.token) return;
    this.error.set(key);
    this.state.set('error');
  }

  private runRamp(from: number, to: number, ms: number, mode: 'in' | 'out', done: () => void): void {
    this.cancelRamp(false);
    const start = Date.now();
    const duration = Math.max(1, ms);
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      this.player.setVolume(Math.round(from + (to - from) * t));
      if (t >= 1) {
        this.stopTimer();
        this.fading.set(null);
        done();
      }
    };
    this.fading.set(mode);
    step();
    if (this.fading() !== null) this.timer = setInterval(step, RAMP_STEP_MS);
  }

  /** Stops a running fade. With `restore`, the player goes back to the stored volume. */
  private cancelRamp(restore = true): void {
    if (this.fading() === null && this.timer === null) return;
    this.stopTimer();
    this.fading.set(null);
    if (restore) this.player.setVolume(this.volume());
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private restore(): void {
    const volume = Number(this.prefs.get(PREF_VOLUME));
    if (this.prefs.get(PREF_VOLUME) !== null && Number.isFinite(volume)) this.volume.set(clampVolume(volume));
    this.loop.set(this.prefs.get(PREF_LOOP) === '1');
    this.fade.set(this.prefs.get(PREF_FADE) === '1');
  }
}
