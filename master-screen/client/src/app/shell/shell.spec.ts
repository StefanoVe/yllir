import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Route } from '@angular/router';
import { EMPTY, type Observable } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModuleId, ScreenSettings, Turn, TurnStep } from '@shared/types';
import { CampaignTurnService } from '../core/campaign-turn.service';
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
  options: { loaded?: boolean; routes?: Route[]; initialUrl?: string; turn?: WritableSignal<Turn | null> } = {},
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
      { provide: CampaignTurnService, useValue: { turn: (options.turn ?? signal<Turn | null>(null)).asReadonly() } },
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

  it('shows the documents icon right after the plot icon, whatever the modules', () => {
    const fixture = setupModules({ music: false, print: false, encyclopedia: false });
    const hrefs = railHrefs(fixture);
    expect(hrefs.indexOf('/docs')).toBe(hrefs.indexOf('/plot') + 1);
    const docs = fixture.nativeElement.querySelector('a[href="/docs"]') as HTMLAnchorElement;
    expect(docs.getAttribute('aria-label')).toBe('Documents');
    expect(docs.getAttribute('title')).toBe('Documents');
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

  it('hides Plot when rail.plot is off, and keeps the other entries', () => {
    const { fixture } = create(ALL_MODULES, (s) => {
      s.ui.rail.plot = false;
    });
    expect(fixture.nativeElement.querySelector('a[href="/plot"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/docs"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/settings"]')).not.toBeNull();
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

  it('opens the start page once, on the first load, and never redirects Home again', async () => {
    const routes: Route[] = [
      { path: '', children: [] },
      { path: 'plot', children: [] },
      { path: 'live', children: [] },
    ];
    const { fixture, router, loaded } = create(ALL_MODULES, (s) => {
      s.ui.startPage = 'plot';
    }, { loaded: false, routes, initialUrl: '/' });
    await fixture.whenStable();
    expect(router.url).toBe('/');

    loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(router.url).toBe('/plot');

    await router.navigateByUrl('/');
    loaded.set(false);
    loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(router.url).toBe('/');
  });

  it('stays on a deep link when the settings load before the first navigation ends', async () => {
    const routes: Route[] = [{ path: '', children: [] }, { path: 'plot', children: [] }, { path: 'settings', children: [] }];
    const { fixture, router, loaded } = create(ALL_MODULES, (s) => {
      s.ui.startPage = 'plot';
    }, { loaded: false, routes, initialUrl: '/settings' });
    loaded.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(router.url).toBe('/settings');
  });

  it('stays on Home when the start page is Home', async () => {
    const routes: Route[] = [{ path: '', children: [] }, { path: 'plot', children: [] }];
    const { fixture, router } = create(ALL_MODULES, undefined, { routes, initialUrl: '/' });
    await fixture.whenStable();
    expect(router.url).toBe('/');
  });
});

describe('Shell helpers entry', () => {
  const AT = '2026-11-13T10:00:00.000Z';
  const helper = (id: string, text: string): TurnStep => ({ id, kind: 'agent', text, at: AT, state: 'running' });
  const turnWith = (state: Turn['state'], steps: TurnStep[]): Turn => ({ id: 't1', messageId: 'm1', state, activity: '', startedAt: AT, steps });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function railEntry(fixture: ComponentFixture<Shell>): HTMLAnchorElement | null {
    return fixture.nativeElement.querySelector('nav a.rail-item[href="/"][aria-label$="working"]') as HTMLAnchorElement | null;
  }

  async function atRoute(url: string, turn: Turn | null): Promise<ComponentFixture<Shell>> {
    const routes: Route[] = [{ path: '', children: [] }, { path: 'plot', children: [] }];
    const { fixture, router } = create(ALL_MODULES, undefined, { routes, initialUrl: url, turn: signal(turn) });
    await router.navigateByUrl(url);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('shows the compact helpers entry under Home when helpers work off Home', async () => {
    const fixture = await atRoute('/plot', turnWith('running', [helper('a', 'Writing the sheet'), helper('b', 'Checking the map')]));
    const entry = railEntry(fixture);
    expect(entry).not.toBeNull();
    expect(entry?.getAttribute('aria-label')).toBe('2 assistants working');
    expect(entry?.querySelector('.badge')?.textContent?.trim()).toBe('2');
    const home = fixture.nativeElement.querySelector('nav a[href="/"]') as HTMLElement;
    expect(home.nextElementSibling).toBe(entry);
  });

  it('uses the singular label for one helper', async () => {
    const fixture = await atRoute('/plot', turnWith('running', [helper('a', 'Writing the sheet')]));
    expect(railEntry(fixture)?.getAttribute('aria-label')).toBe('1 assistant working');
  });

  it('hides the helpers entry on Home, where the chat shows them', async () => {
    const fixture = await atRoute('/', turnWith('running', [helper('a', 'Writing the sheet')]));
    expect(railEntry(fixture)).toBeNull();
  });

  it('hides the helpers entry when the running turn has no helper', async () => {
    const fixture = await atRoute('/plot', turnWith('running', []));
    expect(railEntry(fixture)).toBeNull();
  });

  it('hides the helpers entry while the turn is only queued', async () => {
    const fixture = await atRoute('/plot', turnWith('queued', [helper('a', 'Waiting')]));
    expect(railEntry(fixture)).toBeNull();
  });
});
