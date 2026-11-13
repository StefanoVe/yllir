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
