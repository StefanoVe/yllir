import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChecksResponse, ModuleId, ScreenSettings } from '@shared/types';
import { ApiService } from '../core/api.service';
import { PrefsService } from '../core/prefs.service';
import { DEFAULT_SCREEN_SETTINGS, SettingsService } from '../core/settings.service';
import { StatusService } from '../core/status.service';
import { ThemeService } from '../core/theme.service';
import { Settings, checkSummary } from './settings';

const EMPTY_CHECKS: ChecksResponse = { brokenLinks: [], sketches: [], exclusions: [], checkedAt: '2026-11-13T10:30:00Z' };

function withSettings(change: (s: ScreenSettings) => void): ScreenSettings {
  const copy = structuredClone(DEFAULT_SCREEN_SETTINGS);
  change(copy);
  return copy;
}

describe('Settings page', () => {
  let fixture: ComponentFixture<Settings>;
  let settingsFake: {
    settings: ReturnType<typeof signal<ScreenSettings>>;
    shown: ReturnType<typeof signal<ScreenSettings>>;
    defaults: ReturnType<typeof signal<ScreenSettings>>;
    explicit: ReturnType<typeof signal<string[]>>;
    canSave: ReturnType<typeof signal<boolean>>;
    loaded: ReturnType<typeof signal<boolean>>;
    saveState: ReturnType<typeof signal<'idle' | 'saving' | 'saved' | 'error'>>;
    saveError: ReturnType<typeof signal<string | null>>;
    loadError: ReturnType<typeof signal<string | null>>;
    update: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
  };
  let modules: ReturnType<typeof signal<Record<ModuleId, boolean> | null>>;
  let api: { checks: ReturnType<typeof vi.fn>; runChecks: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    settingsFake = {
      settings: signal(DEFAULT_SCREEN_SETTINGS),
      shown: signal(DEFAULT_SCREEN_SETTINGS),
      defaults: signal(DEFAULT_SCREEN_SETTINGS),
      explicit: signal<string[]>([]),
      canSave: signal(true),
      loaded: signal(true),
      saveState: signal<'idle' | 'saving' | 'saved' | 'error'>('idle'),
      saveError: signal<string | null>(null),
      loadError: signal<string | null>(null),
      update: vi.fn(),
      reset: vi.fn(),
    };
    modules = signal<Record<ModuleId, boolean> | null>({ music: true, print: false, encyclopedia: false });
    api = {
      checks: vi.fn(async () => EMPTY_CHECKS),
      runChecks: vi.fn(async () => EMPTY_CHECKS),
    };
    TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        { provide: SettingsService, useValue: settingsFake },
        { provide: StatusService, useValue: { modules, status: signal(null), campaign: signal({ name: 'Demo' }) } },
        { provide: ApiService, useValue: api },
        { provide: PrefsService, useValue: { slug: signal<string | null>('demo'), get: () => null, set: vi.fn(), remove: vi.fn() } },
        { provide: ThemeService, useValue: { pref: signal('system'), cycle: vi.fn() } },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** Creates the page and waits for the checks to load. */
  async function render(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function q<T extends Element = HTMLElement>(root: HTMLElement, selector: string): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`missing ${selector}`);
    return found;
  }

  it('renders the six sections when music is on, and hides Music when it is off', async () => {
    const root = await render();
    const ids = [...root.querySelectorAll('section.card')].map((el) => el.id);
    expect(ids).toEqual(['s-table', 's-combat', 's-music', 's-appearance', 's-checks', 's-about']);
    expect(root.querySelectorAll('nav.toc a').length).toBe(6);

    modules.set({ music: false, print: false, encyclopedia: false });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('#s-music')).toBeNull();
    expect(root.querySelectorAll('nav.toc a').length).toBe(5);
  });

  it('clicking the autoHide switch saves autoHide false', async () => {
    const root = await render();
    q<HTMLButtonElement>(root, 'button[aria-labelledby="l-autohide"]').click();
    expect(settingsFake.update).toHaveBeenCalledWith({ combat: { autoHide: false } });
  });

  it('the autoHideSeconds slider is disabled while autoHide is off', async () => {
    settingsFake.shown.set(withSettings((s) => void (s.combat.autoHide = false)));
    const root = await render();
    expect(q<HTMLInputElement>(root, 'input[aria-labelledby="l-autohide-seconds"]').disabled).toBe(true);
  });

  it('Reset is disabled for a default section and enabled when the file sets a music value', async () => {
    const root = await render();
    const resetMusic = () => q<HTMLButtonElement>(root, '#s-music button.link-btn');
    expect(resetMusic().disabled).toBe(true);

    settingsFake.explicit.set(['music.volume']);
    fixture.detectChanges();
    expect(resetMusic().disabled).toBe(false);
  });

  it('when saving is not possible, every control is disabled and the reason is shown', async () => {
    settingsFake.canSave.set(false);
    const root = await render();

    expect(root.querySelector('.save-state')?.textContent).toContain("Changes can't be saved");
    const switches = [...root.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
    expect(switches.length).toBeGreaterThan(0);
    expect(switches.every((button) => button.disabled)).toBe(true);
    const ranges = [...root.querySelectorAll<HTMLInputElement>('input[type="range"]')].filter((input) => input.id !== 'settings-text-size');
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.every((input) => input.disabled)).toBe(true);
    const segments = [...root.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].filter(
      (button) => button.closest('[aria-labelledby="l-theme"]') === null,
    );
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((button) => button.disabled)).toBe(true);
  });

  it('theme and text size stay enabled when saving is not possible, because they are browser preferences', async () => {
    settingsFake.canSave.set(false);
    const root = await render();

    const themeButtons = [...root.querySelectorAll<HTMLButtonElement>('[aria-labelledby="l-theme"] button')];
    expect(themeButtons.length).toBe(3);
    expect(themeButtons.some((button) => button.disabled)).toBe(false);
    expect(q<HTMLInputElement>(root, '#settings-text-size').disabled).toBe(false);
  });

  it('a broken link makes the first tile a warning, with the count', async () => {
    api.checks.mockResolvedValue({
      ...EMPTY_CHECKS,
      brokenLinks: [
        { from: 'a.md', to: 'b.md' },
        { from: 'c.md', to: 'd.md' },
      ],
    });
    const root = await render();

    const tiles = root.querySelectorAll('.kpi');
    expect(tiles.length).toBe(3);
    expect(tiles[0].classList.contains('warn')).toBe(true);
    expect(tiles[0].querySelector('.kpi-count')?.textContent?.trim()).toBe('2');
    expect(tiles[1].classList.contains('warn')).toBe(false);
  });

  it('checkSummary returns the three lines, flagging only broken links', () => {
    const t = (key: string, params?: Record<string, string | number>) => (params ? `${key}:${JSON.stringify(params)}` : key);

    const clean = checkSummary(EMPTY_CHECKS, t as never);
    expect(clean.map((line) => line.text)).toEqual(['settings.noBroken', 'settings.noSketches', 'settings.noExclusions']);
    expect(clean.every((line) => !line.broken)).toBe(true);

    const busy = checkSummary(
      { ...EMPTY_CHECKS, brokenLinks: [{ from: 'a', to: 'b' }], sketches: ['x.md', 'y.md'], exclusions: ['z'] },
      t as never,
    );
    expect(busy.map((line) => line.broken)).toEqual([true, false, false]);
    expect(busy[0].text).toBe('settings.brokenFound.one:{"count":1}');
    expect(busy[1].text).toBe('settings.sketchesFound.other:{"count":2}');
    expect(busy[2].text).toBe('settings.exclusionsFound.one:{"count":1}');
  });
});
