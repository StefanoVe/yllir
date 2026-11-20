import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectorPage, tokenLabel } from './projector-page';
import { ProjectorService, type Projection, type ProjectedCombat } from './projector.service';
import { StatusService } from '../core/status.service';

const FIGHT: ProjectedCombat = {
  round: 3,
  order: [
    { id: 'c-mira', name: 'Mira Vell', side: 'pc', initiative: 14, current: false, hp: 18, hpMax: 24, tempHp: 4 },
    { id: 'c-ogre', name: 'Ogre', side: 'enemy', initiative: 9, current: true, health: 'wounded', hp: 5, hpMax: 30 },
    { id: 'c-goblin', name: 'Goblin Scout', side: 'enemy', initiative: 7, current: false, health: 'down', defeated: true },
    { id: 'c-tor', name: 'Tor', side: 'ally', initiative: 5, current: false, hp: 9, hpMax: 12 },
  ],
  map: null,
  positions: {},
};

describe('ProjectorPage', () => {
  let projection: WritableSignal<Projection>;

  beforeEach(() => {
    projection = signal<Projection>({ kind: 'blank' });
    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectorService, useValue: { current: projection } },
        { provide: StatusService, useValue: { campaign: signal({ name: 'Yllir' }) } },
      ],
    });
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(ProjectorPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the rest screen when no fight runs', () => {
    projection.set({ kind: 'combat', combat: null });
    const el = render();
    expect(el.querySelector('.fight')).toBeNull();
    expect(el.querySelector('.rest')?.textContent?.trim()).toBe('Yllir');
  });

  it('shows the round and one row per combatant in order', () => {
    projection.set({ kind: 'combat', combat: FIGHT });
    const el = render();
    expect(el.querySelector('.round')?.textContent?.trim()).toBe('Round 3');
    const names = [...el.querySelectorAll('.order li .name')].map((n) => n.textContent?.trim());
    expect(names).toEqual(['Mira Vell', 'Ogre', 'Goblin Scout', 'Tor']);
  });

  it('shows the health of enemies as a word, in English', () => {
    projection.set({ kind: 'combat', combat: FIGHT });
    const el = render();
    expect(el.querySelector('[data-health="wounded"]')?.textContent?.trim()).toBe('Wounded');
    expect(el.querySelector('[data-health="down"]')?.textContent?.trim()).toBe('Down');
  });

  it('shows no hit points for enemies, but hit points and temporary hit points for PCs', () => {
    projection.set({ kind: 'combat', combat: FIGHT });
    const el = render();
    const ogre = rowNamed(el, 'Ogre');
    expect(ogre.textContent).not.toContain('5/30');
    const mira = rowNamed(el, 'Mira Vell');
    expect(mira.textContent).toContain('18/24');
    expect(mira.textContent).toContain('+4 temp');
    expect(rowNamed(el, 'Tor').textContent).toContain('9/12');
  });

  it('highlights only the current row and marks it as current', () => {
    projection.set({ kind: 'combat', combat: FIGHT });
    const el = render();
    const current = el.querySelectorAll('.order li.current');
    expect(current.length).toBe(1);
    expect(current[0]?.textContent).toContain('Ogre');
    expect(current[0]?.getAttribute('aria-current')).toBe('true');
    expect(rowNamed(el, 'Tor').getAttribute('aria-current')).toBeNull();
  });

  it('dims and strikes through defeated rows', () => {
    projection.set({ kind: 'combat', combat: FIGHT });
    const el = render();
    const goblin = rowNamed(el, 'Goblin Scout');
    expect(goblin.classList.contains('defeated')).toBe(true);
    expect(rowNamed(el, 'Tor').classList.contains('defeated')).toBe(false);
  });

  it('shows no map and centres the order when the fight has no map', () => {
    projection.set({ kind: 'combat', combat: FIGHT });
    const el = render();
    expect(el.querySelector('.map-area')).toBeNull();
    expect(el.querySelector('.fight')?.classList.contains('with-map')).toBe(false);
  });

  it('places tokens on the grid cell centre and labels them with the initials', () => {
    projection.set({
      kind: 'combat',
      combat: {
        ...FIGHT,
        map: { src: '/maps/tavern.png', cols: 10, rows: 8 },
        positions: { 'c-ogre': { x: 0, y: 0 }, 'c-mira': { x: 9, y: 7 }, 'c-missing': { x: 1, y: 1 } },
      },
    });
    const el = render();
    expect(el.querySelector('.map-area')).not.toBeNull();
    const tokens = [...el.querySelectorAll<HTMLElement>('.token')];
    expect(tokens.length).toBe(2);
    const ogre = tokens.find((t) => t.getAttribute('aria-label') === 'Ogre');
    expect(ogre?.textContent?.trim()).toBe('O');
    expect(ogre?.style.left).toBe('5%');
    expect(ogre?.style.top).toBe('6.25%');
    expect(ogre?.classList.contains('current')).toBe(true);
    const mira = tokens.find((t) => t.getAttribute('aria-label') === 'Mira Vell');
    expect(mira?.textContent?.trim()).toBe('MV');
    expect(mira?.style.left).toBe('95%');
    expect(mira?.style.top).toBe('93.75%');
  });

  it('labels tokens with the first letters of the first two words', () => {
    expect(tokenLabel('Goblin Scout Captain')).toBe('GS');
    expect(tokenLabel('Ogre')).toBe('O');
    expect(tokenLabel('  ')).toBe('?');
  });
});

function rowNamed(root: HTMLElement, name: string): HTMLElement {
  const row = [...root.querySelectorAll<HTMLElement>('.order li')].find((li) => li.querySelector('.name')?.textContent?.trim() === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}
