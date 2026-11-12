import { TestBed } from '@angular/core/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleView, CombatantStats } from '@shared/types';
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

const OGRE_STATS: CombatantStats = {
  lines: [{ label: 'AC', value: '13' }],
  actions: [{ name: 'Claw', text: '+5 to hit, 1d6+3 slashing' }],
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
      if (url === '/api/battle/players')
        return json({ players: [{ name: 'Mira', ref: 'Players/Mira.md' }, { name: 'Tor', ref: 'Players/Tor.md' }] });
      if (url === '/api/battle' && (method === 'GET' || method === 'PUT')) return json(options.battle);
      const stat = url.match(/^\/api\/battle\/stats\/(.+)$/);
      if (stat && method === 'GET') {
        const found = options.stats?.[decodeURIComponent(stat[1]!)];
        return found ? json(found) : json({ error: 'not found' }, 404);
      }
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
    const creatureBoxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect([...creatureBoxes].map((box) => box.checked)).toEqual([true, false, false]);

    setNumber(root.querySelector<HTMLInputElement>('input[aria-label="Initiative of Mira"]')!, '14');
    setNumber(root.querySelector<HTMLInputElement>('input[aria-label="Initiative of Kaelen"]')!, '12');
    creatureBoxes[1]!.click(); // Ogre
    creatureBoxes[2]!.click(); // Brann
    await settle(fixture);
    root.querySelectorAll<HTMLButtonElement>('button.side')[2]!.click(); // Brann becomes an ally
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
    expect(calls.some((call) => call.url.startsWith('/api/battle/stats/'))).toBe(false);
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
    const message = calls.find((call) => call.url === '/api/cockpit/sessions/s1/messages');
    expect((message?.body as { text: string }).text).toBe('Find and set the battle map of the current place.');
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
