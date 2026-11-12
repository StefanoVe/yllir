import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, Subject, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrefsService } from '../core/prefs.service';
import { LiveService } from '../core/live.service';
import { MusicApiService } from './music-api.service';
import { MusicDock } from './music-dock';
import { YOUTUBE_PLAYER } from './youtube-player';
import { FakeYouTubePlayer, settle, youtubeTrack } from './testing';

describe('MusicDock suggestions', () => {
  let fake: FakeYouTubePlayer;
  let live: Subject<{ tracks: ReturnType<typeof youtubeTrack>[]; reason?: string }>;
  let fixture: ComponentFixture<MusicDock>;

  beforeEach(() => {
    fake = new FakeYouTubePlayer();
    live = new Subject();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: YOUTUBE_PLAYER, useValue: fake },
        {
          provide: LiveService,
          useValue: { on: () => live.asObservable() as Observable<unknown>, resync$: EMPTY, connected: signal(true).asReadonly() },
        },
      ],
    });
    TestBed.inject(PrefsService).setCampaign('test-campaign');
    fixture = TestBed.createComponent(MusicDock);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function chips(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.chip-play'));
  }

  function dismissButtons(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.chip-dismiss'));
  }

  it('shows nothing when nothing is loaded or suggested', () => {
    expect(fixture.nativeElement.querySelector('.dock')).toBeNull();
  });

  it('shows a suggestion with its reason and never plays it by itself', async () => {
    live.next({ tracks: [youtubeTrack('fog', { title: 'Fog on the water' })], reason: 'The port at night' });
    fixture.detectChanges();
    await settle();
    expect(chips()).toHaveLength(1);
    expect(chips()[0].textContent).toContain('Fog on the water');
    expect(chips()[0].textContent).toContain('The port at night');
    expect(fake.calls).toEqual([]);
  });

  it('plays a suggestion when its chip is clicked', async () => {
    live.next({ tracks: [youtubeTrack('fog')], reason: 'calm' });
    fixture.detectChanges();
    chips()[0].click();
    fixture.detectChanges();
    await settle();
    expect(fake.calls).toContain('load:fog');
    expect(fake.calls).toContain('play');
  });

  it('removes a suggestion when its x is clicked, and does not play it', async () => {
    live.next({ tracks: [youtubeTrack('fog')], reason: 'calm' });
    fixture.detectChanges();
    dismissButtons()[0].click();
    fixture.detectChanges();
    await settle();
    expect(chips()).toHaveLength(0);
    expect(TestBed.inject(MusicApiService).suggestions()).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});
