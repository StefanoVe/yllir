import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChecksResponse, ModuleId, ScreenSettings } from '@shared/types';
import { ApiService } from '../core/api.service';
import { PrefsService } from '../core/prefs.service';
import { DEFAULT_SCREEN_SETTINGS, SettingsService } from '../core/settings.service';
import { StatusService } from '../core/status.service';
import { ThemeService } from '../core/theme.service';
import type { OpenSession, UpdateStatus } from '@shared/types';
import { UpdateService } from '../core/update';
import { Settings, SETTINGS_COLLAPSED_KEY, checkSummary, parseNews, sectionMatches } from './settings';

const EMPTY_CHECKS: ChecksResponse = { brokenLinks: [], sketches: [], exclusions: [], checkedAt: '2026-11-13T10:30:00Z' };
const SESSIONS: OpenSession[] = [{ kind: 'live', id: 'l1', title: 'Tavolo del martedì' }, { kind: 'chat', id: 'c1', title: 'Chat' }];
const UPDATE_IDLE: UpdateStatus = { state: 'idle', version: null, news: null, snoozed: false, canApply: true, blockedReason: null, sessions: [] };
const UPDATE_AVAILABLE: UpdateStatus = {
  state: 'available',
  version: '0.68.0',
  news: 'Better search.\nThe search finds more.\n\n- New cards\n- Fixed the map',
  snoozed: false,
  canApply: true,
  blockedReason: null,
  sessions: [],
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
  let api: { checks: ReturnType<typeof vi.fn>; runChecks: ReturnType<typeof vi.fn>; shutdown: ReturnType<typeof vi.fn> };
  let updateFake: {
    status: ReturnType<typeof signal<UpdateStatus | null>>;
    checking: ReturnType<typeof signal<boolean>>;
    actionError: ReturnType<typeof signal<string | null>>;
    reopenNotice: ReturnType<typeof signal<boolean>>;
    confirming: ReturnType<typeof signal<boolean>>;
    check: ReturnType<typeof vi.fn>;
    requestApply: ReturnType<typeof vi.fn>;
    apply: ReturnType<typeof vi.fn>;
    cancelApply: ReturnType<typeof vi.fn>;
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
    modules = signal<Record<ModuleId, boolean> | null>({ music: true, encyclopedia: false });
    api = {
      checks: vi.fn(async () => EMPTY_CHECKS),
      runChecks: vi.fn(async () => EMPTY_CHECKS),
      shutdown: vi.fn(async () => ({ ok: true as const })),
    };
    updateFake = {
      status: signal<UpdateStatus | null>(UPDATE_IDLE),
      checking: signal(false),
      actionError: signal<string | null>(null),
      reopenNotice: signal(false),
      confirming: signal(false),
      check: vi.fn(),
      requestApply: vi.fn(),
      apply: vi.fn(),
      cancelApply: vi.fn(),
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
        provideRouter([{ path: '**', children: [] }]),
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.removeItem(SETTINGS_COLLAPSED_KEY);
    document.querySelectorAll('dialog').forEach((dialog) => dialog.remove());
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

    modules.set({ music: false, encyclopedia: false });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('#s-music')).toBeNull();
    expect(root.querySelectorAll('nav.toc a').length).toBe(6);
  });

  it('the stop button asks for a second click, and only the second one calls shutdown', async () => {
    const root = await render();
    const button = () => q<HTMLButtonElement>(root, '.quit-btn');

    button().click();
    fixture.detectChanges();
    expect(api.shutdown).not.toHaveBeenCalled();
    expect(button().textContent).toContain('Click again to stop');

    button().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.shutdown).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.quit [role="status"]')?.textContent).toContain('Master screen stopped');
    expect(button().disabled).toBe(true);
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
      expect(buttons(root).some((button) => button.textContent?.trim() === 'Update')).toBe(false);
      q<HTMLButtonElement>(root, '#s-update button.icon-btn').click();
      expect(updateFake.check).toHaveBeenCalledTimes(1);
    });

    it('shows the news as paragraphs and a list, with Update and Later', async () => {
      updateFake.status.set(UPDATE_AVAILABLE);
      const root = await render();
      const text = section(root).textContent ?? '';
      expect(text).toContain('An update for Yllir is ready.');
      expect(section(root).querySelector('.update-news p')?.textContent).toBe('Better search. The search finds more.');
      expect([...section(root).querySelectorAll('.update-news li')].map((li) => li.textContent)).toEqual(['New cards', 'Fixed the map']);
      expect(text).not.toMatch(/version|plugin|server|package|\d+\.\d+/i);

      buttons(root).find((button) => button.textContent?.trim() === 'Update')?.click();
      expect(updateFake.requestApply).toHaveBeenCalledTimes(1);
      buttons(root).find((button) => button.textContent?.includes('Later'))?.click();
      expect(updateFake.snooze).toHaveBeenCalledTimes(1);
    });

    it('with open sessions, Update shows the list first and sends nothing until it is confirmed', async () => {
      updateFake.status.set({ ...UPDATE_AVAILABLE, sessions: SESSIONS });
      const root = await render();
      // The page only asks the service; the service decides whether a confirmation comes first.
      buttons(root).find((button) => button.textContent?.trim() === 'Update')?.click();
      expect(updateFake.requestApply).toHaveBeenCalledTimes(1);
      expect(updateFake.apply).not.toHaveBeenCalled();

      updateFake.confirming.set(true);
      fixture.detectChanges();
      expect(section(root).textContent).toContain('The update will close these sessions:');
      expect([...section(root).querySelectorAll('.update-sessions li')].map((li) => li.textContent)).toEqual(['Tavolo del martedì', 'Chat']);
      expect(buttons(root).some((button) => button.textContent?.trim() === 'Update')).toBe(false);
      expect(updateFake.apply).not.toHaveBeenCalled();

      buttons(root).find((button) => button.textContent?.includes('Close the sessions and update'))?.click();
      expect(updateFake.apply).toHaveBeenCalledWith(true);
    });

    it('cancelling the session confirmation goes back to the offer and sends nothing', async () => {
      updateFake.status.set({ ...UPDATE_AVAILABLE, sessions: SESSIONS });
      updateFake.confirming.set(true);
      const root = await render();
      buttons(root).find((button) => button.textContent?.trim() === 'Cancel')?.click();
      expect(updateFake.cancelApply).toHaveBeenCalledTimes(1);
      expect(updateFake.apply).not.toHaveBeenCalled();
    });

    it('shows the running update in plain words, with no buttons to press', async () => {
      updateFake.status.set({ ...UPDATE_AVAILABLE, state: 'updating' });
      const root = await render();
      expect(section(root).textContent).toContain('Updating, it takes a few seconds');
      expect(buttons(root).every((button) => button.textContent?.trim() !== 'Update')).toBe(true);
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
      updateFake.status.set(UPDATE_AVAILABLE);
      updateFake.actionError.set('The update is not possible now');
      const root = await render();
      expect(section(root).querySelector('[role="alert"]')?.textContent).toContain('The update is not possible now');
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

  describe('search, folding and deep link', () => {
    const sectionOf = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    const bodyOf = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`#b-${id.replace('s-', '')}`)!;
    const chevronOf = (root: HTMLElement, id: string) => root.querySelector<HTMLButtonElement>(`#${id} .chevron`)!;
    const tocLinks = (root: HTMLElement) => [...root.querySelectorAll<HTMLAnchorElement>('nav.toc a')];
    const searchInput = (root: HTMLElement) => q<HTMLInputElement>(root, 'input.field');

    /** Types into the search field, the way the browser does, and lets the page update. */
    function typeSearch(root: HTMLElement, text: string): HTMLInputElement {
      const input = searchInput(root);
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      return input;
    }

    function visibleSections(root: HTMLElement): string[] {
      return [...root.querySelectorAll<HTMLElement>('section.card')].filter((el) => !el.hidden).map((el) => el.id);
    }

    beforeEach(() => {
      localStorage.removeItem(SETTINGS_COLLAPSED_KEY);
    });

    it('sectionMatches ignores case, accents, line breaks and empty filters', () => {
      expect(sectionMatches('Anything at all', '')).toBe(true);
      expect(sectionMatches('Anything at all', '   ')).toBe(true);
      expect(sectionMatches('Perché sì', 'PERCHE')).toBe(true);
      expect(sectionMatches('Live\n      table   model', 'live table')).toBe(true);
      expect(sectionMatches('Combat model', 'panels')).toBe(false);
      expect(sectionMatches('', 'x')).toBe(false);
    });

    it('a search shows only the sections whose text matches, and the table of contents lists only those', async () => {
      const root = await render();
      expect(visibleSections(root).length).toBe(7);

      typeSearch(root, 'hide panels');
      expect(visibleSections(root)).toEqual(['s-combat']);
      expect(tocLinks(root).map((link) => link.getAttribute('href'))).toEqual(['#s-combat']);
      expect(q(root, '.count').textContent).toContain('1');
    });

    it('a search with no match shows the empty state, and its clear button brings every section back', async () => {
      const root = await render();
      const input = typeSearch(root, 'zzz-no-such-setting');
      expect(visibleSections(root)).toEqual([]);
      expect(tocLinks(root).length).toBe(0);
      expect(q(root, '.count').textContent).toContain('0');
      expect(q(root, '.empty').textContent).toContain('No section matches.');

      q<HTMLButtonElement>(root, '.empty button').click();
      fixture.detectChanges();
      expect(input.value).toBe('');
      expect(visibleSections(root).length).toBe(7);
      expect(root.querySelector('.empty')).toBeNull();
    });

    it('Escape in the search field clears it', async () => {
      const root = await render();
      const input = typeSearch(root, 'panels');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(input.value).toBe('');
      expect(visibleSections(root).length).toBe(7);
    });

    it('the slash key focuses the search, but not while typing elsewhere or with a dialog open', async () => {
      const root = await render();
      const input = searchInput(root);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
      expect(document.activeElement).toBe(input);
      input.blur();

      const other = document.createElement('input');
      document.body.append(other);
      other.focus();
      other.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
      expect(document.activeElement).toBe(other);
      other.remove();

      const dialog = document.createElement('dialog');
      dialog.setAttribute('open', '');
      document.body.append(dialog);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
      expect(document.activeElement).not.toBe(input);
    });

    it('a folded section stays folded after a reload, and the chevron reports it', async () => {
      const root = await render();
      expect(chevronOf(root, 's-table').getAttribute('aria-expanded')).toBe('true');
      chevronOf(root, 's-table').click();
      fixture.detectChanges();

      expect(bodyOf(root, 's-table').hidden).toBe(true);
      expect(chevronOf(root, 's-table').getAttribute('aria-expanded')).toBe('false');
      expect(JSON.parse(localStorage.getItem(SETTINGS_COLLAPSED_KEY) ?? '[]')).toEqual(['s-table']);

      fixture.destroy();
      const again = await render();
      expect(bodyOf(again, 's-table').hidden).toBe(true);
    });

    it('a search opens every section, whatever was folded, and the folding comes back when it is cleared', async () => {
      localStorage.setItem(SETTINGS_COLLAPSED_KEY, JSON.stringify(['s-combat']));
      const root = await render();
      expect(bodyOf(root, 's-combat').hidden).toBe(true);

      typeSearch(root, 'hide panels');
      expect(bodyOf(root, 's-combat').hidden).toBe(false);
      expect(chevronOf(root, 's-combat').disabled).toBe(true);

      q<HTMLButtonElement>(root, '.clear').click();
      fixture.detectChanges();
      expect(bodyOf(root, 's-combat').hidden).toBe(true);
    });

    it('collapse all and expand all save the list of sections', async () => {
      const root = await render();
      const tool = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('.tool-group button')].find((b) => b.textContent?.trim() === label)!;

      tool('Collapse all').click();
      fixture.detectChanges();
      expect(JSON.parse(localStorage.getItem(SETTINGS_COLLAPSED_KEY) ?? '[]')).toEqual([
        's-table',
        's-combat',
        's-music',
        's-appearance',
        's-update',
        's-checks',
        's-about',
      ]);
      expect(bodyOf(root, 's-about').hidden).toBe(true);

      tool('Expand all').click();
      fixture.detectChanges();
      expect(bodyOf(root, 's-about').hidden).toBe(false);
      expect(JSON.parse(localStorage.getItem(SETTINGS_COLLAPSED_KEY) ?? '[]')).toEqual([]);
    });

    it('clicking a table of contents link opens its folded section first', async () => {
      localStorage.setItem(SETTINGS_COLLAPSED_KEY, JSON.stringify(['s-table']));
      const root = await render();
      expect(bodyOf(root, 's-table').hidden).toBe(true);

      q<HTMLAnchorElement>(root, 'nav.toc a[href="#s-table"]').click();
      fixture.detectChanges();
      expect(bodyOf(root, 's-table').hidden).toBe(false);
      expect(JSON.parse(localStorage.getItem(SETTINGS_COLLAPSED_KEY) ?? '[]')).toEqual([]);
    });

    it('unreadable saved folding is ignored and every section opens', async () => {
      localStorage.setItem(SETTINGS_COLLAPSED_KEY, '{not json');
      const root = await render();
      expect(root.querySelectorAll('section.card[id] > .section-body[hidden]').length).toBe(0);
    });

    it('the changed marker shows in the table of contents and the head only for sections that differ from their defaults', async () => {
      settingsFake.explicit.set(['combat.showMaps']);
      const root = await render();

      expect(q(root, '#s-combat .changed-mark').getAttribute('title')).toBe('Changed from the default');
      expect(q(root, '#s-combat .changed-mark').textContent?.trim()).toBe('Changed');
      expect(q(root, 'nav.toc a[href="#s-combat"] .changed-mark')).toBeTruthy();
      expect(root.querySelector('#s-table .changed-mark')).toBeNull();
      expect(root.querySelector('nav.toc a[href="#s-table"] .changed-mark')).toBeNull();
      expect(root.querySelector('#s-update .changed-mark')).toBeNull();
    });

    it('a fragment in the address opens its section and scrolls to it, without throwing', async () => {
      localStorage.setItem(SETTINGS_COLLAPSED_KEY, JSON.stringify(['s-appearance']));
      const scroll = vi.fn();
      const original = (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = scroll;
      try {
        await TestBed.inject(Router).navigateByUrl('/settings#s-appearance');
        const root = await render();
        expect(bodyOf(root, 's-appearance').hidden).toBe(false);
        expect(scroll).toHaveBeenCalled();
        expect(scroll.mock.contexts[0]).toBe(sectionOf(root, 's-appearance'));
      } finally {
        (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = original;
      }
    });

    it('a fragment that names no section does nothing', async () => {
      await TestBed.inject(Router).navigateByUrl('/settings#no-such-section');
      const root = await render();
      expect(visibleSections(root).length).toBe(7);
    });
  });
});
