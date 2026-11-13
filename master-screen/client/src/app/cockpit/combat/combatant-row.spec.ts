import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatantStats } from '@shared/types';
import type { Combatant, CockpitSessionView } from '@shared/cockpit-types';
import { CockpitService } from '../cockpit.service';
import { CombatantRow, hpAfterDamage, hpAfterHeal, parseAmount } from './combatant-row';

const OGRE_STATS: CombatantStats = {
  lines: [{ label: 'AC', value: '13' }],
  actions: [{ name: 'Claw', text: '+5 to hit, 1d6+3 slashing' }],
};

const OGRE: Combatant = { id: 'c-ogre', name: 'Ogre', kind: 'enemy', initiative: 9, hp: 20, maxHp: 30, conditions: ['Prone'], phase: 'Enraged' };
const MIRA: Combatant = { id: 'c-mira', name: 'Mira', kind: 'pc', initiative: 14, conditions: [] };

function session(): CockpitSessionView {
  return {
    id: 's1',
    title: 'Session one',
    createdAt: '',
    updatedAt: '',
    revision: 1,
    provider: 'claude',
    model: 'claude-sonnet-5-5',
    state: {
      position: { location: '', moment: '', summary: '' },
      party: [],
      board: { modules: [], frames: [], links: [], highlightId: null },
      ledger: [],
      combat: null,
    },
    messages: [],
    turns: [],
    history: [],
  } as CockpitSessionView;
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Records every request; the stats endpoint answers with the Ogre's sheet. */
function installServer(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const payload = url.startsWith('/api/battle/stats/') ? OGRE_STATS : {};
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }));
    }),
  );
  return calls;
}

async function settle(fixture: ComponentFixture<CombatantRow>) {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

describe('CombatantRow', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('EventSource', class { close() {} });
    TestBed.inject(CockpitService).session.set(session());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function create(combatant: Combatant) {
    const fixture = TestBed.createComponent(CombatantRow);
    fixture.componentRef.setInput('combatant', combatant);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the stats and every attack of an enemy without a hover', async () => {
    const calls = installServer();
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.status .hp')?.textContent).toContain('20/30');
    expect(root.querySelector('.pill')?.textContent).toContain('Prone');
    expect(root.querySelector('.phase')?.textContent).toContain('Enraged');
    expect(root.querySelector('.line')?.textContent).toContain('AC');
    expect(root.querySelector('.line')?.textContent).toContain('13');
    expect(root.querySelector('.actions')?.textContent).toContain('Claw');
    expect(root.querySelector('.actions')?.textContent).toContain('+5 to hit');
    expect(calls.some((call) => call.url === '/api/battle/stats/c-ogre')).toBe(true);
  });

  it('shows only name and initiative for a player character and never fetches its stats', async () => {
    const calls = installServer();
    const fixture = create(MIRA);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.row-name')?.textContent).toContain('Mira');
    expect(root.querySelector('.row-meta')?.textContent).toContain('14');
    expect(root.querySelector('.controls')).toBeNull();
    expect(root.querySelector('.actions')).toBeNull();
    expect(calls.some((call) => call.url.startsWith('/api/battle/stats/'))).toBe(false);
  });

  it('damage sends the hit points clamped at zero', async () => {
    const calls = installServer();
    const fixture = create({ ...OGRE, hp: 3 });
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const amount = root.querySelector<HTMLInputElement>('input.amount')!;
    amount.value = '5';
    amount.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('button[aria-label="Deal damage"]')!.click();
    await settle(fixture);

    const sent = calls.filter((call) => call.url === '/api/cockpit/sessions/s1/actions');
    expect(sent).toEqual([
      { url: '/api/cockpit/sessions/s1/actions', method: 'POST', body: { actions: [{ type: 'combat.update', id: 'c-ogre', patch: { hp: 0 } }] } },
    ]);
  });

  it('heal stops at the maximum hit points', async () => {
    const calls = installServer();
    const fixture = create({ ...OGRE, hp: 28 });
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const amount = root.querySelector<HTMLInputElement>('input.amount')!;
    amount.value = '10';
    amount.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('button[aria-label="Heal"]')!.click();
    await settle(fixture);

    expect(calls.filter((call) => call.method === 'POST').at(-1)?.body).toEqual({
      actions: [{ type: 'combat.update', id: 'c-ogre', patch: { hp: 30 } }],
    });
  });

  it('keeps the damage buttons disabled without a whole amount', async () => {
    installServer();
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const damage = root.querySelector<HTMLButtonElement>('button[aria-label="Deal damage"]')!;
    expect(damage.disabled).toBe(true);
    const amount = root.querySelector<HTMLInputElement>('input.amount')!;
    amount.value = '2';
    amount.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(damage.disabled).toBe(false);
  });

  it('a defeated creature is struck through and dimmed', async () => {
    installServer();
    const fixture = create({ ...OGRE, hp: 0 });
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.row')?.classList.contains('defeated')).toBe(true);
  });
});

describe('combatant row helpers', () => {
  it('clamps damage at zero and heals up to the maximum', () => {
    expect(hpAfterDamage(3, 5)).toBe(0);
    expect(hpAfterDamage(10, 4)).toBe(6);
    expect(hpAfterHeal(28, 10, 30)).toBe(30);
    expect(hpAfterHeal(4, 3)).toBe(7);
  });

  it('reads an amount as a whole number of at least one', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('2,7')).toBe(2);
    expect(parseAmount(' 4 ')).toBe(4);
  });
});
