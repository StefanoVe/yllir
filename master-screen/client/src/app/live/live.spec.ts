import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, CombatState, LiveSnapshot } from '@shared/types';
import { LiveStateService } from './live-api.service';
import { LiveComponent, shouldOpenCombat } from './live';

const EMPTY_BOARD: Board = { revision: 0, cards: [], frames: [], arrows: [] };

const COMBAT: CombatState = {
  active: true,
  round: 1,
  turn: 0,
  order: [],
  combatants: [],
  events: [],
  revision: 1,
};

function snapshot(extra: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    session: null,
    log: [],
    combat: null,
    board: EMPTY_BOARD,
    revision: 'r1',
    ...extra,
  };
}

/** Stands in for LiveStateService: the same signals and methods, no HTTP and no event stream. */
class FakeLiveState {
  readonly snapshot = signal<LiveSnapshot | null>(null);
  readonly board = signal<Board | null>(null);
  readonly session = computed(() => this.snapshot()?.session ?? null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly open = vi.fn(async (_title?: string) => {});
  readonly end = vi.fn(async () => {});
  readonly saveBoard = vi.fn(async (board: Board) => board);
}

const flush = async (fixture: ComponentFixture<LiveComponent>) => {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
};

describe('shouldOpenCombat', () => {
  it('opens only when combat turns active', () => {
    expect(shouldOpenCombat(false, true)).toBe(true);
    expect(shouldOpenCombat(true, true)).toBe(false);
    expect(shouldOpenCombat(true, false)).toBe(false);
    expect(shouldOpenCombat(false, false)).toBe(false);
  });
});

describe('LiveComponent', () => {
  let state: FakeLiveState;
  let fixture: ComponentFixture<LiveComponent>;

  beforeEach(() => {
    state = new FakeLiveState();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: LiveStateService, useValue: state },
      ],
    });
    fixture = TestBed.createComponent(LiveComponent);
  });

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('shows the empty state with one start button when no session is open', async () => {
    state.snapshot.set(snapshot());
    await flush(fixture);
    const root = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(root.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['Start the session']);
    expect(root.querySelector('ms-live-canvas')).toBeNull();
    expect(root.querySelector('ms-live-dock')).toBeNull();
  });

  it('starts the session with the optional title', async () => {
    state.snapshot.set(snapshot());
    await flush(fixture);
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = '  The harbour job  ';
    input.dispatchEvent(new Event('input'));
    (root.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    expect(state.open).toHaveBeenCalledWith('The harbour job');
  });

  it('opens the combat tab by itself when combat turns active, not on every refresh', async () => {
    state.snapshot.set(snapshot({ session: { id: '2026-11-12', title: 'Night', startedAt: '2026-11-12T20:00:00Z' } }));
    await flush(fixture);
    expect(fixture.componentInstance.dockTab()).toBe('log');

    state.snapshot.set(snapshot({ session: { id: '2026-11-12', title: 'Night', startedAt: '2026-11-12T20:00:00Z' }, combat: COMBAT }));
    await flush(fixture);
    expect(fixture.componentInstance.dockTab()).toBe('combat');
    expect(fixture.componentInstance.dockOpen()).toBe(true);

    fixture.componentInstance.onTab('log');
    state.snapshot.set(snapshot({ session: { id: '2026-11-12', title: 'Night', startedAt: '2026-11-12T20:00:00Z' }, combat: { ...COMBAT, revision: 2 } }));
    await flush(fixture);
    expect(fixture.componentInstance.dockTab()).toBe('log');
    expect(text()).toContain('Night');
  });
});
