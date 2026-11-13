import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CombatHud, HUD_IDLE_MS, HUD_STORAGE_KEY } from './combat-hud.service';
import { DEFAULT_SCREEN_SETTINGS, SettingsService } from '../../core/settings.service';
import type { ScreenSettings } from '@shared/types';

/** Fake matchMedia: `matches` tells which queries match; `changes` fires the listeners of a query. */
function stubMedia(matches: Record<string, boolean>) {
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return !!matches[query];
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => {
      if (!listeners.has(query)) listeners.set(query, new Set());
      listeners.get(query)!.add(fn);
    },
    removeEventListener: (_: string, fn: () => void) => listeners.get(query)?.delete(fn),
  }));
  return (query: string, value: boolean) => {
    matches[query] = value;
    listeners.get(query)?.forEach((fn) => fn());
  };
}

const NARROW = '(max-width: 899px)';
const WIDE = '(min-width: 1200px)';

/** The fake settings of each test: `fake.settings` is the signal the HUD reads, set it before creating the HUD. */
let fake: { settings: WritableSignal<ScreenSettings> };

function hud(): CombatHud {
  TestBed.configureTestingModule({
    providers: [CombatHud, { provide: SettingsService, useValue: fake }],
  });
  return TestBed.inject(CombatHud);
}

