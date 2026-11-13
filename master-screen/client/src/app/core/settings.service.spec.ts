import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenSettings, ScreenSettingsPatch, SettingsResponse } from '@shared/types';
import { ApiService } from './api.service';
import { LiveService } from './live.service';
import { PrefsService } from './prefs.service';
import { DEFAULT_SCREEN_SETTINGS, SettingsService } from './settings.service';

function response(settings: ScreenSettings, explicit: string[] = [], canSave = true): SettingsResponse {
  return { settings, defaults: DEFAULT_SCREEN_SETTINGS, canSave, explicit };
}

function withSettings(change: (s: ScreenSettings) => void): ScreenSettings {
  const copy = structuredClone(DEFAULT_SCREEN_SETTINGS);
  change(copy);
  return copy;
}

describe('SettingsService', () => {
  let api: { settings: ReturnType<typeof vi.fn>; saveSettings: ReturnType<typeof vi.fn> };
  let events: Subject<ScreenSettings>;
  let resync: Subject<void>;
  let slug: ReturnType<typeof signal<string | null>>;
  let store: Map<string, string>;
  let prefs: { slug: typeof slug; get: (key: string) => string | null; set: (key: string, value: string) => void; remove: (key: string) => void };

  beforeEach(() => {
    vi.useFakeTimers();
    api = {
      settings: vi.fn(async () => response(DEFAULT_SCREEN_SETTINGS)),
      saveSettings: vi.fn(async () => response(DEFAULT_SCREEN_SETTINGS)),
    };
    events = new Subject<ScreenSettings>();
    resync = new Subject<void>();
    slug = signal<string | null>('demo');
    store = new Map();
    prefs = {
      slug,
      get: (key) => store.get(key) ?? null,
      set: (key, value) => void store.set(key, value),
      remove: (key) => void store.delete(key),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: LiveService, useValue: { on: vi.fn(() => events.asObservable()), resync$: resync.asObservable() } },
        { provide: PrefsService, useValue: prefs },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  /** Lets the constructor's load finish and the effects run. */
  async function started(): Promise<SettingsService> {
    const service = TestBed.inject(SettingsService);
    await vi.advanceTimersByTimeAsync(0);
    TestBed.flushEffects();
    return service;
  }

  it('load fills settings and explicit from the response', async () => {
    const saved = withSettings((s) => {
      s.combat.showMaps = false;
    });
    api.settings.mockResolvedValue(response(saved, ['combat.showMaps']));

    const service = await started();

    expect(service.loaded()).toBe(true);
    expect(service.settings()).toEqual(saved);
    expect(service.explicit()).toEqual(['combat.showMaps']);
    expect(service.isDefault('combat.showMaps')).toBe(false);
    expect(service.isDefault('music.volume')).toBe(true);
  });

  it('keeps the defaults and still loads when the first load fails', async () => {
    api.settings.mockRejectedValue({ error: 'x', status: 500 });

    const service = await started();

    expect(service.loaded()).toBe(true);
    expect(service.settings()).toEqual(DEFAULT_SCREEN_SETTINGS);
  });

  it('update does not change settings before the save, then sends one merged patch after 600 ms', async () => {
    const service = await started();
    const before = service.settings();
    const saved = withSettings((s) => {
      s.combat.showMaps = false;
      s.combat.autoHide = false;
    });
    api.saveSettings.mockResolvedValue(response(saved, ['combat.showMaps', 'combat.autoHide']));

    service.update({ combat: { showMaps: false } });
    service.update({ combat: { autoHide: false } });

    expect(service.settings()).toBe(before);
    expect(service.saveState()).toBe('saving');
    expect(api.saveSettings).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(599);
    expect(api.saveSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await service.flush();

    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(api.saveSettings).toHaveBeenCalledWith({ combat: { showMaps: false, autoHide: false } });
    expect(service.settings()).toEqual(saved);
    expect(service.saveState()).toBe('saved');
  });

  it('a 409 from the server means the campaign cannot be saved', async () => {
    api.saveSettings.mockRejectedValue({ error: 'The campaign is not a git repository.', status: 409 });
    const service = await started();

    service.update({ music: { volume: 10 } });
    await service.flush();

    expect(service.canSave()).toBe(false);
    expect(service.saveState()).toBe('error');
    expect(service.saveError()).toBe('The campaign is not a git repository.');
  });

  it('a settings live event replaces settings', async () => {
    const service = await started();
    const next = withSettings((s) => {
      s.ui.density = 'compact';
    });

    events.next(next);

    expect(service.settings()).toEqual(next);
  });

  it('migrates the old battle maps preference when it is false and the file does not set it', async () => {
    store.set('showBattleMaps', 'false');
    api.saveSettings.mockResolvedValue(response(withSettings((s) => void (s.combat.showMaps = false)), ['combat.showMaps']));

    const service = await started();
    await service.flush();

    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(api.saveSettings).toHaveBeenCalledWith({ combat: { showMaps: false } });
    expect(store.has('showBattleMaps')).toBe(false);
    expect(service.loaded()).toBe(true);
  });

  it('does not migrate when the file already sets combat.showMaps, but removes the old key', async () => {
    store.set('showBattleMaps', 'false');
    api.settings.mockResolvedValue(response(DEFAULT_SCREEN_SETTINGS, ['combat.showMaps']));

    await started();
    await vi.advanceTimersByTimeAsync(1000);

    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(store.has('showBattleMaps')).toBe(false);
  });

  it('reset sends the full default section', async () => {
    const service = await started();

    service.reset('music');
    await vi.advanceTimersByTimeAsync(600);
    await service.flush();

    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(api.saveSettings).toHaveBeenCalledWith({ music: DEFAULT_SCREEN_SETTINGS.music });
  });

  it('patch type is accepted by update (compile-time check of the shape)', async () => {
    const service = await started();
    const patch: ScreenSettingsPatch = { ui: { rail: { print: false } } };
    service.update(patch);
    await service.flush();
    expect(api.saveSettings).toHaveBeenCalledWith({ ui: { rail: { print: false } } });
  });
  /** A save whose response the test resolves by hand. */
  function holdNextSave(): { resolve: (value: SettingsResponse) => void } {
    const hold: { send?: (value: SettingsResponse) => void } = {};
    api.saveSettings.mockImplementationOnce(() => new Promise<SettingsResponse>((resolve) => (hold.send = resolve)));
    return { resolve: (value) => hold.send?.(value) };
  }

  it('during a pending PUT, shown keeps the new value until the response arrives', async () => {
    const service = await started();
    const hold = holdNextSave();

    service.update({ combat: { showMaps: false } });
    await vi.advanceTimersByTimeAsync(600);

    expect(service.pending()).toEqual({});
    expect(service.inFlight()).toEqual({ combat: { showMaps: false } });
    expect(service.shown().combat.showMaps).toBe(false);
    expect(service.settings().combat.showMaps).toBe(true);

    hold.resolve(response(withSettings((s) => void (s.combat.showMaps = false))));
    await service.flush();
    expect(service.inFlight()).toEqual({});
    expect(service.shown().combat.showMaps).toBe(false);
    expect(service.saveState()).toBe('saved');
  });

  it('after a failed PUT, shown returns to the saved value and saveError is set', async () => {
    api.saveSettings.mockRejectedValueOnce(new Error('network down'));
    const service = await started();

    service.update({ combat: { showMaps: false } });
    await service.flush();

    expect(service.inFlight()).toEqual({});
    expect(service.shown().combat.showMaps).toBe(true);
    expect(service.saveState()).toBe('error');
    expect(service.saveError()).not.toBeNull();
  });

  it('an update made during an in-flight PUT survives the first response', async () => {
    const service = await started();
    const hold = holdNextSave();

    service.update({ combat: { showMaps: false } });
    await vi.advanceTimersByTimeAsync(600);
    service.update({ combat: { autoHide: false } });

    hold.resolve(response(withSettings((s) => void (s.combat.showMaps = false))));
    await vi.advanceTimersByTimeAsync(0);

    expect(service.inFlight()).toEqual({});
    expect(service.pending()).toEqual({ combat: { autoHide: false } });
    expect(service.shown().combat.autoHide).toBe(false);
    expect(service.shown().combat.showMaps).toBe(false);
  });

  it('loadError is set by a failed load and cleared by the next successful one', async () => {
    api.settings.mockRejectedValueOnce(new Error('offline'));
    const service = await started();
    expect(service.loadError()).not.toBeNull();

    await service.load();
    expect(service.loadError()).toBeNull();
  });
});
