import { TestBed } from '@angular/core/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleView, CombatantStats, CombatRules } from '@shared/types';
import type { BoardModuleView, Combat, CockpitSessionView } from '@shared/cockpit-types';
import { CockpitService } from '../cockpit.service';
import { PrefsService } from '../../core/prefs.service';
import { CombatOverlay } from './combat-overlay';
import { CombatOverlayService } from './combat-overlay.service';
import { BattleMapPrefs } from './battle-maps-pref';

const STAMP = '2026-11-12T10:00:00Z';

function card(id: string, kind: 'npc' | 'enemy', title: string, path: string): BoardModuleView {
  return {
    id,
    kind,
    ref: { type: 'doc', path },
    pinned: false,
    reason: '',
    addedBy: 'dm',
    addedAt: STAMP,
    updatedAt: STAMP,
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    content: { title },
  } as BoardModuleView;
}

function session(modules: BoardModuleView[], combat: Combat | null = null): CockpitSessionView {
  return {
    id: 's1',
    title: 'Session one',
    createdAt: STAMP,
    updatedAt: STAMP,
    revision: 1,
    provider: 'claude',
    model: 'claude-sonnet-5-5',
    state: {
      position: { location: '', moment: '', summary: '' },
      party: [],
      board: { modules, frames: [], links: [], highlightId: null },
      ledger: [],
      combat,
    },
    messages: [],
    turns: [],
    history: [],
  } as CockpitSessionView;
}

const COMBAT: Combat = {
  title: 'Combat: Ogre',
  round: 2,
  activeId: 'c-ogre',
  notes: '',
  notices: [],
  participants: [
    { id: 'c-mira', name: 'Mira', kind: 'pc', initiative: 14, conditions: [] },
    { id: 'c-ogre', name: 'Ogre', kind: 'enemy', initiative: 9, hp: 20, maxHp: 30, conditions: [] },
  ],
};

const MAP: BattleView = {
  map: { ref: 'Maps/tavern.png', cols: 10, rows: 8 },
  positions: {},
  revision: 1,
};

const RULES: CombatRules = {
  conditions: [{ id: 'prone', label: 'Prone' }],
  durations: [{ id: 'until_removed', label: 'Until removed' }],
};

const OGRE_STATS: CombatantStats = {
  lines: [{ label: 'AC', value: '13' }],
  actions: [{ name: 'Claw', text: '+5 to hit, 1d6+3 slashing', group: 'attack', groupLabel: 'Attacks', timing: 'own_turn' }],
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }));
}

/** Fake of the battle and cockpit endpoints: records every call. */
function installServer(options: { battle: BattleView | null; stats?: Record<string, CombatantStats> }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url === '/api/battle/rules') return json(RULES);
      if (url === '/api/battle/players')
        return json({ players: [{ name: 'Mira', ref: 'Players/Mira.md' }, { name: 'Tor', ref: 'Players/Tor.md' }] });
      if (url === '/api/battle' && (method === 'GET' || method === 'PUT')) return json(options.battle);
      const stat = url.match(/^\/api\/battle\/stats\/(.+)$/);
      if (stat && method === 'GET') {
        const found = options.stats?.[decodeURIComponent(stat[1]!)];
        return found ? json(found) : json({ error: 'not found' }, 404);
      }
      if (url === '/api/cockpit/sessions/s1/combat/thread' && method === 'POST') return json({ threadId: 'th1' });
      if (url === '/api/cockpit/sessions/th1' && method === 'GET') return json({ id: 'th1', messages: [], turns: [] });
      if (url.endsWith('/actions') || url.endsWith('/messages')) return json({});
      return json({ error: 'not found' }, 404);
    }),
  );
  return calls;
}

async function settle(fixture: { detectChanges: () => void; whenStable: () => Promise<boolean> }) {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

function chipByName(root: HTMLElement, name: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('.token')].find((el) => el.getAttribute('aria-label')?.startsWith(`${name},`));
  if (!found) throw new Error(`no chip for ${name}`);
  return found;
}

