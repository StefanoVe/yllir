import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LivePlayer } from '@shared/types';
import { CockpitService } from '../cockpit.service';
import { InitiativeStep } from './initiative-step';
import type { FightCard } from './combat-model';

const OGRE: FightCard = { cardId: 'c-ogre', name: 'Ogre', path: 'Enemies/Ogre.md', kind: 'enemy' };
const BRANN: FightCard = { cardId: 'c-brann', name: 'Brann', path: 'NPCs/Brann.md', kind: 'npc' };
const PLAYERS: LivePlayer[] = [
  { name: 'Mira', ref: 'Players/Mira.md' },
  { name: 'Tor', ref: 'Players/Tor.md' },
];

function create(options: { players?: LivePlayer[]; cards?: FightCard[]; clicked?: FightCard | null } = {}) {
  const fixture = TestBed.createComponent(InitiativeStep);
  fixture.componentRef.setInput('players', options.players ?? []);
  fixture.componentRef.setInput('cards', options.cards ?? []);
  fixture.componentRef.setInput('clicked', options.clicked ?? null);
  fixture.detectChanges();
  return fixture;
}

function rowOf(root: HTMLElement, name: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('.row')].find(
    (row) => row.querySelector('.name')?.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no row for ${name}`);
  return found;
}

function setNumber(root: HTMLElement, name: string, value: string) {
  const input = root.querySelector<HTMLInputElement>(`input[aria-label="Initiative of ${name}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

/** The order preview as "name initiative" strings, in display order. */
function previewLines(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('.tile')].map(
    (tile) => `${tile.querySelector('.tile-name')?.textContent?.trim()} ${tile.querySelector('.tile-init')?.textContent?.trim()}`,
  );
}

function startButton(root: HTMLElement): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('button.primary')!;
}

describe('Initiative step', () => {
  let action: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    action = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(TestBed.inject(CockpitService), 'action').mockImplementation(action as never);
  });

  /** Submits the form the way the start button does, then returns the actions sent in one call. */
  async function start(root: HTMLElement) {
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { actions: action.mock.calls.at(-1) ?? [] };
  }

  it('shows the order of the ticked participants by initiative, missing ones last, and updates as the master types', () => {
    const fixture = create({ players: PLAYERS, clicked: OGRE, cards: [OGRE] });
    const root = fixture.nativeElement as HTMLElement;
    setNumber(root, 'Mira', '9');
    setNumber(root, 'Ogre', '14');
    fixture.detectChanges();
    expect(previewLines(root)).toEqual(['Ogre 14', 'Mira 9', 'Tor —']);

    setNumber(root, 'Tor', '11');
    fixture.detectChanges();
    expect(previewLines(root)).toEqual(['Ogre 14', 'Tor 11', 'Mira 9']);

    setNumber(root, 'Ogre', '');
    fixture.detectChanges();
    expect(previewLines(root)).toEqual(['Tor 11', 'Mira 9', 'Ogre —']);
  });

  it('keeps an unticked creature out of the preview and out of the sent participants', async () => {
    const fixture = create({ players: [PLAYERS[0]!], clicked: OGRE, cards: [OGRE, BRANN] });
    const root = fixture.nativeElement as HTMLElement;
    setNumber(root, 'Mira', '10');
    setNumber(root, 'Ogre', '12');
    rowOf(root, 'Brann').querySelector<HTMLInputElement>('.tick')!.click();
    fixture.detectChanges();
    setNumber(root, 'Brann', '15');
    rowOf(root, 'Ogre').querySelector<HTMLInputElement>('.tick')!.click();
    fixture.detectChanges();

    expect(previewLines(root)).toEqual(['Brann 15', 'Mira 10']);
    const payload = await start(root);
    expect(payload).toEqual({
      actions: [
        {
          type: 'combat.start',
          title: 'Combat: Ogre',
          participants: [
            { name: 'Mira', kind: 'pc', initiative: 10, conditions: [], source: { path: 'Players/Mira.md' } },
            { name: 'Brann', kind: 'enemy', initiative: 15, conditions: [], source: { path: 'NPCs/Brann.md' } },
          ],
        },
      ],
    });
  });

  it('changes the kind sent with the ally or enemy segmented control', async () => {
    const fixture = create({ clicked: OGRE, cards: [OGRE] });
    const root = fixture.nativeElement as HTMLElement;
    const row = rowOf(root, 'Ogre');
    expect(row.querySelector('button.side[data-side="enemy"]')?.getAttribute('aria-pressed')).toBe('true');

    row.querySelector<HTMLButtonElement>('button.side[data-side="ally"]')!.click();
    fixture.detectChanges();
    expect(rowOf(root, 'Ogre').querySelector('button.side[data-side="ally"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(rowOf(root, 'Ogre').querySelector('button.side[data-side="enemy"]')?.getAttribute('aria-pressed')).toBe('false');
    setNumber(root, 'Ogre', '5');

    const payload = (await start(root)) as { actions: Array<{ participants: Array<{ kind: string }> }> };
    expect(payload.actions[0]!.participants.map((p) => p.kind)).toEqual(['ally']);
  });

  it('adds a player character typed in the step and sends it as a pc with its initiative', async () => {
    const fixture = create({ clicked: OGRE, cards: [OGRE] });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.add-pc')).not.toBeNull();

    const name = root.querySelector<HTMLInputElement>('input[aria-label="Character name"]')!;
    name.value = 'Vel';
    name.dispatchEvent(new Event('input'));
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(action).not.toHaveBeenCalled();

    expect(rowOf(root, 'Vel')).toBeTruthy();
    setNumber(root, 'Vel', '17');
    setNumber(root, 'Ogre', '8');

    const payload = (await start(root)) as { actions: Array<{ participants: unknown[] }> };
    expect(payload.actions[0]!.participants).toEqual([
      { name: 'Vel', kind: 'pc', initiative: 17, conditions: [] },
      { name: 'Ogre', kind: 'enemy', initiative: 8, conditions: [], source: { path: 'Enemies/Ogre.md' } },
    ]);
  });

  it('disables the start button with nobody ticked and shows the count of the ticked ones', () => {
    const fixture = create({ players: PLAYERS, cards: [OGRE] });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.add-pc')).not.toBeNull();
    rowOf(root, 'Mira').querySelector<HTMLInputElement>('.tick')!.click();
    rowOf(root, 'Tor').querySelector<HTMLInputElement>('.tick')!.click();
    fixture.detectChanges();
    expect(startButton(root).disabled).toBe(true);
    expect(startButton(root).textContent?.trim()).toBe('Start the fight · 0');

    rowOf(root, 'Mira').querySelector<HTMLInputElement>('.tick')!.click();
    fixture.detectChanges();
    expect(startButton(root).disabled).toBe(false);
    expect(startButton(root).textContent?.trim()).toBe('Start the fight · 1');

    rowOf(root, 'Tor').querySelector<HTMLInputElement>('.tick')!.click();
    fixture.detectChanges();
    expect(startButton(root).textContent?.trim()).toBe('Start the fight · 2');
  });

  it('is disabled with no players and no creature ticked', () => {
    const fixture = create();
    expect(startButton(fixture.nativeElement as HTMLElement).disabled).toBe(true);
  });
});
