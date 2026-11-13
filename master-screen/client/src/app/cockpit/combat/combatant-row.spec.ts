import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatantStats, CombatRules } from '@shared/types';
import type { Combatant, CockpitSessionView } from '@shared/cockpit-types';
import { CockpitService } from '../cockpit.service';
import { I18n } from '../../i18n';
import { CombatantRow, hpAfterDamage, hpAfterHeal, parseAmount } from './combatant-row';

const OGRE_STATS: CombatantStats = {
  lines: [{ label: 'AC', value: '13' }],
  actions: [{ name: 'Claw', text: '+5 to hit, 1d6+3 slashing', group: 'attack', groupLabel: 'Attacks', timing: 'own_turn' }],
};

const OGRE: Combatant = { id: 'c-ogre', name: 'Ogre', kind: 'enemy', initiative: 9, hp: 20, maxHp: 30, conditions: ['Prone'], phase: 'Enraged' };
const MIRA: Combatant = { id: 'c-mira', name: 'Mira', kind: 'pc', initiative: 14, conditions: [] };

const RULES: CombatRules = {
  conditions: [
    { id: 'prone', label: 'Prone' },
    { id: 'stunned', label: 'Stunned' },
  ],
  durations: [
    { id: 'rounds', label: 'Rounds' },
    { id: 'until_removed', label: 'Until removed' },
  ],
};

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
function installServer(stats: CombatantStats = OGRE_STATS): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const payload = url.startsWith('/api/battle/stats/') ? stats : {};
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

  function create(combatant: Combatant, rules: CombatRules | null = RULES) {
    const fixture = TestBed.createComponent(CombatantRow);
    fixture.componentRef.setInput('combatant', combatant);
    fixture.componentRef.setInput('rules', rules);
    fixture.detectChanges();
    return fixture;
  }

  function setSelect(root: HTMLElement, label: string, value: string, fixture: ComponentFixture<CombatantRow>) {
    const select = root.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  /** Opens the add-condition picker with the + Condition button. */
  function openAdd(root: HTMLElement, fixture: ComponentFixture<CombatantRow>) {
    root.querySelector<HTMLButtonElement>('button.add-toggle')!.click();
    fixture.detectChanges();
  }

  function sentActions(calls: Call[]) {
    return calls.filter((call) => call.method === 'POST').map((call) => (call.body as { actions: unknown[] }).actions);
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

  it('shows the label and the duration of each condition from the rules', async () => {
    installServer();
    const fixture = create({
      ...OGRE,
      conditions: ['prone'],
      conditionDetails: [{ id: 'prone', duration: 'rounds', rounds: 2 }],
    });
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const pill = root.querySelector('.pill')?.textContent ?? '';
    expect(pill).toContain('Prone');
    expect(pill).toContain('Rounds');
    expect(pill).toContain('2 round');
  });

  it('removes a condition with a remove action when its × is pressed', async () => {
    const calls = installServer();
    const fixture = create({ ...OGRE, conditions: ['prone'] });
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    root.querySelector<HTMLButtonElement>('button[aria-label="Remove Prone"]')!.click();
    await settle(fixture);

    expect(sentActions(calls)).toEqual([[{ type: 'combat.condition', id: 'c-ogre', condition: 'prone', remove: true }]]);
  });

  it('adds a condition with the default duration until it is removed', async () => {
    const calls = installServer();
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    openAdd(root, fixture);
    const add = root.querySelector<HTMLButtonElement>('button.text-button')!;
    expect(add.disabled).toBe(false);
    add.click();
    await settle(fixture);

    expect(sentActions(calls)).toEqual([[{ type: 'combat.condition', id: 'c-ogre', condition: 'prone', duration: 'until_removed' }]]);
  });

  it('offers only the conditions the combatant does not have yet', async () => {
    installServer();
    const fixture = create({ ...OGRE, conditions: ['prone'] });
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    openAdd(root, fixture);
    const options = [...root.querySelectorAll<HTMLOptionElement>('select[aria-label="Condition to add"] option')];
    expect(options.map((option) => option.value)).toEqual(['stunned']);
  });

  it('adds a condition with its rounds only for the rounds duration', async () => {
    const calls = installServer();
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    openAdd(root, fixture);
    setSelect(root, 'Condition to add', 'stunned', fixture);
    setSelect(root, 'Duration', 'rounds', fixture);
    const rounds = root.querySelector<HTMLInputElement>('input.rounds')!;
    rounds.value = '3';
    rounds.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('button.text-button')!.click();
    await settle(fixture);

    expect(sentActions(calls)).toEqual([
      [{ type: 'combat.condition', id: 'c-ogre', condition: 'stunned', duration: 'rounds', rounds: 3 }],
    ]);
  });

  it('hides the rounds input for a duration without rounds', async () => {
    installServer();
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    openAdd(root, fixture);
    expect(root.querySelector('input.rounds')).toBeNull();
    setSelect(root, 'Duration', 'rounds', fixture);
    expect(root.querySelector('input.rounds')).not.toBeNull();
  });

  it('keeps the condition picker folded until the + Condition button opens it', async () => {
    installServer();
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('select[aria-label="Condition to add"]')).toBeNull();
    expect(root.querySelector('button.text-button')).toBeNull();
    const toggle = root.querySelector<HTMLButtonElement>('button.add-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(root.querySelector('select[aria-label="Condition to add"]')).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    fixture.detectChanges();
    expect(root.querySelector('select[aria-label="Condition to add"]')).toBeNull();
  });

  it('folds the condition picker on Escape and after a condition is added', async () => {
    const calls = installServer();
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    openAdd(root, fixture);
    root.querySelector<HTMLButtonElement>('button.add-toggle')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('select[aria-label="Condition to add"]')).toBeNull();

    openAdd(root, fixture);
    root.querySelector<HTMLButtonElement>('button.text-button')!.click();
    await settle(fixture);
    expect(sentActions(calls)).toHaveLength(1);
    expect(root.querySelector('select[aria-label="Condition to add"]')).toBeNull();
  });

  it('shows the hit points as a placeholder and no damage or heal controls when they are unknown', async () => {
    installServer();
    TestBed.inject(I18n).setLanguage('it');
    const fixture = create({ id: 'c-brann', name: 'Brann', kind: 'enemy', initiative: 5, conditions: [] });
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const hp = root.querySelector<HTMLElement>('.status .hp')!;
    expect(hp.textContent?.trim()).toBe('PF —');
    expect(hp.classList.contains('unknown')).toBe(true);
    expect(root.querySelector('input.amount')).toBeNull();
    expect(root.querySelector('button[aria-label="Infliggi danno"]')).toBeNull();
    expect(root.querySelector('button[aria-label="Cura"]')).toBeNull();
    // Defeat and remove stay: they do not need the hit points.
    expect(root.querySelectorAll('.controls ui-confirm-button').length).toBe(2);
  });

  it('shows the amount input with the short hit point placeholder and keeps its label', async () => {
    installServer();
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const amount = root.querySelector<HTMLInputElement>('input.amount')!;
    expect(amount.getAttribute('placeholder')).toBe('HP');
    expect(amount.getAttribute('aria-label')).toBe('Amount');
  });

  it('leaves the initiative out of the stat lines, since the row already shows it', async () => {
    installServer({ lines: [{ label: 'Initiative', value: '9' }, { label: 'AC', value: '13' }], actions: [] });
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect([...root.querySelectorAll('.line dt')].map((dt) => dt.textContent?.trim())).toEqual(['AC']);
    expect(root.querySelector('.row-meta')?.textContent).toContain('9');
  });

  it('shows the portrait of the sheet in place of the chip when the stats have artwork', async () => {
    installServer({ ...OGRE_STATS, image: '/api/file?path=Enemies%2Fogre.png' });
    const fixture = create(OGRE);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const portrait = root.querySelector<HTMLImageElement>('img.row-portrait');
    expect(portrait?.getAttribute('src')).toBe('/api/file?path=Enemies%2Fogre.png');
    expect(root.querySelector('cockpit-combatant-chip')).toBeNull();
  });

  it('marks the hp bar low when an enemy is at a quarter of its maximum or below', async () => {
    installServer();
    const fixture = create({ id: 'c-enemy', name: 'Goblin', kind: 'enemy', initiative: 7, hp: 5, maxHp: 31, conditions: [] });
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.hp-bar')?.classList.contains('low')).toBe(true);
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
