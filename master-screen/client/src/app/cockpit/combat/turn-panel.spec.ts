import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatantStats } from '@shared/types';
import type { Combatant } from '@shared/cockpit-types';
import { TurnPanel } from './turn-panel';

const GOBLIN_STATS: CombatantStats = {
  lines: [{ label: 'AC', value: '15' }],
  actions: [
    { name: 'Scimitar', text: '+4 to hit', group: 'attack', groupLabel: 'Attacks', timing: 'own_turn' },
    { name: 'Nimble Escape', text: 'Disengage as a bonus action', group: 'reaction', groupLabel: 'Reactions', timing: 'any_turn' },
  ],
};

const OGRE_STATS: CombatantStats = {
  lines: [],
  actions: [
    { name: 'Claw', text: '+6 to hit', group: 'attack', groupLabel: 'Attacks', timing: 'own_turn' },
    { name: 'Parry', text: 'Adds 2 to AC against one melee attack', group: 'reaction', groupLabel: 'Reactions', timing: 'others_turns' },
  ],
};

const GHOST_STATS: CombatantStats = {
  lines: [],
  actions: [{ name: 'Fade', text: 'Turns invisible', group: 'reaction', groupLabel: 'Reactions', timing: 'any_turn' }],
};

const MIRA: Combatant = { id: 'c-mira', name: 'Mira', kind: 'pc', initiative: 14, conditions: [] };
const GOBLIN: Combatant = { id: 'c-goblin', name: 'Goblin', kind: 'enemy', initiative: 12, hp: 7, maxHp: 7, conditions: [] };
const OGRE: Combatant = { id: 'c-ogre', name: 'Ogre', kind: 'enemy', initiative: 9, hp: 20, maxHp: 30, conditions: [] };
const GHOST: Combatant = { id: 'c-ghost', name: 'Ghost', kind: 'enemy', initiative: 5, hp: 0, maxHp: 10, conditions: [] };

const STATS: Record<string, CombatantStats> = {
  'c-goblin': GOBLIN_STATS,
  'c-ogre': OGRE_STATS,
  'c-ghost': GHOST_STATS,
};

interface Call {
  url: string;
  method: string;
}

function installServer(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      const stat = url.match(/^\/api\/battle\/stats\/(.+)$/);
      const found = stat ? STATS[decodeURIComponent(stat[1]!)] : undefined;
      const body = found ?? { error: 'not found' };
      return Promise.resolve(new Response(JSON.stringify(body), { status: found ? 200 : 404, headers: { 'content-type': 'application/json' } }));
    }),
  );
  return calls;
}

async function settle(fixture: ComponentFixture<TurnPanel>) {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

function create(combatants: Combatant[], activeId: string | null) {
  const fixture = TestBed.createComponent(TurnPanel);
  fixture.componentRef.setInput('combatants', combatants);
  fixture.componentRef.setInput('activeId', activeId);
  fixture.detectChanges();
  return fixture;
}

describe('TurnPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows only the own-turn actions of the active enemy', async () => {
    installServer();
    const fixture = create([GOBLIN, OGRE], 'c-goblin');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const now = root.querySelector('.now')!.textContent ?? '';
    expect(root.querySelector('.title')?.textContent).toContain('Turn of Goblin');
    expect(now).toContain('Scimitar');
    expect(now).toContain('+4 to hit');
    expect(now).toContain('Attacks');
    expect(now).not.toContain('Nimble Escape');
  });

  it('lists another enemy reaction under Out of turn, grouped by name', async () => {
    installServer();
    const fixture = create([GOBLIN, OGRE], 'c-goblin');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const other = root.querySelector('.other')!;
    expect(other.querySelector('.other-name')?.textContent).toContain('Ogre');
    expect(other.textContent).toContain('Parry');
    expect(other.textContent).not.toContain('Claw');
  });

  it('leaves out the reactions of a defeated enemy', async () => {
    installServer();
    const fixture = create([GOBLIN, GHOST], 'c-goblin');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).not.toContain('Fade');
    expect(root.textContent).toContain('No reactions or actions out of turn.');
  });

  it('shows no actions for the active player character', async () => {
    const calls = installServer();
    const fixture = create([MIRA, GOBLIN, OGRE], 'c-mira');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.title')?.textContent).toContain('Turn of Mira');
    expect(root.querySelector('.now')?.querySelector('.actions')).toBeNull();
    expect(root.textContent).toContain('Parry');
    expect(calls.some((call) => call.url === '/api/battle/stats/c-mira')).toBe(false);
  });

  it('shows a muted placeholder while the stats load', async () => {
    installServer();
    const fixture = create([GOBLIN], 'c-goblin');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.muted')?.textContent).toContain('…');
    await settle(fixture);
    expect(root.textContent).toContain('Scimitar');
  });
});
