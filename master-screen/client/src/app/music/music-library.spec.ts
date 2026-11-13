import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MusicPlayback } from '@shared/types';
import { MUSIC_DEBOUNCE_MS } from './music-api.service';
import { MusicLibrary } from './music-library';
import { INITIAL_PLAYBACK } from './music-player.service';
import { FakeMusicServer, externalTrack, settle, soundcloudTrack, youtubeTrack } from './testing';

const rain = youtubeTrack('rain', { title: 'Rain on the harbour', mood: 'tense', docTitle: 'Harbour', docPath: 'places/harbour.md' });
const bell = youtubeTrack('bell', { title: 'Far bell', mood: 'sorrow', docTitle: 'Chapel', docPath: 'places/chapel.md' });

describe('MusicLibrary', () => {
  let server: FakeMusicServer;
  let fixture: ComponentFixture<MusicLibrary>;

  beforeEach(() => {
    server = new FakeMusicServer();
    server.tracks = [rain, bell];
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
    fixture = TestBed.createComponent(MusicLibrary);
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  }

  async function wait(): Promise<void> {
    await new Promise((done) => setTimeout(done, MUSIC_DEBOUNCE_MS + 30));
    await settle();
    fixture.detectChanges();
  }

  function el<T extends Element = HTMLElement>(selector: string): T | null {
    return fixture.nativeElement.querySelector(selector) as T | null;
  }

  function all(selector: string): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll(selector) as NodeListOf<HTMLElement>);
  }

  function type(value: string): void {
    const input = el<HTMLInputElement>('input.search')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function key(name: string, target: EventTarget = document.body): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  }

  it('shows the search as the centre of the page, with the scene placeholder and the chips', async () => {
    await render();
    const input = el<HTMLInputElement>('input.search');
    expect(input?.getAttribute('placeholder')).toBe('Describe the scene: tense chase in the forest');
    expect(all('.chip').map((chip) => chip.textContent?.trim())).toHaveLength(12);
    expect(all('.chip')[0].textContent?.trim()).toBe('Tension');
  });

  it('fills the query with a chip word, runs the search, and takes the word out on the second press', async () => {
    await render();
    const forest = all('.chip').find((chip) => chip.textContent?.trim() === 'Forest') as HTMLButtonElement;
    forest.click();
    fixture.detectChanges();
    expect(el<HTMLInputElement>('input.search')?.value).toBe('Forest');
    expect(forest.getAttribute('aria-pressed')).toBe('true');
    await wait();
    expect(server.searches).toContain('Forest');
    all('.chip').find((chip) => chip.textContent?.trim() === 'Tension')?.click();
    fixture.detectChanges();
    expect(el<HTMLInputElement>('input.search')?.value).toBe('Forest Tension');
    forest.click();
    fixture.detectChanges();
    expect(el<HTMLInputElement>('input.search')?.value).toBe('Tension');
    expect(forest.getAttribute('aria-pressed')).toBe('false');
  });

  it('groups the results by sheet with a count when the query is empty', async () => {
    await render();
    expect(all('.group-title a').map((link) => link.textContent?.trim())).toEqual(['Chapel', 'Harbour']);
    expect(all('.group-count').map((count) => count.textContent?.trim())).toEqual(['1 track', '1 track']);
    expect(el('.group-title a')?.getAttribute('href')).toBeTruthy();
  });

  it('shows the snippet of a typed search with its matched words in bold', async () => {
    server.searchOverride = [youtubeTrack('pio', { title: 'Pioggia', snippet: 'Pioggia sottile sul porto.', matches: ['pioggia'] })];
    await render();
    type('pioggia');
    await wait();
    expect(el('.row .snippet')?.textContent).toContain('Pioggia sottile sul porto.');
    expect(el('.row .snippet .hit')?.textContent).toBe('Pioggia');
    expect(el('.count')?.textContent).toContain('Results: 1');
  });

  it('shows the empty library with how to add music', async () => {
    server.tracks = [];
    await render();
    expect(el('.state-line')?.textContent).toContain('No music in this campaign yet');
  });

  it('suggests a general word when nothing matches', async () => {
    await render();
    type('zzzz');
    await wait();
    expect(el('.state-line')?.textContent).toContain('No track matches. Try a general word such as “Tension”.');
  });

  it('shows loading placeholders first, and a retry after a failed search', async () => {
    server.failSearch = true;
    fixture = TestBed.createComponent(MusicLibrary);
    fixture.detectChanges();
    expect(el('.skeleton')).not.toBeNull();
    await settle();
    fixture.detectChanges();
    expect(el('.state[role="alert"]')).not.toBeNull();
    server.failSearch = false;
    (el('.state .retry') as HTMLButtonElement).click();
    await settle();
    fixture.detectChanges();
    expect(el('.row')).not.toBeNull();
  });

  it('shows the unavailable panel with the exact install command and the reason', async () => {
    await render({ ...INITIAL_PLAYBACK, available: false, unavailableReason: 'mpv-missing' });
    expect(el('.unavailable h2')?.textContent).toContain('Playback is not available on this computer');
    expect(el('.unavailable-reason')?.textContent).toContain('mpv is missing');
    expect(el('.code code')?.textContent?.trim()).toBe('brew install mpv yt-dlp deno');
    expect(el('.search')).not.toBeNull();
  });

  it('plays a SoundCloud result in the app, not in a new tab', async () => {
    server.tracks = [soundcloudTrack('sc', { title: 'Cloud song', docTitle: 'Port', docPath: 'places/port.md' })];
    await render();
    expect(el('.row .play')?.getAttribute('aria-label')).toBe('Play Cloud song');
    el<HTMLButtonElement>('.row .play')!.click();
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'play', trackId: 'sc' });
  });

  it('keeps external links as results that open in a new tab', async () => {
    server.tracks = [externalTrack('ext', { title: 'Outside link', docTitle: 'Port', docPath: 'places/port.md' })];
    await render();
    expect(el('.row .play')?.getAttribute('aria-label')).toBe('Open in a new tab');
  });

  it('focuses the search with "/", plays by digit, and pauses with Space while playing', async () => {
    await render();
    key('/');
    expect(document.activeElement).toBe(el('input.search'));
    key('1');
    await settle();
    expect(server.commands.at(-1)?.command).toBe('play');
    server.playback = { ...INITIAL_PLAYBACK, phase: 'playing', trackId: 'rain' };
    server.emit('musicstate', server.playback);
    await settle();
    key(' ');
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'pause' });
  });

  it('plays the selected result with Enter outside the search, and moves the selection with the arrows', async () => {
    await render();
    key('ArrowDown');
    key('Enter');
    await settle();
    expect(server.commands.at(-1)).toEqual({ command: 'play', trackId: rain.id });
  });

  it('clears the search with Escape inside it', async () => {
    await render();
    type('abc');
    await wait();
    const input = el<HTMLInputElement>('input.search')!;
    input.focus();
    key('Escape', input);
    fixture.detectChanges();
    expect(input.value).toBe('');
  });
});
