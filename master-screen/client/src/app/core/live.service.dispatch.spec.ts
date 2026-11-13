import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicPlayback } from '@shared/types';
import { LiveService } from './live.service';

/** A minimal EventSource: records the listeners the service adds so a test can fire them. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (message: MessageEvent) => void>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, listener: (message: MessageEvent) => void): void {
    this.listeners.set(name, listener);
  }
  close(): void {}
}

describe('LiveService event dispatch', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('delivers a musicstate message to the listeners of on("musicstate")', () => {
    const live = TestBed.inject(LiveService);
    const received: MusicPlayback[] = [];
    live.on('musicstate').subscribe((playback) => received.push(playback));

    const source = FakeEventSource.instances[0];
    expect(source.listeners.has('musicstate')).toBe(true);
    const playback: MusicPlayback = {
      available: true,
      phase: 'playing',
      trackId: 'abc',
      position: 4.25,
      duration: 180,
      volume: 70,
      loop: true,
    };
    source.listeners.get('musicstate')?.({ data: JSON.stringify(playback) } as MessageEvent);

    expect(received).toEqual([playback]);
  });

  it('keeps the music suggestions on their own event', () => {
    const live = TestBed.inject(LiveService);
    const received: unknown[] = [];
    live.on('music').subscribe((data) => received.push(data));
    FakeEventSource.instances[0].listeners.get('music')?.({ data: JSON.stringify({ tracks: [] }) } as MessageEvent);
    expect(received).toEqual([{ tracks: [] }]);
  });
});
