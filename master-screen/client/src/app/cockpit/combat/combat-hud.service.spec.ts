import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CombatHud, HUD_IDLE_MS, HUD_STORAGE_KEY } from './combat-hud.service';

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

function hud(): CombatHud {
  TestBed.configureTestingModule({ providers: [CombatHud] });
  return TestBed.inject(CombatHud);
}

describe('CombatHud', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
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

  it('folds the turn card and keeps the chat folded on narrow screens by default', () => {
    stubMedia({ [NARROW]: true });
    const service = hud();
    expect(service.narrow()).toBe(true);
    expect(service.turn()).toBe(false);
    expect(service.chat()).toBe(false);
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

  it('remembers the panels and the hidden state in localStorage', () => {
    stubMedia({});
    const service = hud();
    service.toggle('music');
    service.toggle('initiative');
    service.toggle('chat');
    service.toggleHidden();

    const stored = JSON.parse(localStorage.getItem(HUD_STORAGE_KEY) ?? '{}');
    // Opening the chat below 1200 px folds the turn card.
    expect(stored).toEqual({ initiative: false, turn: false, chat: true, music: false, hidden: true });

    const again = TestBed.runInInjectionContext(() => new CombatHud());
    expect(again.music()).toBe(false);
    expect(again.initiative()).toBe(false);
    expect(again.turn()).toBe(false);
    expect(again.chat()).toBe(true);
    expect(again.hidden()).toBe(true);
  });

  it('uses the defaults when the stored state is not valid JSON', () => {
    stubMedia({});
    localStorage.setItem(HUD_STORAGE_KEY, '{not json');
    const service = hud();
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
  });
});
