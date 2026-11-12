import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/** Where the IFrame API is loaded from. It is requested once, and only when a YouTube track is first played. */
export const YOUTUBE_IFRAME_API_URL = 'https://www.youtube.com/iframe_api';
/** Privacy-enhanced host: no cookies are set for the viewer. */
export const YOUTUBE_HOST = 'https://www.youtube-nocookie.com';
export const YOUTUBE_CONTAINER_ID = 'yllir-music-player';

/** Player states the app cares about, mapped from the YouTube state numbers. */
export type PlayerState = 'unstarted' | 'cued' | 'buffering' | 'playing' | 'paused' | 'ended';
/** `unavailable`: removed, private or not allowed to play here (codes 100, 101, 150). `failed`: anything else. */
export type PlayerErrorKind = 'unavailable' | 'failed';

export type PlayerEvent =
  | { type: 'state'; state: PlayerState }
  | { type: 'error'; kind: PlayerErrorKind; code?: number };

/** The small surface the music player needs. Tests replace it with a fake through YOUTUBE_PLAYER. */
export interface YouTubePlayerApi {
  readonly events: Observable<PlayerEvent>;
  /** Resolves once the player exists and is ready for the video. Rejects when the API cannot be loaded. */
  load(videoId: string): Promise<void>;
  play(): void;
  pause(): void;
  /** 0..100. */
  setVolume(volume: number): void;
  seek(seconds: number): void;
  stop(): void;
}

export const YOUTUBE_PLAYER = new InjectionToken<YouTubePlayerApi>('YOUTUBE_PLAYER', {
  providedIn: 'root',
  factory: () => new IframeYouTubePlayer(inject(DOCUMENT), () => window),
});

/** Maps a YouTube error code to the kind shown to the master. */
export function youTubeErrorKind(code: number): PlayerErrorKind {
  return code === 100 || code === 101 || code === 150 ? 'unavailable' : 'failed';
}

/** Maps a YouTube state number to the app's state union, or null for a number the app ignores. */
export function youTubeState(code: number): PlayerState | null {
  switch (code) {
    case -1:
      return 'unstarted';
    case 0:
      return 'ended';
    case 1:
      return 'playing';
    case 2:
      return 'paused';
    case 3:
      return 'buffering';
    case 5:
      return 'cued';
    default:
      return null;
  }
}

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(100, Math.max(0, Math.round(volume)));
}

// Minimal typings for the parts of the YouTube IFrame API used here.
interface YTPlayerInstance {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(volume: number): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  loadVideoById(videoId: string): void;
}
interface YTPlayerEvent {
  data: number;
  target: YTPlayerInstance;
}
interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      videoId: string;
      host: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: () => void;
        onStateChange: (event: YTPlayerEvent) => void;
        onError: (event: YTPlayerEvent) => void;
      };
    },
  ) => YTPlayerInstance;
}
type YouTubeWindow = Window & {
  YT?: YTNamespace;
  onYouTubeIframeAPIReady?: () => void;
};

/**
 * The real wrapper. Creates one hidden player inside a container in document.body, outside
 * Angular's views, so it survives route changes. Loading the API and creating the player both
 * happen on the first load() call only. Looping is handled by the music player service (on
 * ENDED it seeks to 0 and plays again), not by the API's loop parameter.
 */
export class IframeYouTubePlayer implements YouTubePlayerApi {
  private readonly subject = new Subject<PlayerEvent>();
  readonly events = this.subject.asObservable();

  private apiReady: Promise<YTNamespace> | null = null;
  private player: YTPlayerInstance | null = null;
  private pendingReady: { resolve: () => void } | null = null;
  private volume = 100;

  constructor(
    private readonly doc: Document,
    private readonly win: () => Window,
  ) {}

  async load(videoId: string): Promise<void> {
    const yt = await this.loadApi();
    if (this.player) {
      this.player.loadVideoById(videoId);
      return;
    }
    await this.create(yt, videoId);
  }

  play(): void {
    this.player?.playVideo();
  }

  pause(): void {
    this.player?.pauseVideo();
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    this.player?.setVolume(this.volume);
  }

  seek(seconds: number): void {
    this.player?.seekTo(Math.max(0, seconds), true);
  }

  stop(): void {
    this.player?.stopVideo();
  }

  private loadApi(): Promise<YTNamespace> {
    const win = this.win() as YouTubeWindow;
    if (win.YT?.Player) return Promise.resolve(win.YT);
    if (!this.apiReady) {
      this.apiReady = new Promise<YTNamespace>((resolve, reject) => {
        const previous = win.onYouTubeIframeAPIReady;
        win.onYouTubeIframeAPIReady = () => {
          previous?.();
          if (win.YT?.Player) resolve(win.YT);
        };
        const script = this.doc.createElement('script');
        script.src = YOUTUBE_IFRAME_API_URL;
        script.async = true;
        script.onerror = () => {
          this.apiReady = null;
          reject(new Error('The YouTube player script could not be loaded.'));
        };
        this.doc.head.appendChild(script);
      });
    }
    return this.apiReady;
  }

  private container(): HTMLElement {
    const existing = this.doc.getElementById(YOUTUBE_CONTAINER_ID);
    if (existing) return existing;
    const container = this.doc.createElement('div');
    container.id = YOUTUBE_CONTAINER_ID;
    container.setAttribute('aria-hidden', 'true');
    Object.assign(container.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      opacity: '0',
      pointerEvents: 'none',
    });
    this.doc.body.appendChild(container);
    return container;
  }

  private create(yt: YTNamespace, videoId: string): Promise<void> {
    const target = this.doc.createElement('div');
    this.container().appendChild(target);
    const origin = this.win().location.origin;
    return new Promise<void>((resolve) => {
      this.pendingReady = { resolve };
      this.player = new yt.Player(target, {
        width: '1',
        height: '1',
        videoId,
        host: YOUTUBE_HOST,
        playerVars: {
          enablejsapi: 1,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          playsinline: 1,
          origin,
        },
        events: {
          onReady: () => {
            this.player?.setVolume(this.volume);
            const pending = this.pendingReady;
            this.pendingReady = null;
            pending?.resolve();
          },
          onStateChange: (event) => {
            const state = youTubeState(event.data);
            if (state) this.subject.next({ type: 'state', state });
          },
          onError: (event) => {
            this.subject.next({
              type: 'error',
              kind: youTubeErrorKind(event.data),
              code: event.data,
            });
          },
        },
      });
    });
  }
}
