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
  lines: [
    { label: 'AC', value: '11' },
    { label: 'HP', value: '59' },
  ],
  actions: [
    { name: 'Claw', text: '+6 to hit', group: 'attack', groupLabel: 'Attacks', timing: 'own_turn' },
    { name: 'Parry', text: 'Adds 2 to AC against one melee attack', group: 'reaction', groupLabel: 'Reactions', timing: 'others_turns' },
  ],
};

const GHOST_STATS: CombatantStats = {
  lines: [],
  actions: [{ name: 'Fade', text: 'Turns invisible', group: 'reaction', groupLabel: 'Reactions', timing: 'any_turn' }],
};

const WYRM_STATS: CombatantStats = {
  lines: [],
  actions: [{ name: 'Bite', text: 'parser text', group: 'attack', groupLabel: 'Attacks', timing: 'own_turn' }],
  source: 'agent',
  card: {
    sheet: 'Enemies/Wyrm.md',
    sheetHash: 'abc',
    at: '2026-11-13T10:00:00Z',
    actions: [
      { name: 'Bite', timing: 'own_turn', cost: 'action', kind: 'attack', toHit: 5, damage: [{ dice: '1d8+2', type: 'piercing' }], effect: 'Bites the target.' },
      {
        name: 'Fire breath',
        timing: 'own_turn',
        cost: 'action',
        kind: 'save',
        save: { ability: 'DEX', dc: 13, onSuccess: 'Half damage' },
        damage: [{ dice: '6d6', type: 'fire' }],
        recharge: '5-6',
        effect: 'A cone of fire.',
      },
      { name: 'Wing buffet', timing: 'own_turn', cost: 'bonus', kind: 'attack', uses: { max: 3, per: 'day' }, effect: 'Pushes one target.' },
      {
        name: 'Tail parry',
        timing: 'others_turns',
        cost: 'reaction',
        kind: 'utility',
        trigger: 'When hit by a melee attack',
        effect: 'Adds 2 to AC.',
      },
    ],
    traits: [{ name: 'Keen smell', text: 'Advantage on tracking by scent.' }],
  },
};

const WYRM: Combatant = { id: 'c-wyrm', name: 'Wyrm', kind: 'enemy', initiative: 11, hp: 40, maxHp: 40, conditions: [] };

const MIRA: Combatant = { id: 'c-mira', name: 'Mira', kind: 'pc', initiative: 14, conditions: [] };
const GOBLIN: Combatant = { id: 'c-goblin', name: 'Goblin', kind: 'enemy', initiative: 12, hp: 7, maxHp: 7, conditions: [] };
const OGRE: Combatant = { id: 'c-ogre', name: 'Ogre', kind: 'enemy', initiative: 9, hp: 20, maxHp: 30, conditions: [] };
const GHOST: Combatant = { id: 'c-ghost', name: 'Ghost', kind: 'enemy', initiative: 5, hp: 0, maxHp: 10, conditions: [] };

