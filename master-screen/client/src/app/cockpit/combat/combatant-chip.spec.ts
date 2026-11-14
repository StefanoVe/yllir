import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatantStats } from '@shared/types';
import type { Combatant } from '@shared/cockpit-types';
import { CombatantChip } from './combatant-chip';

const PORTRAIT = '/api/file?path=Enemies%2Fogre.png';

const OGRE_STATS: CombatantStats = {
  lines: [{ label: 'AC', value: '13' }],
  actions: [],
  image: PORTRAIT,
};

const OGRE: Combatant = { id: 'c-ogre', name: 'Ogre', kind: 'enemy', initiative: 9, hp: 20, maxHp: 30, conditions: [] };
const MIRA: Combatant = { id: 'c-mira', name: 'Mira', kind: 'pc', initiative: 14, conditions: [] };

interface Call {
  url: string;
}

function installServer(stats: CombatantStats): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push({ url });
      const body = url.startsWith('/api/battle/stats/') ? stats : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    }),
  );
  return calls;
}

async function settle(fixture: ComponentFixture<CombatantChip>) {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

function create(combatant: Combatant) {
  const fixture = TestBed.createComponent(CombatantChip);
  fixture.componentRef.setInput('combatant', combatant);
  fixture.detectChanges();
  return fixture;
}

describe('CombatantChip', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the portrait of a creature without a hover', async () => {
    const calls = installServer(OGRE_STATS);
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const img = root.querySelector<HTMLImageElement>('img.portrait');
    expect(img?.getAttribute('src')).toBe(PORTRAIT);
    expect(img?.getAttribute('alt')).toBe('');
    expect(root.querySelector('.initials')).toBeNull();
    expect(calls.some((call) => call.url === '/api/battle/stats/c-ogre')).toBe(true);
  });

  it('shows the initials when the sheet has no artwork', async () => {
    installServer({ ...OGRE_STATS, image: undefined });
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('img.portrait')).toBeNull();
    expect(root.querySelector('.initials')?.textContent).toContain('OG');
  });

  it('falls back to the initials when the portrait fails to load', async () => {
    installServer(OGRE_STATS);
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    root.querySelector<HTMLImageElement>('img.portrait')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(root.querySelector('img.portrait')).toBeNull();
    expect(root.querySelector('.initials')?.textContent).toContain('OG');
  });

  it('places the open tooltip inside the viewport, flipped above a token in the bottom right corner', async () => {
    installServer(OGRE_STATS);
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('token')) return rect(980, 730, 44, 44);
      if (this.classList.contains('tooltip')) return rect(0, 0, 200, 100);
      return rect(0, 0, 0, 0);
    });
    try {
      const fixture = create(MIRA);
      const root = fixture.nativeElement as HTMLElement;
      root.querySelector<HTMLButtonElement>('button.token')!.dispatchEvent(new Event('mouseenter'));
      await settle(fixture);
      const tip = root.querySelector<HTMLElement>('.tooltip')!;
      expect(tip.classList.contains('placed')).toBe(true);
      expect(tip.dataset['side']).toBe('top');
      expect(tip.style.top).toBe('622px');
      expect(tip.style.left).toBe('820px');
    } finally {
      spy.mockRestore();
    }
  });

  it('never fetches the stats or the image of a player character', async () => {
    const calls = installServer(OGRE_STATS);
    const fixture = create(MIRA);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('img.portrait')).toBeNull();
    expect(root.querySelector('.initials')?.textContent).toContain('MI');
    expect(calls.some((call) => call.url.startsWith('/api/battle/stats/'))).toBe(false);
  });
});
