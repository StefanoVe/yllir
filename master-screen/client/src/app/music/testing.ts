import { Provider, signal } from '@angular/core';
import { EMPTY, Observable, Subject, filter, map } from 'rxjs';
import { vi } from 'vitest';
import type { MusicCommand, MusicPlayback, MusicTrack } from '@shared/types';
import { LiveService } from '../core/live.service';
import { StatusService } from '../core/status.service';
import { INITIAL_PLAYBACK } from './music-player.service';

/** A track as the server sends it from the tracks endpoint, with optional search fields. */
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

export function soundcloudTrack(id: string, overrides: Partial<MusicTrack> = {}): MusicTrack {
  return {
    id,
    title: `SoundCloud ${id}`,
    url: `https://soundcloud.com/artist/${id}`,
    mood: 'calm',
    provider: 'soundcloud',
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

/** Lets pending promise callbacks and effects run. */
export async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 0));
}

/**
 * A stand-in for the server's music routes and the live bus. It replaces `fetch` (install) and
 * answers GET /api/music/state, POST /api/music/command and GET /api/music/tracks with a simple
 * model of the player. Every command is recorded in `commands`; `emit()` pushes a live event.
 */
export class FakeMusicServer {
  playback: MusicPlayback = { ...INITIAL_PLAYBACK };
  tracks: MusicTrack[] = [];
  commands: MusicCommand[] = [];
  /** When set, the next command (or state read) answers with an error. */
  failNext: 'command' | 'state' | null = null;
  /** The track list returns this for every query (overrides the filter). */
  searchOverride: MusicTrack[] | null = null;
  readonly searches: string[] = [];
  /** When true, the tracks request fails. */
  failSearch = false;
  private readonly bus = new Subject<{ event: string; data: unknown }>();
  readonly modules = signal({ music: true, print: false, encyclopedia: false });

  readonly live = {
    on: <T>(name: string): Observable<T> =>
      this.bus.pipe(
        filter((event) => event.event === name),
        map((event) => event.data as T),
      ),
    resync$: EMPTY,
    connected: signal(true).asReadonly(),
  };

  /** Providers for a component test: the live bus and the module flags, with no real network. */
  providers(): Provider[] {
    return [
      { provide: LiveService, useValue: this.live },
      { provide: StatusService, useValue: { modules: this.modules.asReadonly(), status: signal(null).asReadonly() } },
    ];
  }

  emit(name: 'musicstate', data: MusicPlayback): void;
  emit(name: 'music', data: { tracks: MusicTrack[]; reason?: string }): void;
  emit(name: string, data: unknown): void {
    this.bus.next({ event: name, data });
  }

  /** Replaces the global fetch with this server. Call unstub() in afterEach. */
  install(): void {
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => this.handle(String(input), init));
  }

  unstub(): void {
    vi.unstubAllGlobals();
  }

  private async handle(url: string, init?: RequestInit): Promise<Response> {
    const path = new URL(url, 'http://app.local');
    if (path.pathname === '/api/music/state') {
      if (this.failNext === 'state') {
        this.failNext = null;
        return json({ error: 'The server is down.' }, 503);
      }
      return json(this.playback);
    }
    if (path.pathname === '/api/music/command' && init?.method === 'POST') {
      const command = JSON.parse(String(init.body)) as MusicCommand;
      this.commands.push(command);
      if (this.failNext === 'command') {
        this.failNext = null;
        return json({ error: 'The player did not answer.' }, 500);
      }
      this.apply(command);
      return json(this.playback);
    }
    if (path.pathname === '/api/music/tracks') {
      const q = path.searchParams.get('q') ?? '';
      this.searches.push(q);
      if (this.failSearch) return json({ error: 'down' }, 500);
      const tracks = this.searchOverride ?? this.filter(q);
      return json({ enabled: true, tracks });
    }
    return json({ error: 'not found' }, 404);
  }

  /** A word matches a track when it is in its title, mood or sheet title; an empty query lists all. */
  filter(q: string): MusicTrack[] {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [...this.tracks];
    return this.tracks.filter((track) => {
      const text = `${track.title} ${track.mood} ${track.docTitle}`.toLowerCase();
      return words.some((word) => text.includes(word));
    });
  }

  private apply(command: MusicCommand): void {
    const p = this.playback;
    switch (command.command) {
      case 'play':
        this.playback = { ...p, phase: 'playing', trackId: command.trackId, position: 0 };
        return;
      case 'pause':
        this.playback = { ...p, phase: 'paused' };
        return;
      case 'resume':
        this.playback = { ...p, phase: 'playing' };
        return;
      case 'stop':
        this.playback = { ...p, phase: 'idle', trackId: null, position: 0, duration: 0 };
        return;
      case 'fadeout':
        this.playback = { ...p, phase: 'paused' };
        return;
      case 'seek':
        this.playback = { ...p, position: command.value };
        return;
      case 'volume':
        this.playback = { ...p, volume: command.value };
        return;
      case 'loop':
        this.playback = { ...p, loop: command.value };
        return;
    }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
