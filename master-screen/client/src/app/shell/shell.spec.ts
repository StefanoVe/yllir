import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, type Observable } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleId } from '@shared/types';
import { LiveService } from '../core/live.service';
import { StatusService } from '../core/status.service';
import { Shell } from './shell';

function setup(music: boolean): ComponentFixture<Shell> {
  return setupModules({ music, print: false, encyclopedia: false });
}

function setupModules(flags: Record<ModuleId, boolean>): ComponentFixture<Shell> {
  const modules = signal<Record<ModuleId, boolean>>(flags);
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

  it('shows the music bar at the bottom when the module is on, even with nothing playing', () => {
    const fixture = setup(true);
    expect(fixture.nativeElement.querySelector('ms-music-dock .dock')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('ms-music-dock .browse-btn')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('main.has-dock')).not.toBeNull();
  });

  it('shows no music bar when the module is off and nothing is loaded', () => {
    const fixture = setup(false);
    expect(fixture.nativeElement.querySelector('ms-music-dock .dock')).toBeNull();
    expect(fixture.nativeElement.querySelector('main.has-dock')).toBeNull();
  });
});

describe('Shell encyclopedia and print entries', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows the encyclopedia and print icons only when their modules are on', () => {
    const fixture = setupModules({ music: false, print: true, encyclopedia: true });
    const encyclopedia = fixture.nativeElement.querySelector('a[href="/encyclopedia"]') as HTMLAnchorElement | null;
    const print = fixture.nativeElement.querySelector('a[href="/print"]') as HTMLAnchorElement | null;
    expect(encyclopedia?.getAttribute('aria-label')).toBe('Encyclopedia');
    expect(encyclopedia?.getAttribute('title')).toBe('Encyclopedia');
    expect(print?.getAttribute('aria-label')).toBe('Print');
    expect(print?.getAttribute('title')).toBe('Print');
  });

  it('hides each icon when its own module is off', () => {
    const fixture = setupModules({ music: false, print: false, encyclopedia: true });
    expect(fixture.nativeElement.querySelector('a[href="/encyclopedia"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/print"]')).toBeNull();
  });

  it('hides both icons when both modules are off', () => {
    const fixture = setupModules({ music: true, print: false, encyclopedia: false });
    expect(fixture.nativeElement.querySelector('a[href="/encyclopedia"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/print"]')).toBeNull();
  });
});

describe('Shell documents entry', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows the documents icon right after the plot icon, whatever the modules', () => {
    const fixture = setupModules({ music: false, print: false, encyclopedia: false });
    const hrefs = [...fixture.nativeElement.querySelectorAll('nav a.rail-item')].map((a) => (a as HTMLAnchorElement).getAttribute('href'));
    expect(hrefs.indexOf('/docs')).toBe(hrefs.indexOf('/plot') + 1);
    const docs = fixture.nativeElement.querySelector('a[href="/docs"]') as HTMLAnchorElement;
    expect(docs.getAttribute('aria-label')).toBe('Documents');
    expect(docs.getAttribute('title')).toBe('Documents');
  });
});
