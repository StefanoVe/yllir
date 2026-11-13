import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChecksResponse, ModuleId, ScreenSettings } from '@shared/types';
import { ApiService } from '../core/api.service';
import { PrefsService } from '../core/prefs.service';
import { DEFAULT_SCREEN_SETTINGS, SettingsService } from '../core/settings.service';
import { StatusService } from '../core/status.service';
import { ThemeService } from '../core/theme.service';
import type { UpdateStatus } from '@shared/types';
import { UpdateService } from '../core/update';
import { Settings, checkSummary, parseNews } from './settings';

const EMPTY_CHECKS: ChecksResponse = { brokenLinks: [], sketches: [], exclusions: [], checkedAt: '2026-11-13T10:30:00Z' };
const UPDATE_IDLE: UpdateStatus = { state: 'idle', news: null, snoozed: false, canApply: true, blockedReason: null };
const UPDATE_AVAILABLE: UpdateStatus = {
  state: 'available',
  news: 'Better search.\nThe search finds more.\n\n- New cards\n- Fixed the map',
  snoozed: false,
  canApply: true,
  blockedReason: null,
};

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
  let updateFake: {
    status: ReturnType<typeof signal<UpdateStatus | null>>;
    checking: ReturnType<typeof signal<boolean>>;
    actionError: ReturnType<typeof signal<string | null>>;
    reopenNotice: ReturnType<typeof signal<boolean>>;
    check: ReturnType<typeof vi.fn>;
    apply: ReturnType<typeof vi.fn>;
    snooze: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
  };

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
    updateFake = {
      status: signal<UpdateStatus | null>(UPDATE_IDLE),
      checking: signal(false),
      actionError: signal<string | null>(null),
      reopenNotice: signal(false),
      check: vi.fn(),
      apply: vi.fn(),
      snooze: vi.fn(),
      retry: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        { provide: SettingsService, useValue: settingsFake },
        { provide: UpdateService, useValue: updateFake },
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

  it('renders the seven sections when music is on, and hides Music when it is off', async () => {
    const root = await render();
    const ids = [...root.querySelectorAll('section.card')].map((el) => el.id);
    expect(ids).toEqual(['s-table', 's-combat', 's-music', 's-appearance', 's-update', 's-checks', 's-about']);
    expect(root.querySelectorAll('nav.toc a').length).toBe(7);

    modules.set({ music: false, print: false, encyclopedia: false });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('#s-music')).toBeNull();
    expect(root.querySelectorAll('nav.toc a').length).toBe(6);
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
  describe('Update section', () => {
    const section = (root: HTMLElement) => q(root, '#s-update');
    const buttons = (root: HTMLElement) => [...section(root).querySelectorAll<HTMLButtonElement>('button')];

    it('says everything is up to date, with a check button', async () => {
      const root = await render();
      expect(section(root).textContent).toContain('Everything is up to date');
      expect(buttons(root).some((button) => button.textContent?.includes('Update now'))).toBe(false);
      q<HTMLButtonElement>(root, '#s-update button.icon-btn').click();
      expect(updateFake.check).toHaveBeenCalledTimes(1);
    });

    it('shows the news as paragraphs and a list, with Update now and Later', async () => {
      updateFake.status.set(UPDATE_AVAILABLE);
      const root = await render();
      const text = section(root).textContent ?? '';
      expect(text).toContain('An update for Yllir is ready.');
      expect(section(root).querySelector('.update-news p')?.textContent).toBe('Better search. The search finds more.');
      expect([...section(root).querySelectorAll('.update-news li')].map((li) => li.textContent)).toEqual(['New cards', 'Fixed the map']);
      expect(text).not.toMatch(/version|plugin|server|package|\d+\.\d+/i);

      const now = buttons(root).find((button) => button.textContent?.includes('Update now'));
      now?.click();
      expect(updateFake.apply).toHaveBeenCalledTimes(1);
      buttons(root).find((button) => button.textContent?.includes('Later'))?.click();
      expect(updateFake.snooze).toHaveBeenCalledTimes(1);
    });

    it('disables Update now with the reason when the update cannot start yet', async () => {
      updateFake.status.set({ ...UPDATE_AVAILABLE, canApply: false, blockedReason: 'turn-running' });
      const root = await render();
      const now = buttons(root).find((button) => button.textContent?.includes('Update now'));
      expect(now?.disabled).toBe(true);
      expect(section(root).textContent).toContain('The assistant is still working: wait for it to finish');
    });

    it('shows the live table reason when a live table is open', async () => {
      updateFake.status.set({ ...UPDATE_AVAILABLE, canApply: false, blockedReason: 'live-open' });
      const root = await render();
      expect(section(root).textContent).toContain('A live table is open: close it first');
    });

    it('shows the running update in plain words, with no buttons to press', async () => {
      updateFake.status.set({ ...UPDATE_AVAILABLE, state: 'updating' });
      const root = await render();
      expect(section(root).textContent).toContain('Updating, it takes a few seconds');
      expect(buttons(root).every((button) => button.textContent?.includes('Update now') === false)).toBe(true);
    });

    it('shows the reopen notice while restarting only when the updates service raises it', async () => {
      updateFake.status.set({ ...UPDATE_AVAILABLE, state: 'restarting' });
      const root = await render();
      expect(section(root).textContent).toContain('Almost done, reopening');
      expect(section(root).textContent).not.toContain('close this window');

      updateFake.reopenNotice.set(true);
      fixture.detectChanges();
      expect(section(root).textContent).toContain('close this window and open Yllir again');
    });

    it('a failed update says nothing has changed, and retry applies again', async () => {
      updateFake.status.set({ ...UPDATE_AVAILABLE, state: 'failed' });
      const root = await render();
      expect(section(root).textContent).toContain('The update did not work. Nothing has changed.');
      buttons(root).find((button) => button.textContent?.includes('Try again'))?.click();
      expect(updateFake.retry).toHaveBeenCalledTimes(1);
      expect(updateFake.apply).not.toHaveBeenCalled();
    });

    it('offline says Yllir keeps working as it is', async () => {
      updateFake.status.set({ ...UPDATE_IDLE, state: 'offline' });
      const root = await render();
      expect(section(root).textContent).toContain('No connection. Yllir keeps working as it is.');
    });

    it('shows the refusal sentence of a 409 as an alert', async () => {
      updateFake.status.set({ ...UPDATE_AVAILABLE, canApply: false, blockedReason: 'live-open' });
      updateFake.actionError.set('A live table is open: close it first');
      const root = await render();
      expect(section(root).querySelector('[role="alert"]')?.textContent).toContain('A live table is open: close it first');
    });
  });

  it('parseNews keeps paragraphs and list items apart, and joins wrapped lines', () => {
    expect(parseNews('One line\nstill one.\n\nSecond paragraph.\n- first\n- second\n\n- again')).toEqual([
      { list: false, lines: ['One line still one.'] },
      { list: false, lines: ['Second paragraph.'] },
      { list: true, lines: ['first', 'second'] },
      { list: true, lines: ['again'] },
    ]);
    expect(parseNews('  ')).toEqual([]);
  });
});
