import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, type Observable } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleId } from '@shared/types';
import { LiveService } from '../core/live.service';
import { StatusService } from '../core/status.service';
import { YOUTUBE_PLAYER } from '../music/youtube-player';
import { FakeYouTubePlayer } from '../music/testing';
import { Shell } from './shell';

function setup(music: boolean): ComponentFixture<Shell> {
  const modules = signal<Record<ModuleId, boolean>>({ music, print: false, encyclopedia: false });
  const status = {
    campaign: signal({ name: 'Test campaign', slug: 'test', language: 'en' }),
    modules,
  };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: StatusService, useValue: status as unknown as StatusService },
      {
        provide: LiveService,
        useValue: { on: () => EMPTY as Observable<unknown>, resync$: EMPTY, connected: signal(true).asReadonly() },
      },
      { provide: YOUTUBE_PLAYER, useValue: new FakeYouTubePlayer() },
    ],
  });
  const fixture = TestBed.createComponent(Shell);
  fixture.detectChanges();
  return fixture;
}

describe('Shell music entry', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows the music icon in the rail when the module is on', () => {
    const fixture = setup(true);
    const link = fixture.nativeElement.querySelector('a[href="/music"]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute('aria-label')).toBe('Music');
  });

  it('hides the music icon when the module is off', () => {
    const fixture = setup(false);
    expect(fixture.nativeElement.querySelector('a[href="/music"]')).toBeNull();
  });

  it('does not show the dock when nothing is loaded', () => {
    const fixture = setup(true);
    expect(fixture.nativeElement.querySelector('.dock')).toBeNull();
  });
});
