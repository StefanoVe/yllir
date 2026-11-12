import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, Subject, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrefsService } from '../core/prefs.service';
import { LiveService } from '../core/live.service';
import { StatusService } from '../core/status.service';
import { I18n } from '../i18n';
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
        { provide: StatusService, useValue: { modules: signal({ music: true, print: false, encyclopedia: false }).asReadonly() } },
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

  it('shows the idle bar when music is on and nothing is loaded or suggested', () => {
    expect(fixture.nativeElement.querySelector('.dock')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.idle')?.textContent).toContain(TestBed.inject(I18n).t('music.dock.idle'));
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

describe('MusicDock idle bar and browse list', () => {
  let fixture: ComponentFixture<MusicDock>;

  function setup(musicOn: boolean): void {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: YOUTUBE_PLAYER, useValue: new FakeYouTubePlayer() },
        { provide: StatusService, useValue: { modules: signal({ music: musicOn, print: false, encyclopedia: false }).asReadonly() } },
        {
          provide: LiveService,
          useValue: { on: () => EMPTY as Observable<unknown>, resync$: EMPTY, connected: signal(true).asReadonly() },
        },
      ],
    });
    TestBed.inject(PrefsService).setCampaign('test-campaign');
    fixture = TestBed.createComponent(MusicDock);
    fixture.detectChanges();
  }

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders nothing when music is off', () => {
    setup(false);
    expect(fixture.nativeElement.querySelector('.dock')).toBeNull();
  });

  it('lists the campaign tracks grouped by sheet, and closes with Escape', async () => {
    setup(true);
    const tracks = [
      youtubeTrack('fog', { title: 'Fog on the water', docTitle: 'Porto', mood: 'calm' }),
      youtubeTrack('market', { title: 'Market noise', docTitle: 'Mercato', mood: 'busy' }),
    ];
    vi.spyOn(TestBed.inject(MusicApiService), 'tracks').mockResolvedValue({ enabled: true, tracks });

    (fixture.nativeElement.querySelector('.browse-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    const titles = Array.from(fixture.nativeElement.querySelectorAll('.group-title') as NodeListOf<HTMLElement>).map((el) => el.textContent?.trim());
    expect(titles).toEqual(['Porto', 'Mercato']);
    expect(fixture.nativeElement.querySelector('.popover')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.popover')).toBeNull();
  });
});
