import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Route } from '@angular/router';
import { EMPTY, type Observable } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleId, ScreenSettings } from '@shared/types';
import { LiveService } from '../core/live.service';
import { DEFAULT_SCREEN_SETTINGS, SettingsService } from '../core/settings.service';
import { StatusService } from '../core/status.service';
import { Shell } from './shell';

interface Harness {
  fixture: ComponentFixture<Shell>;
  settings: WritableSignal<ScreenSettings>;
  loaded: WritableSignal<boolean>;
  router: Router;
}

const ALL_MODULES: Record<ModuleId, boolean> = { music: true, print: true, encyclopedia: true } as Record<ModuleId, boolean>;

/** Builds the shell with fake status, live and settings services. Settings start from the defaults, then `tweak` applies. */
function create(
  modules: Record<ModuleId, boolean>,
  tweak?: (settings: ScreenSettings) => void,
  options: { loaded?: boolean; routes?: Route[]; initialUrl?: string } = {},
): Harness {
  const initial = structuredClone(DEFAULT_SCREEN_SETTINGS);
  tweak?.(initial);
  const settings = signal<ScreenSettings>(initial);
  const loaded = signal(options.loaded ?? true);
  const status = {
    campaign: signal({ name: 'Test campaign', slug: 'test', language: 'en' }),
    modules: signal<Record<ModuleId, boolean>>(modules),
  };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter(options.routes ?? []),
      { provide: StatusService, useValue: status as unknown as StatusService },
      {
        provide: LiveService,
        useValue: { on: () => EMPTY as Observable<unknown>, resync$: EMPTY, connected: signal(true).asReadonly() },
      },
      { provide: SettingsService, useValue: { settings, loaded } as unknown as SettingsService },
    ],
  });
  const fixture = TestBed.createComponent(Shell);
  fixture.detectChanges();
  const router = TestBed.inject(Router);
  // The initial navigation is started by hand (TestBed does not do it); it ends asynchronously.
  if (options.initialUrl !== undefined) void router.navigateByUrl(options.initialUrl);
  return { fixture, settings, loaded, router };
}

function setup(music: boolean): ComponentFixture<Shell> {
  return setupModules({ music, print: false, encyclopedia: false });
}

function setupModules(flags: Record<ModuleId, boolean>): ComponentFixture<Shell> {
  return create(flags).fixture;
}

function railHrefs(fixture: ComponentFixture<Shell>): (string | null)[] {
  return [...fixture.nativeElement.querySelectorAll('nav .rail-item')].map((item) =>
    (item as HTMLElement).tagName === 'A' ? (item as HTMLAnchorElement).getAttribute('href') : (item as HTMLElement).getAttribute('aria-label'),
  );
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

  it('hides the music icon when rail.music is off, and keeps the dock when dock is always', () => {
    const { fixture } = create({ music: true, print: false, encyclopedia: false }, (s) => {
      s.ui.rail.music = false;
    });
    expect(fixture.nativeElement.querySelector('a[href="/music"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('main.has-dock')).not.toBeNull();
  });

  it('hides the dock when dock is playing and nothing is playing', () => {
    const { fixture } = create({ music: true, print: false, encyclopedia: false }, (s) => {
      s.music.dock = 'playing';
    });
    expect(fixture.nativeElement.querySelector('ms-music-dock')).toBeNull();
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
    expect(encyclopedia?.hasAttribute('title')).toBe(false);
    expect(print?.getAttribute('aria-label')).toBe('Print');
    expect(print?.hasAttribute('title')).toBe(false);
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

  it('hides the encyclopedia icon when rail.encyclopedia is off even if the module is on', () => {
    const { fixture } = create(ALL_MODULES, (s) => {
      s.ui.rail.encyclopedia = false;
    });
    expect(fixture.nativeElement.querySelector('a[href="/encyclopedia"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/print"]')).not.toBeNull();
  });
});

describe('Shell documents entry', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows the documents icon right after the live table icon, whatever the modules', () => {
    const fixture = setupModules({ music: false, print: false, encyclopedia: false });
    const hrefs = railHrefs(fixture);
    expect(hrefs.indexOf('/docs')).toBe(hrefs.indexOf('/live') + 1);
    const docs = fixture.nativeElement.querySelector('a[href="/docs"]') as HTMLAnchorElement;
    expect(docs.getAttribute('aria-label')).toBe('Documents');
    expect(docs.hasAttribute('title')).toBe(false);
  });
});

describe('Shell rail order and hidden entries', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('puts Settings last in the rail, after Preview and Theme', () => {
    const fixture = create(ALL_MODULES).fixture;
    const items = [...fixture.nativeElement.querySelectorAll('nav .rail-item')] as HTMLElement[];
    expect(items[items.length - 1].getAttribute('href')).toBe('/settings');
    expect(items[items.length - 2].getAttribute('aria-label')).toMatch(/^Theme/);
  });

  it('marks Search and Preview as group starts, and Preview as the bottom group', () => {
    const fixture = create(ALL_MODULES).fixture;
    const search = fixture.nativeElement.querySelector('nav .rail-item[aria-label="Search"]') as HTMLElement;
    const preview = fixture.nativeElement.querySelector('nav .rail-item.rail-bottom') as HTMLElement;
    expect(search.classList.contains('rail-sep')).toBe(true);
    expect(preview.classList.contains('rail-sep')).toBe(true);
    expect(preview.getAttribute('aria-pressed')).not.toBeNull();
  });

  it('always shows Plot as the first rail entry, even when rail.plot is off', () => {
    const { fixture } = create(ALL_MODULES, (s) => {
      s.ui.rail.plot = false;
    });
    const hrefs = railHrefs(fixture);
    expect(hrefs[0]).toBe('/plot');
    expect(fixture.nativeElement.querySelector('a[href="/docs"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/settings"]')).not.toBeNull();
  });

  it('has no Home entry and no Home chat link in the rail', () => {
    const fixture = create(ALL_MODULES).fixture;
    expect(fixture.nativeElement.querySelector('nav a[href="/"]')).toBeNull();
    expect(railHrefs(fixture)).not.toContain('/');
  });

  it('hides Documents when rail.docs is off', () => {
    const { fixture } = create(ALL_MODULES, (s) => {
      s.ui.rail.docs = false;
    });
    expect(fixture.nativeElement.querySelector('a[href="/docs"]')).toBeNull();
  });
});

describe('Shell density, motion and start page', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    delete document.documentElement.dataset['density'];
    delete document.documentElement.dataset['motion'];
  });

  it('sets data-density and data-motion on documentElement from the settings', () => {
    create(ALL_MODULES, (s) => {
      s.ui.density = 'compact';
      s.ui.motion = 'reduced';
    });
    expect(document.documentElement.dataset['density']).toBe('compact');
    expect(document.documentElement.dataset['motion']).toBe('reduced');
  });

  it('sends the app root to the plot, so the master never lands on Home', async () => {
    const routes: Route[] = [{ path: '', pathMatch: 'full', redirectTo: 'plot' }, { path: 'plot', children: [] }];
    const { fixture, router } = create(ALL_MODULES, undefined, { routes, initialUrl: '/' });
    await fixture.whenStable();
    expect(router.url).toBe('/plot');
  });
});