describe('CombatHud', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    fake = { settings: signal(structuredClone(DEFAULT_SCREEN_SETTINGS)) };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('starts with initiative, turn and music open and the chat folded', () => {
    const service = hud();
    expect(service.initiative()).toBe(true);
    expect(service.turn()).toBe(true);
    expect(service.chat()).toBe(false);
    expect(service.music()).toBe(true);
    expect(service.hidden()).toBe(false);
    expect(service.idle()).toBe(false);
    expect(service.visible()).toBe(true);
  });

  it('starts the panels from the settings', () => {
    stubMedia({});
    fake.settings.update((s) => ({
      ...s,
      combat: { ...s.combat, panels: { initiative: false, turn: false, chat: true, music: true } },
    }));
    const service = hud();
    expect(service.initiative()).toBe(false);
    expect(service.turn()).toBe(false);
    expect(service.chat()).toBe(true);
    expect(service.music()).toBe(true);
  });

  it('folds the chat at start when the settings open both turn and chat below 1200 px', () => {
    stubMedia({});
    fake.settings.update((s) => ({
      ...s,
      combat: { ...s.combat, panels: { ...s.combat.panels, turn: true, chat: true } },
    }));
    const service = hud();
    expect(service.turn()).toBe(true);
    expect(service.chat()).toBe(false);
  });

  it('folds the turn card and keeps the chat folded on narrow screens by default', () => {
    stubMedia({ [NARROW]: true });
    const service = hud();
    expect(service.narrow()).toBe(true);
    expect(service.turn()).toBe(false);
    expect(service.chat()).toBe(false);
  });

  it('keeps the turn card folded on narrow screens even when the settings open it', () => {
    stubMedia({ [NARROW]: true });
    fake.settings.update((s) => ({
      ...s,
      combat: { ...s.combat, panels: { ...s.combat.panels, turn: true } },
    }));
    const service = hud();
    expect(service.turn()).toBe(false);
  });

  it('keeps turn and chat exclusive below 1200 px', () => {
    stubMedia({});
    const service = hud();
    expect(service.wide()).toBe(false);

    // Turn starts open: opening the chat folds it.
    service.toggle('chat');
    expect(service.chat()).toBe(true);
    expect(service.turn()).toBe(false);

    service.toggle('turn');
    expect(service.turn()).toBe(true);
    expect(service.chat()).toBe(false);

    service.toggle('chat');
    expect(service.chat()).toBe(true);
    expect(service.turn()).toBe(false);
  });

  it('lets turn and chat both be open from 1200 px', () => {
    stubMedia({ [WIDE]: true });
    const service = hud();
    expect(service.wide()).toBe(true);

    service.toggle('chat');
    expect(service.chat()).toBe(true);
    expect(service.turn()).toBe(true);
  });

  it('folds the chat when the window narrows below 1200 px with both open', () => {
    const change = stubMedia({ [WIDE]: true });
    const service = hud();
    service.toggle('chat');
    expect(service.turn()).toBe(true);
    expect(service.chat()).toBe(true);

    change(WIDE, false);
    expect(service.wide()).toBe(false);
    expect(service.chat()).toBe(false);
    expect(service.turn()).toBe(true);
  });

  it('forces the chat open with setChat, closing the turn card below 1200 px', () => {
    stubMedia({});
    const service = hud();
    service.setChat(true);
    expect(service.chat()).toBe(true);
    expect(service.turn()).toBe(false);
  });

  it('fades out after four seconds without activity, and any activity shows the panels again', () => {
    stubMedia({});
    const service = hud();
    service.activity();
    vi.advanceTimersByTime(HUD_IDLE_MS - 1);
    expect(service.idle()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(service.idle()).toBe(true);
    expect(service.visible()).toBe(false);

    service.activity();
    expect(service.idle()).toBe(false);
    expect(service.visible()).toBe(true);
  });

  it('fades out after autoHideSeconds from the settings', () => {
    stubMedia({});
    fake.settings.update((s) => ({ ...s, combat: { ...s.combat, autoHideSeconds: 7 } }));
    const service = hud();
    service.activity();
    vi.advanceTimersByTime(6000);
    expect(service.idle()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(service.idle()).toBe(true);
  });

  it('never fades out when auto-hide is off in the settings', () => {
    stubMedia({});
    fake.settings.update((s) => ({ ...s, combat: { ...s.combat, autoHide: false } }));
    const service = hud();
    service.activity();
    vi.advanceTimersByTime(60_000);
    expect(service.idle()).toBe(false);
    expect(service.visible()).toBe(true);
  });

  it('cancels a pending fade when auto-hide is turned off during the fight', () => {
    stubMedia({});
    const service = hud();
    service.activity();
    vi.advanceTimersByTime(HUD_IDLE_MS - 1000);

    fake.settings.update((s) => ({ ...s, combat: { ...s.combat, autoHide: false } }));
    TestBed.flushEffects();
    vi.advanceTimersByTime(HUD_IDLE_MS * 3);
    expect(service.idle()).toBe(false);
    expect(service.visible()).toBe(true);
  });

  it('does not fade out while a panel holds the pointer or the focus', () => {
    stubMedia({});
    const service = hud();
    service.activity();
    service.pin(true);
    vi.advanceTimersByTime(HUD_IDLE_MS * 3);
    expect(service.idle()).toBe(false);

    service.pin(false);
    vi.advanceTimersByTime(HUD_IDLE_MS - 1);
    expect(service.idle()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(service.idle()).toBe(true);
  });

  it('never fades out on narrow screens', () => {
    stubMedia({ [NARROW]: true });
    const service = hud();
    service.activity();
    vi.advanceTimersByTime(HUD_IDLE_MS * 3);
    expect(service.idle()).toBe(false);
    expect(service.visible()).toBe(true);
  });

  it('hides every panel by hand until toggled back', () => {
    stubMedia({});
    const service = hud();
    service.toggleHidden();
    expect(service.hidden()).toBe(true);
    expect(service.visible()).toBe(false);
    service.activity();
    expect(service.visible()).toBe(false);
    service.toggleHidden();
    expect(service.visible()).toBe(true);
  });

  it('remembers only the hidden state in localStorage, not the panels', () => {
    stubMedia({});
    const service = hud();
    service.toggle('music');
    service.toggle('initiative');
    service.toggle('chat');
    expect(localStorage.getItem(HUD_STORAGE_KEY)).toBeNull();

    service.toggleHidden();
    expect(JSON.parse(localStorage.getItem(HUD_STORAGE_KEY) ?? '{}')).toEqual({ hidden: true });

    const again = TestBed.runInInjectionContext(() => new CombatHud());
    expect(again.hidden()).toBe(true);
    // Panels come from the settings again, not from the previous fight.
    expect(again.music()).toBe(true);
    expect(again.initiative()).toBe(true);
    expect(again.turn()).toBe(true);
    expect(again.chat()).toBe(false);
  });

  it('reads the old stored shape: hidden is kept, the panel flags are ignored', () => {
    stubMedia({});
    localStorage.setItem(
      HUD_STORAGE_KEY,
      JSON.stringify({ initiative: false, turn: false, chat: true, music: false, hidden: true }),
    );
    fake.settings.update((s) => ({
      ...s,
      combat: { ...s.combat, panels: { initiative: true, turn: true, chat: false, music: true } },
    }));
    const service = hud();
    expect(service.hidden()).toBe(true);
    expect(service.initiative()).toBe(true);
    expect(service.turn()).toBe(true);
    expect(service.chat()).toBe(false);
    expect(service.music()).toBe(true);
  });

  it('uses the defaults when the stored state is not valid JSON', () => {
    stubMedia({});
    localStorage.setItem(HUD_STORAGE_KEY, '{not json');
    const service = hud();
    expect(service.hidden()).toBe(false);
    expect(service.initiative()).toBe(true);
    expect(service.chat()).toBe(false);
  });

  it('keeps working when localStorage throws', () => {
    stubMedia({});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const service = hud();
    expect(() => service.toggle('music')).not.toThrow();
    expect(service.music()).toBe(false);
    expect(() => service.toggleHidden()).not.toThrow();
    expect(service.hidden()).toBe(true);
  });
});
