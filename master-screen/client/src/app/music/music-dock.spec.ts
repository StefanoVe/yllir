import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MusicPlayback } from '@shared/types';
import { I18n } from '../i18n';
import { MUSIC_DEBOUNCE_MS, MusicApiService } from './music-api.service';
import { MusicDock } from './music-dock';
import { INITIAL_PLAYBACK } from './music-player.service';
import { FakeMusicServer, settle, youtubeTrack } from './testing';

const PLAYING: MusicPlayback = { ...INITIAL_PLAYBACK, phase: 'playing', trackId: 'fog', position: 30, duration: 200, volume: 60 };

describe('MusicDock', () => {
  let server: FakeMusicServer;
  let fixture: ComponentFixture<MusicDock>;
  const fog = youtubeTrack('fog', { title: 'Fog on the water', docTitle: 'Port' });

  beforeEach(() => {
    server = new FakeMusicServer();
    server.tracks = [fog, youtubeTrack('bell', { title: 'Far bell', mood: 'sorrow' })];
    server.install();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([]), ...server.providers()],
    });
  });

  afterEach(() => {
    server.unstub();
    TestBed.resetTestingModule();
  });

  async function render(playback?: MusicPlayback): Promise<void> {
    if (playback) server.playback = playback;
    fixture = TestBed.createComponent(MusicDock);
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
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

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('shows the idle line with a button to the page when nothing plays', async () => {
    await render();
    expect(el('.dock')).not.toBeNull();
    expect(el('.now .title')?.textContent).toContain('Pick a track');
    expect(el('.browse-btn')).not.toBeNull();
    expect(el<HTMLButtonElement>('.play-btn')?.disabled).toBe(true);
  });

  it('shows the title, the state and the sheet of the track in the player', async () => {
    server.playback = PLAYING;
    await render();
    await update();
    expect(el('.now .title')?.textContent).toContain('Fog on the water');
    expect(el('.now .state')?.textContent).toContain('Playing');
    expect(el('.now .sheet')?.textContent).toContain('Port');
    expect(el('.controls')).not.toBeNull();
  });

  it('says that playback is unavailable, with the reason on the page and no transport', async () => {
    await render({ ...PLAYING, available: false, unavailableReason: 'ytdlp-missing' });
    await update();
    expect(el('.dock')?.classList.contains('is-off')).toBe(true);
    expect(el('.now')?.textContent).toContain('Playback is not available on this computer.');
    expect(el<HTMLButtonElement>('.play-btn')?.disabled).toBe(true);
  });

  it('shows a plain error with a retry that plays the track again', async () => {
    await render({ ...PLAYING, phase: 'error', error: 'failed' });
    await update();
    expect(el('.now [role="alert"]')).not.toBeNull();
    expect(el('.now .meta.is-error')?.textContent).toContain('This track could not be played.');
    (el('.retry') as HTMLButtonElement).click();
    await update();
    expect(server.commands.at(-1)).toEqual({ command: 'play', trackId: 'fog' });
  });

  it('pauses and resumes from the play button, as the server reports', async () => {
    server.playback = PLAYING;
    await render();
    await update();
    (el('.play-btn') as HTMLButtonElement).click();
    await update();
    expect(server.commands.at(-1)).toEqual({ command: 'pause' });
    expect(el('.play-btn')?.getAttribute('aria-label')).toBe('Play');
    (el('.play-btn') as HTMLButtonElement).click();
    await update();
    expect(server.commands.at(-1)).toEqual({ command: 'resume' });
  });

  it('sends loop, fade-out and stop from their buttons', async () => {
    server.playback = PLAYING;
    await render();
    await update();
    (el('[aria-label="Repeat this track"]') as HTMLButtonElement).click();
    await update();
    expect(server.commands.at(-1)).toEqual({ command: 'loop', value: false });
    (el('[aria-label="Fade out and pause"]') as HTMLButtonElement).click();
    await update();
    expect(server.commands.at(-1)).toEqual({ command: 'fadeout' });
    (el('[aria-label="Stop and close the player"]') as HTMLButtonElement).click();
    await update();
    expect(server.commands.at(-1)).toEqual({ command: 'stop' });
  });

  it('sends the seek position from the seek bar and shows elapsed and total time', async () => {
    server.playback = PLAYING;
    await render();
    await update();
    expect(el('.seek-row .clock')?.textContent).toContain('00:30');
    expect(text()).toContain('03:20');
    const seek = el<HTMLInputElement>('.seek input.range');
    expect(seek).not.toBeNull();
    seek!.value = '90';
    seek!.dispatchEvent(new Event('input'));
    await update();
    expect(server.commands.at(-1)).toEqual({ command: 'seek', value: 90 });
  });

  it('sends the volume from the volume slider', async () => {
    server.playback = PLAYING;
    await render();
    await update();
    const volume = el<HTMLInputElement>('.volume-range input');
    expect(volume?.value).toBe('60');
    volume!.value = '25';
    volume!.dispatchEvent(new Event('input'));
    await update();
    expect(server.commands.at(-1)).toEqual({ command: 'volume', value: 25 });
  });

  it('plays a suggestion when its row is pressed, and removes it with its x', async () => {
    await render();
    TestBed.inject(MusicApiService).addSuggestions([youtubeTrack('sug', { title: 'Suggested song' })], 'The port at night');
    await update();
    expect(el('.tray')?.textContent).toContain('The port at night');
    (el('.tray .tray-play') as HTMLButtonElement).click();
    await update();
    expect(server.commands.at(-1)).toEqual({ command: 'play', trackId: 'sug' });
    (el('.dismiss') as HTMLButtonElement).click();
    await update();
    expect(el('.tray')).toBeNull();
  });

  it('opens the Tracks popover, searches, and plays a row from it', async () => {
    await render();
    (el('.browse-btn') as HTMLButtonElement).click();
    await update();
    expect(el('.popover')).not.toBeNull();
    const input = el<HTMLInputElement>('.pop-search')!;
    input.value = 'bell';
    input.dispatchEvent(new Event('input'));
    await new Promise((done) => setTimeout(done, MUSIC_DEBOUNCE_MS + 30));
    await update();
    expect(el('.popover .list')?.textContent).toContain('Far bell');
    (el('.popover .play') as HTMLButtonElement).click();
    await update();
    expect(server.commands.at(-1)).toEqual({ command: 'play', trackId: 'bell' });
  });

  it('shows a plain line in the popover when nothing matches', async () => {
    await render();
    (el('.browse-btn') as HTMLButtonElement).click();
    await update();
    const input = el<HTMLInputElement>('.pop-search')!;
    server.searchOverride = [];
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    await new Promise((done) => setTimeout(done, MUSIC_DEBOUNCE_MS + 30));
    await update();
    expect(el('.popover .pop-note')?.textContent).toContain(TestBed.inject(I18n).t('music.dock.noMatch'));
  });
});
