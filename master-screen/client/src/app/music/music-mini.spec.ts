import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicPlayback } from '@shared/types';
import { INITIAL_PLAYBACK, MusicPlayerService } from './music-player.service';
import { MusicMini, MUSIC_MINI_KEY } from './music-mini';
import { FakeMusicServer, settle, youtubeTrack } from './testing';

const PLAYING: MusicPlayback = { ...INITIAL_PLAYBACK, phase: 'playing', trackId: 'fog', position: 30, duration: 200, volume: 60 };

describe('MusicMini', () => {
  let server: FakeMusicServer;
  let fixture: ComponentFixture<MusicMini>;

  beforeEach(() => {
    server = new FakeMusicServer();
    server.tracks = [youtubeTrack('fog', { title: 'Fog on the water', docTitle: 'Port' })];
    server.install();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), ...server.providers()],
    });
    try {
      globalThis.localStorage?.removeItem(MUSIC_MINI_KEY);
    } catch {
      // Storage blocked: nothing to clear.
    }
  });

  afterEach(() => {
    server.unstub();
    TestBed.resetTestingModule();
  });

  async function render(playback?: MusicPlayback): Promise<void> {
    if (playback) server.playback = playback;
    fixture = TestBed.createComponent(MusicMini);
    fixture.detectChanges();
    await update();
  }

  async function update(): Promise<void> {
    await settle();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  }

  function el<T extends Element = HTMLElement>(selector: string): T | null {
    return fixture.nativeElement.querySelector(selector) as T | null;
  }

  it('renders nothing with the music module off', async () => {
    server.modules.set({ music: false, print: false, encyclopedia: false });
    await render(PLAYING);
    expect(el('.round')).toBeNull();
    expect(el('.card')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('is collapsed by default and expands on click, collapse returns to collapsed', async () => {
    await render(PLAYING);
    expect(el('.card')).toBeNull();
    expect(el<HTMLButtonElement>('.round')?.getAttribute('aria-label')).toBe('Music');
    (el('.round') as HTMLButtonElement).click();
    await update();
    expect(el('.card')).not.toBeNull();
    expect(el('.round')).toBeNull();
    (el('[aria-label="Collapse the music player"]') as HTMLButtonElement).click();
    await update();
    expect(el('.card')).toBeNull();
    expect(el('.round')).not.toBeNull();
  });

  it('remembers the expanded state in localStorage', async () => {
    await render(PLAYING);
    (el('.round') as HTMLButtonElement).click();
    await update();
    expect(globalThis.localStorage?.getItem(MUSIC_MINI_KEY)).toBe('1');
  });

  it('calls the service toggle from the play and pause button', async () => {
    await render(PLAYING);
    (el('.round') as HTMLButtonElement).click();
    await update();
    const player = TestBed.inject(MusicPlayerService);
    const toggle = vi.spyOn(player, 'toggle');
    (el('.btn.play') as HTMLButtonElement).click();
    await update();
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('disables next when there is no next track', async () => {
    await render(PLAYING);
    (el('.round') as HTMLButtonElement).click();
    await update();
    expect(TestBed.inject(MusicPlayerService).hasNext()).toBe(false);
    const next = el<HTMLButtonElement>('[aria-label="Next track"]');
    expect(next).not.toBeNull();
    expect(next?.disabled).toBe(true);
  });
});