const STATS: Record<string, CombatantStats> = {
  'c-goblin': GOBLIN_STATS,
  'c-ogre': OGRE_STATS,
  'c-ghost': GHOST_STATS,
  'c-wyrm': WYRM_STATS,
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

function create(combatants: Combatant[], activeId: string | null, pending: string[] = []) {
  const fixture = TestBed.createComponent(TurnPanel);
  fixture.componentRef.setInput('combatants', combatants);
  fixture.componentRef.setInput('activeId', activeId);
  fixture.componentRef.setInput('pending', pending);
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
  it('shows the action card: chips for to-hit, damage, save, recharge and uses', async () => {
    installServer();
    const fixture = create([WYRM, GOBLIN], 'c-wyrm');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const now = root.querySelector('.now')!;
    const hit = now.querySelector('.chip.hit');
    expect(hit?.textContent).toContain('+5 to hit');
    const dmg = [...now.querySelectorAll('.chip.dmg')].map((c) => c.textContent?.trim());
    expect(dmg).toEqual(['1d8+2 piercing', '6d6 fire']);
    const save = now.querySelector('.chip.save');
    expect(save?.textContent).toContain('DEX save DC 13');
    expect(save?.getAttribute('title')).toContain('Half damage');
    expect(now.textContent).toContain('Recharge 5-6');
    expect(now.textContent).toContain('3/day');
    expect(now.textContent).toContain('A cone of fire.');
  });

  it('groups the card by cost with the cost labels and no basic badge', async () => {
    installServer();
    const fixture = create([WYRM, GOBLIN], 'c-wyrm');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const headings = [...root.querySelectorAll('.now .group-label')].map((h) => h.textContent?.trim());
    expect(headings).toEqual(['Action', 'Bonus action']);
    expect(root.querySelector('.now .badge')).toBeNull();
    expect(root.querySelector('.now .reading')).toBeNull();
  });

  it('shows the trigger of a reaction and its effect among the out-of-turn actions', async () => {
    installServer();
    const fixture = create([WYRM, GOBLIN], 'c-goblin');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const other = root.querySelector('.other')!;
    expect(other.querySelector('.other-name')?.textContent).toContain('Wyrm');
    expect(other.querySelector('.trigger')?.textContent).toContain('Trigger: When hit by a melee attack');
    expect(other.querySelector('.effect')?.textContent).toContain('Adds 2 to AC.');
    expect(other.textContent).not.toContain('Bite');
  });

  it('renders the traits of the active creature in a disclosure', async () => {
    installServer();
    const fixture = create([WYRM], 'c-wyrm');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const traits = root.querySelector('.now details.traits')!;
    expect(traits.querySelector('summary')?.textContent).toContain('Traits');
    expect(traits.textContent).toContain('Keen smell');
    expect(traits.textContent).toContain('Advantage on tracking by scent.');
  });

  it('marks the parser fallback as basic', async () => {
    installServer();
    const fixture = create([GOBLIN, OGRE], 'c-goblin');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const badge = root.querySelector('.now .badge')!;
    expect(badge.textContent).toContain('basic');
    expect(badge.getAttribute('title')).toBe('Actions read without interpretation');
    expect(root.querySelector('.now .chip')).toBeNull();
    expect(root.querySelector('.now .action-name')?.textContent).toContain('Scimitar');
  });

  it('shows the stat lines of the active creature under its hit points', async () => {
    installServer();
    const fixture = create([GOBLIN, OGRE], 'c-goblin');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const lines = root.querySelector('.now .stat-lines')!;
    const terms = [...lines.querySelectorAll('dt')].map((t) => t.textContent?.trim());
    const values = [...lines.querySelectorAll('dd')].map((d) => d.textContent?.trim());
    expect(terms).toEqual(['AC']);
    expect(values).toEqual(['15']);
  });

  it('shows the stat lines of each other creature under its head', async () => {
    installServer();
    const fixture = create([GOBLIN, OGRE], 'c-goblin');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const other = root.querySelector('.other')!;
    const values = [...other.querySelectorAll('.stat-lines dd')].map((d) => d.textContent?.trim());
    expect(values).toEqual(['11', '59']);
    expect(other.querySelector('.stat-lines')?.previousElementSibling?.classList.contains('other-head')).toBe(true);
  });

  it('shows no stat lines for a player character', async () => {
    installServer();
    const fixture = create([MIRA, GOBLIN, OGRE], 'c-mira');
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.now .stat-lines')).toBeNull();
    expect(root.querySelector('.other .stat-lines')).not.toBeNull();
  });

  it('shows the reading indicator while the combatant card is pending', async () => {
    installServer();
    const fixture = create([GOBLIN, OGRE], 'c-goblin', ['c-goblin']);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const reading = root.querySelector('.now .reading')!;
    expect(reading.textContent).toContain('Reading the sheet');
    expect(reading.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector('.now .action-name')?.textContent).toContain('Scimitar');
  });

  it('asks the stats again when the pending state changes', async () => {
    const calls = installServer();
    const fixture = create([GOBLIN, OGRE], 'c-goblin', ['c-goblin']);
    await settle(fixture);
    const asked = () => calls.filter((call) => call.url === '/api/battle/stats/c-goblin').length;
    expect(asked()).toBe(1);

    fixture.componentRef.setInput('pending', []);
    await settle(fixture);
    expect(asked()).toBe(2);
    expect((fixture.nativeElement as HTMLElement).querySelector('.reading')).toBeNull();
  });
});