function setNumber(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('Combat overlay', () => {
  beforeAll(() => {
    // Chat schedules a ResizeObserver after each render; it stays defined for the late frames.
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  });

  beforeEach(() => {
    localStorage.clear();
    // The combat chat follows the combat thread through its own event stream.
    vi.stubGlobal('EventSource', class { close() {} });
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
  });

  afterEach(async () => {
    // Let the chat's pending animation frames run while the globals are still stubbed.
    await new Promise((resolve) => setTimeout(resolve, 50));
    vi.unstubAllGlobals();
  });

  /** The overlay renders only while open: open it on the Ogre card unless a test opened it already. */
  function create() {
    const service = TestBed.inject(CombatOverlayService);
    if (!service.open()) service.openFor({ cardId: 'c-ogre', name: 'Ogre', path: 'Enemies/Ogre.md', kind: 'enemy' });
    return TestBed.createComponent(CombatOverlay);
  }

  it('starts the combat from the initiative step with one combat.start action', async () => {
    const calls = installServer({ battle: null });
    TestBed.inject(CockpitService).session.set(
      session([
        card('c-kaelen', 'npc', 'Kaelen', 'NPCs/Kaelen.md'),
        card('c-ogre', 'enemy', 'Ogre', 'Enemies/Ogre.md'),
        card('c-brann', 'npc', 'Brann', 'NPCs/Brann.md'),
      ]),
    );
    TestBed.inject(CombatOverlayService).openFor({ cardId: 'c-kaelen', name: 'Kaelen', path: 'NPCs/Kaelen.md', kind: 'npc' });
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    // Player characters come from the battle API, without any ticking.
    expect([...root.querySelectorAll('.name')].map((el) => el.textContent?.trim()).slice(0, 2)).toEqual(['Mira', 'Tor']);
    const creatureBoxes = root.querySelectorAll<HTMLInputElement>('section[aria-labelledby="combat-creatures"] input[type="checkbox"]');
    expect([...creatureBoxes].map((box) => box.checked)).toEqual([true, false, false]);

    setNumber(root.querySelector<HTMLInputElement>('input[aria-label="Initiative of Mira"]')!, '14');
    setNumber(root.querySelector<HTMLInputElement>('input[aria-label="Initiative of Kaelen"]')!, '12');
    creatureBoxes[1]!.click(); // Ogre
    creatureBoxes[2]!.click(); // Brann
    await settle(fixture);
    root.querySelectorAll<HTMLButtonElement>('button.side[data-side="ally"]')[2]!.click(); // Brann becomes an ally
    await settle(fixture);
    setNumber(root.querySelector<HTMLInputElement>('input[aria-label="Initiative of Ogre"]')!, '');

    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);

    const start = calls.find((call) => call.url === '/api/cockpit/sessions/s1/actions');
    expect(start?.method).toBe('POST');
    expect(start?.body).toEqual({
      actions: [
        {
          type: 'combat.start',
          title: 'Combat: Kaelen',
          participants: [
            { name: 'Mira', kind: 'pc', initiative: 14, conditions: [], source: { path: 'Players/Mira.md' } },
            { name: 'Tor', kind: 'pc', initiative: null, conditions: [], source: { path: 'Players/Tor.md' } },
            { name: 'Kaelen', kind: 'enemy', initiative: 12, conditions: [], source: { path: 'NPCs/Kaelen.md' } },
            { name: 'Ogre', kind: 'enemy', initiative: null, conditions: [], source: { path: 'Enemies/Ogre.md' } },
            { name: 'Brann', kind: 'ally', initiative: null, conditions: [], source: { path: 'NPCs/Brann.md' } },
          ],
        },
      ],
    });
  });

  it('shows the battle view straight away when a combat is already active', async () => {
    installServer({ battle: null });
    TestBed.inject(CockpitService).session.set(session([card('c-ogre', 'enemy', 'Ogre', 'Enemies/Ogre.md')], COMBAT));
    TestBed.inject(CombatOverlayService).openFor({ cardId: 'c-ogre', name: 'Ogre', path: 'Enemies/Ogre.md', kind: 'enemy' });
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('cockpit-battle-board')).not.toBeNull();
    expect(root.querySelector('cockpit-initiative-step')).toBeNull();
    expect(root.querySelector('.round')?.textContent).toContain('Round 2');
  });

  it('renders the initiative strip with one tile per participant in initiative order and marks the active one', async () => {
    installServer({ battle: null });
    TestBed.inject(CockpitService).session.set(session([card('c-ogre', 'enemy', 'Ogre', 'Enemies/Ogre.md')], COMBAT));
    TestBed.inject(CombatOverlayService).openFor({ cardId: 'c-ogre', name: 'Ogre', path: 'Enemies/Ogre.md', kind: 'enemy' });
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const tiles = [...root.querySelectorAll<HTMLElement>('.strip .tile')];
    expect(tiles.map((tile) => tile.querySelector('.tile-name')?.textContent?.trim())).toEqual(['Mira', 'Ogre']);
    expect(tiles.map((tile) => tile.classList.contains('active'))).toEqual([false, true]);
  });

  it('shows the newest notice of the combat on a strip under the title bar', async () => {
    installServer({ battle: null });
    const notices = [
      { at: '2026-11-12T10:00:00Z', kind: 'defeated' as const, id: 'c-goblin', name: 'Goblin' },
      { at: '2026-11-12T10:05:00Z', kind: 'unconscious' as const, id: 'c-mira', name: 'Mira' },
    ];
    TestBed.inject(CockpitService).session.set(session([], { ...COMBAT, notices }));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.notice-strip .notice-text')?.textContent).toContain('Mira is unconscious');
    expect(root.querySelector('.notice-list')).toBeNull();
    root.querySelector<HTMLButtonElement>('.notice-toggle')!.click();
    fixture.detectChanges();
    const items = [...root.querySelectorAll('.notice-list li')].map((li) => li.textContent?.trim());
    expect(items).toEqual(['Mira is unconscious', 'Goblin is defeated']);
  });

  it('shows no notice pill when the only notice is a turn change, which the strip already shows', async () => {
    installServer({ battle: null });
    const notices = [{ at: '2026-11-12T10:10:00Z', kind: 'turn' as const, id: 'c-ogre', name: 'Ogre', round: 3, newRound: true }];
    TestBed.inject(CockpitService).session.set(session([], { ...COMBAT, notices }));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.notice-strip')).toBeNull();
    expect(root.querySelector('.round')?.textContent).toContain('Round 2');
  });

  it('shows the newest notice that is not a turn change in the pill, and the list keeps every kind', async () => {
    installServer({ battle: null });
    const notices = [
      { at: '2026-11-12T10:00:00Z', kind: 'defeated' as const, id: 'c-goblin', name: 'Goblin' },
      { at: '2026-11-12T10:10:00Z', kind: 'turn' as const, id: 'c-ogre', name: 'Ogre', round: 3, newRound: true },
    ];
    TestBed.inject(CockpitService).session.set(session([], { ...COMBAT, notices }));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.notice-strip .notice-text')?.textContent).toContain('Goblin is defeated');
    root.querySelector<HTMLButtonElement>('.notice-toggle')!.click();
    fixture.detectChanges();
    const items = [...root.querySelectorAll('.notice-list li')].map((li) => li.textContent?.trim());
    expect(items).toEqual(["Round 3: Ogre's turn", 'Goblin is defeated']);
  });

  it('keeps the turn announcement for screen readers even when the pill is not shown', async () => {
    installServer({ battle: null });
    const cockpit = TestBed.inject(CockpitService);
    cockpit.session.set(session([], COMBAT));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    cockpit.session.set(session([], { ...COMBAT, notices: [
      { at: '2026-11-12T10:10:00Z', kind: 'turn', id: 'c-ogre', name: 'Ogre', round: 3, newRound: true },
    ] }));
    await settle(fixture);
    expect(root.querySelector('.notice-strip')).toBeNull();
    expect(root.querySelector('.sr-only')?.textContent?.trim()).toBe("Round 3: Ogre's turn");
  });

  it('puts Next turn to the right of the spacer, after the round and the notice', async () => {
    installServer({ battle: null });
    const notices = [{ at: '2026-11-12T10:00:00Z', kind: 'defeated' as const, id: 'c-goblin', name: 'Goblin' }];
    TestBed.inject(CockpitService).session.set(session([], { ...COMBAT, notices }));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const bar = (fixture.nativeElement as HTMLElement).querySelector('.bar')!;
    const order = [...bar.children].map((el) => el.className);
    const at = (name: string) => order.findIndex((className) => className.split(' ').includes(name));

    expect(at('round')).toBeLessThan(at('notice-strip'));
    expect(at('notice-strip')).toBeLessThan(at('spacer'));
    expect(at('spacer')).toBeLessThan(at('next-turn'));
    expect(at('next-turn')).toBeLessThan(at('icon-button'));
  });

  it('gives each strip tile the full name as its title', async () => {
    installServer({ battle: null });
    TestBed.inject(CockpitService).session.set(session([], COMBAT));
    TestBed.inject(CombatOverlayService).openFor({ cardId: 'c-ogre', name: 'Ogre', path: 'Enemies/Ogre.md', kind: 'enemy' });
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect([...root.querySelectorAll('.strip .tile-name')].map((el) => el.getAttribute('title'))).toEqual(['Mira', 'Ogre']);
  });

  it('moves the map hint to the map title and a visually hidden description, not visible text', async () => {
    installServer({ battle: MAP });
    TestBed.inject(PrefsService).setCampaign('test');
    TestBed.inject(CockpitService).session.set(session([], COMBAT));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.hint')).toBeNull();
    const map = root.querySelector<HTMLElement>('.map')!;
    const describedBy = map.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = root.querySelector<HTMLElement>(`#${describedBy}`)!;
    expect(description.textContent?.trim()).toContain('Arrow keys');
    expect(description.classList.contains('sr-only')).toBe(true);
    expect(map.getAttribute('title')).toBe(description.textContent?.trim());
  });

  it('starts with the chat folded under 900 px, and the toggle still opens it', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === '(max-width: 899px)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      installServer({ battle: null });
      TestBed.inject(CockpitService).session.set(session([], COMBAT));
      const fixture = create();
      fixture.detectChanges();
      await settle(fixture);
      const root = fixture.nativeElement as HTMLElement;

      expect(root.querySelector('.chat-panel')?.classList.contains('collapsed')).toBe(true);
      expect(root.querySelector('cockpit-chat')).toBeNull();
      root.querySelector<HTMLButtonElement>('.chat-toggle')!.click();
      fixture.detectChanges();
      expect(root.querySelector('cockpit-chat')).not.toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it('announces only the notices that come after the overlay opened', async () => {
    installServer({ battle: null });
    const cockpit = TestBed.inject(CockpitService);
    cockpit.session.set(session([], { ...COMBAT, notices: [{ at: '2026-11-12T10:00:00Z', kind: 'defeated', id: 'c-goblin', name: 'Goblin' }] }));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.sr-only')?.textContent?.trim()).toBe('');

    cockpit.session.set(session([], { ...COMBAT, notices: [
      { at: '2026-11-12T10:00:00Z', kind: 'defeated', id: 'c-goblin', name: 'Goblin' },
      { at: '2026-11-12T10:10:00Z', kind: 'turn', id: 'c-ogre', name: 'Ogre', round: 3, newRound: true },
    ] }));
    await settle(fixture);
    expect(root.querySelector('.sr-only')?.textContent?.trim()).toBe("Round 3: Ogre's turn");
  });

  it('shows no chat panel and no chat toggle while no combat is active', async () => {
    installServer({ battle: null });
    TestBed.inject(CockpitService).session.set(session([card('c-ogre', 'enemy', 'Ogre', 'Enemies/Ogre.md')]));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('cockpit-initiative-step')).not.toBeNull();
    expect(root.querySelector('.chat-panel')).toBeNull();
    expect(root.querySelector('.chat-toggle')).toBeNull();
    expect(root.querySelector('cockpit-chat')).toBeNull();
  });

  it('shows the chat panel once a combat is active', async () => {
    installServer({ battle: null });
    TestBed.inject(CockpitService).session.set(session([], COMBAT));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.chat-panel')).not.toBeNull();
    expect(root.querySelector('.chat-toggle')).not.toBeNull();
  });

  it('renders the turn panel while a combat is active', async () => {
    installServer({ battle: null, stats: { 'c-ogre': OGRE_STATS } });
    TestBed.inject(CockpitService).session.set(session([], COMBAT));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('cockpit-turn-panel')).not.toBeNull();
    expect(root.querySelector('cockpit-turn-panel')?.textContent).toContain('Turn of Ogre');
    expect(root.querySelector('cockpit-turn-panel')?.textContent).toContain('Claw');
  });

    it('moves a token from the tray onto the grid with a PUT that names the cell', async () => {
    const calls = installServer({ battle: MAP });
    TestBed.inject(PrefsService).setCampaign('test');
    TestBed.inject(CockpitService).session.set(session([], COMBAT));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    const map = root.querySelector<HTMLElement>('.map')!;
    map.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON() {} }) as DOMRect;

    const tray = root.querySelector<HTMLElement>('.tray-chip')!;
    tray.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 50 }));
    tray.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 50 }));
    tray.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 100, clientY: 50 }));
    await settle(fixture);

    const put = calls.filter((call) => call.method === 'PUT');
    expect(put).toEqual([{ url: '/api/battle', method: 'PUT', body: { positions: { 'c-mira': { x: 2, y: 2 } } } }]);
    expect([...root.querySelectorAll('.tray-chip .token')].map((el) => el.getAttribute('aria-label'))).toEqual(['Ogre, initiative 9']);

    // Arrow keys move the focused token one cell.
    const placed = root.querySelector<HTMLElement>('cockpit-combatant-chip.placed')!;
    placed.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle(fixture);
    expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({ positions: { 'c-mira': { x: 3, y: 2 } } });
  });

  it('shows stats and attacks in the tooltip of a creature', async () => {
    const calls = installServer({ battle: null, stats: { 'c-ogre': OGRE_STATS } });
    TestBed.inject(CockpitService).session.set(session([], COMBAT));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    chipByName(root, 'Ogre').dispatchEvent(new MouseEvent('mouseenter'));
    await settle(fixture);
    const tooltip = root.querySelector('.tooltip')?.textContent ?? '';
    expect(tooltip).toContain('AC');
    expect(tooltip).toContain('13');
    expect(tooltip).toContain('Claw');
    expect(tooltip).toContain('+5 to hit');
    expect(calls.some((call) => call.url === '/api/battle/stats/c-ogre')).toBe(true);
  });

  it('shows only name and initiative in the tooltip of a player character', async () => {
    const calls = installServer({ battle: null, stats: { 'c-mira': OGRE_STATS } });
    TestBed.inject(CockpitService).session.set(session([], COMBAT));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    chipByName(root, 'Mira').dispatchEvent(new MouseEvent('mouseenter'));
    await settle(fixture);
    const tooltip = root.querySelector('.tooltip')?.textContent ?? '';
    expect(tooltip).toContain('Mira');
    expect(tooltip).toContain('14');
    expect(tooltip).not.toContain('Claw');
    expect(calls.some((call) => call.url === '/api/battle/stats/c-mira')).toBe(false);
  });

  it('lists the combatants in initiative order when the battle map preference is off', async () => {
    installServer({ battle: MAP });
    TestBed.inject(PrefsService).setCampaign('test');
    TestBed.inject(BattleMapPrefs).set(false);
    TestBed.inject(CockpitService).session.set(session([], COMBAT));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('img.map-image')).toBeNull();
    const names = [...root.querySelectorAll('.list .row-name')].map((el) => el.textContent?.trim());
    expect(names).toEqual(['Mira', 'Ogre']);
  });

  it('shows the map image from the campaign file route when the preference is on', async () => {
    installServer({ battle: MAP });
    TestBed.inject(PrefsService).setCampaign('test');
    TestBed.inject(CockpitService).session.set(session([], COMBAT));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector<HTMLImageElement>('img.map-image')?.getAttribute('src')).toBe('/api/file?path=Maps%2Ftavern.png');
    expect(root.querySelector('.grid')).not.toBeNull();
  });

  it('asks the agent for the battle map when none is set and the preference is on', async () => {
    const calls = installServer({ battle: null });
    TestBed.inject(PrefsService).setCampaign('test');
    TestBed.inject(CockpitService).session.set(session([], COMBAT));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    root.querySelector<HTMLButtonElement>('.find-map')!.click();
    await settle(fixture);
    const message = calls.find((call) => call.url === '/api/cockpit/sessions/th1/messages');
    expect((message?.body as { text: string }).text).toBe('Find and set the battle map of the current place.');
  });

  it('fetches the battle map again when the state changes without a new revision', async () => {
    const server: { battle: BattleView | null } = { battle: null };
    const calls = installServer(server);
    TestBed.inject(PrefsService).setCampaign('test');
    const cockpit = TestBed.inject(CockpitService);
    cockpit.session.set(session([], COMBAT));
    const fixture = create();
    fixture.detectChanges();
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('img.map-image')).toBeNull();

    // The assistant saves the map: the server re-publishes the state with the same revision.
    server.battle = MAP;
    cockpit.stateTick.update((n) => n + 1);
    await settle(fixture);

    expect(calls.filter((call) => call.url === '/api/battle' && call.method === 'GET').length).toBe(2);
    expect(root.querySelector('img.map-image')).not.toBeNull();
  });
});

describe('CombatOverlayService', () => {
  it('opens by itself when a combat starts and stays closed once the master closes it', () => {
    const service = TestBed.inject(CombatOverlayService);
    service.sync('s1', false);
    expect(service.open()).toBe(false);
    service.sync('s1', true);
    expect(service.open()).toBe(true);
    service.close();
    service.sync('s1', true);
    expect(service.open()).toBe(false);
    service.sync('s1', false);
    service.sync('s1', true);
    expect(service.open()).toBe(true);
  });

  it('does not open for a combat that was already running when the session was switched to', () => {
    const service = TestBed.inject(CombatOverlayService);
    service.sync('s1', false);
    service.sync('s2', true);
    expect(service.open()).toBe(false);
  });
});
