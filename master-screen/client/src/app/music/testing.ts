import { Observable, Subject } from 'rxjs';
import type { MusicTrack } from '@shared/types';
import type { PlayerEvent, PlayerState, YouTubePlayerApi } from './youtube-player';

/**
 * A fake of the YouTube wrapper for tests. It records every call in `calls` (for example
 * `load:abc`, `play`, `volume:40`, `seek:0`) and lets a test emit player events.
 */
export class FakeYouTubePlayer implements YouTubePlayerApi {
  readonly calls: string[] = [];
  readonly volumes: number[] = [];
  /** When set, load() rejects with it, like a player that cannot be loaded. */
  loadError: Error | null = null;
  private readonly subject = new Subject<PlayerEvent>();
  readonly events: Observable<PlayerEvent> = this.subject.asObservable();

  load(videoId: string): Promise<void> {
    this.calls.push(`load:${videoId}`);
    return this.loadError ? Promise.reject(this.loadError) : Promise.resolve();
  }

  play(): void {
    this.calls.push('play');
  }

  pause(): void {
    this.calls.push('pause');
  }

  setVolume(volume: number): void {
    this.volumes.push(volume);
    this.calls.push(`volume:${volume}`);
  }

  seek(seconds: number): void {
    this.calls.push(`seek:${seconds}`);
  }

  stop(): void {
    this.calls.push('stop');
  }

  /** The last volume the player was set to. */
  lastVolume(): number | undefined {
    return this.volumes[this.volumes.length - 1];
  }

  state(state: PlayerState): void {
    this.subject.next({ type: 'state', state });
  }

  error(kind: 'unavailable' | 'failed'): void {
    this.subject.next({ type: 'error', kind });
  }
}

export function youtubeTrack(id: string, overrides: Partial<MusicTrack> = {}): MusicTrack {
  return {
    id,
    title: `Track ${id}`,
    url: `https://www.youtube.com/watch?v=${id}`,
    mood: 'calm',
    provider: 'youtube',
    videoId: id,
    docPath: 'places/port.md',
    docTitle: 'Port',
    ...overrides,
  };
}

export function externalTrack(id: string, overrides: Partial<MusicTrack> = {}): MusicTrack {
  return {
    id,
    title: `External ${id}`,
    url: `https://example.org/${id}`,
    mood: '',
    provider: 'external',
    docPath: 'places/port.md',
    docTitle: 'Port',
    ...overrides,
  };
}

/** Lets pending promise callbacks run (the wrapper's load() resolves in microtasks). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
