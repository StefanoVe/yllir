import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MusicTrack } from '@shared/types';
import { MusicResult } from './music-result';
import { externalTrack, soundcloudTrack, youtubeTrack } from './testing';

describe('MusicResult', () => {
  let fixture: ComponentFixture<MusicResult>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([])] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function render(track: MusicTrack, inputs: Record<string, boolean> = {}): void {
    fixture = TestBed.createComponent(MusicResult);
    fixture.componentRef.setInput('track', track);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }

  function hits(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.snippet .hit') as NodeListOf<HTMLElement>).map((el) => el.textContent ?? '');
  }

  it('renders the snippet with the matched words in bold, accent-insensitively', () => {
    render(youtubeTrack('rain', { snippet: 'Pioggía sottile sul porto, poi la città tace.', matches: ['pioggia', 'porto'] }));
    expect(fixture.nativeElement.querySelector('.snippet')?.textContent).toContain('Pioggía sottile sul porto, poi la città tace.');
    expect(hits()).toEqual(['Pioggía', 'porto']);
  });

  it('writes the snippet as text, never as HTML', () => {
    render(youtubeTrack('x', { snippet: '<img src=x onerror=alert(1)> porto', matches: ['porto'] }));
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('.snippet')?.textContent).toContain('<img src=x');
  });

  it('shows the title, the sheet link and the mood in that order', () => {
    render(youtubeTrack('t', { title: 'Vento', mood: 'malinconico', docTitle: 'Porto', preferred: true }));
    const text = fixture.nativeElement.querySelector('.row')?.textContent ?? '';
    expect(text.indexOf('Vento')).toBeLessThan(text.indexOf('Porto'));
    expect(text.indexOf('Porto')).toBeLessThan(text.indexOf('malinconico'));
    expect(fixture.nativeElement.querySelector('.sheet')?.getAttribute('href')).toContain('places/port.md');
  });

  it('marks the track in the player, and moves the indicator only while it plays', () => {
    render(youtubeTrack('now'), { current: true, busy: true, playing: true });
    expect(fixture.nativeElement.querySelector('.row.current')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.eq.is-moving')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.play.on')).not.toBeNull();
    fixture.componentRef.setInput('playing', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.eq.is-moving')).toBeNull();
  });

  it('shows the match only when the row asks for it', () => {
    render(youtubeTrack('m', { snippet: 'Porto nebbioso', matches: ['porto'] }));
    expect(fixture.nativeElement.querySelector('.snippet')).not.toBeNull();
    fixture.componentRef.setInput('showSnippet', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.snippet')).toBeNull();
  });

  it('labels the button by the action: play, pause, or open for an external link', () => {
    render(youtubeTrack('p', { title: 'Alba' }));
    expect(fixture.nativeElement.querySelector('.play')?.getAttribute('aria-label')).toBe('Play Alba');
    render(youtubeTrack('p', { title: 'Alba' }), { current: true, busy: true });
    expect(fixture.nativeElement.querySelector('.play')?.getAttribute('aria-label')).toBe('Pause Alba');
    render(externalTrack('e'));
    expect(fixture.nativeElement.querySelector('.play')?.getAttribute('aria-label')).toBe('Open in a new tab');
  });

  it('shows a SoundCloud track like any in-app track: play button, no external icon', () => {
    render(soundcloudTrack('sc', { title: 'Cloud song' }));
    expect(fixture.nativeElement.querySelector('.play')?.getAttribute('aria-label')).toBe('Play Cloud song');
    render(soundcloudTrack('sc', { title: 'Cloud song' }), { current: true, busy: true });
    expect(fixture.nativeElement.querySelector('.play')?.getAttribute('aria-label')).toBe('Pause Cloud song');
  });

  it('emits activate with the track when the button is pressed', () => {
    render(youtubeTrack('clicked', { title: 'Click' }));
    const emitted: MusicTrack[] = [];
    fixture.componentInstance.activate.subscribe((track) => emitted.push(track));
    (fixture.nativeElement.querySelector('.play') as HTMLButtonElement).click();
    expect(emitted.map((track) => track.id)).toEqual(['clicked']);
  });
});
