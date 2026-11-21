import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * A stand-in for the browser's Image: decode() resolves at once, unless the test holds it, and then the test
 * releases or fails each held decode by its picture's address.
 */
class FakeImage {
  static holdDecode = false;
  static failDecode = false;
  static held: Array<{ src: string; resolve: () => void; reject: (error: Error) => void }> = [];
  src = '';
  complete = false;
  decode(): Promise<void> {
    if (FakeImage.failDecode) {
      this.complete = true;
      return Promise.reject(new Error('broken picture'));
    }
    if (!FakeImage.holdDecode) return Promise.resolve();
    return new Promise((resolve, reject) => FakeImage.held.push({ src: this.src, resolve, reject }));
  }
  addEventListener(): void {}
}

function releaseDecode(src: string): void {
  const index = FakeImage.held.findIndex((h) => h.src === src);
  if (index < 0) throw new Error(`no held decode for ${src}`);
  const [held] = FakeImage.held.splice(index, 1);
  held.resolve();
}

/** Lets pending promise callbacks of the preload run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The picture on screen: the layer that is shown (.on). */
function shownSrc(el: HTMLElement): string | null {
  return el.querySelector('.projection.on')?.getAttribute('src') ?? null;
}

describe('ProjectorPage', () => {
  let projection: WritableSignal<Projection>;
  let listen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    projection = signal<Projection>({ kind: 'blank' });
    listen = vi.fn();
    FakeImage.holdDecode = false;
    FakeImage.failDecode = false;
    FakeImage.held = [];
    vi.stubGlobal('Image', FakeImage);
    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectorService, useValue: { current: projection, listen } },
        { provide: StatusService, useValue: { campaign: signal({ name: 'Yllir' }) } },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts listening to the projector stream when it is created', () => {
    render();
    expect(listen).toHaveBeenCalledTimes(1);
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

  it('keeps the old image on screen until the new one has loaded, then switches', async () => {
    projection.set({ kind: 'image', src: '/a.png' });
    const fixture = TestBed.createComponent(ProjectorPage);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    TestBed.flushEffects();
    await settle();
    fixture.detectChanges();
    expect(shownSrc(el)).toBe('/a.png');

    FakeImage.holdDecode = true;
    projection.set({ kind: 'image', src: '/b.png' });
    fixture.detectChanges();
    TestBed.flushEffects();
    await settle();
    fixture.detectChanges();
    expect(FakeImage.held.map((h) => h.src)).toEqual(['/b.png']);
    expect(shownSrc(el)).toBe('/a.png');

    releaseDecode('/b.png');
    await settle();
    fixture.detectChanges();
    expect(shownSrc(el)).toBe('/b.png');
    expect(el.querySelectorAll('.projection.on')).toHaveLength(1);
  });

  it('drops a load that a newer request has overtaken', async () => {
    const fixture = TestBed.createComponent(ProjectorPage);
    const el = fixture.nativeElement as HTMLElement;
    FakeImage.holdDecode = true;
    projection.set({ kind: 'image', src: '/b.png' });
    fixture.detectChanges();
    TestBed.flushEffects();
    projection.set({ kind: 'image', src: '/c.png' });
    fixture.detectChanges();
    TestBed.flushEffects();
    await settle();

    releaseDecode('/b.png');
    await settle();
    fixture.detectChanges();
    expect(shownSrc(el)).toBeNull();

    releaseDecode('/c.png');
    await settle();
    fixture.detectChanges();
    expect(shownSrc(el)).toBe('/c.png');
  });

  it('still switches when the new picture fails to decode, and never throws', async () => {
    FakeImage.failDecode = true;
    projection.set({ kind: 'image', src: '/broken.png' });
    const fixture = TestBed.createComponent(ProjectorPage);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    TestBed.flushEffects();
    await settle();
    fixture.detectChanges();
    expect(shownSrc(el)).toBe('/broken.png');
  });

  it('clears the picture when the projection becomes something else', async () => {
    projection.set({ kind: 'image', src: '/a.png' });
    const fixture = TestBed.createComponent(ProjectorPage);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    TestBed.flushEffects();
    await settle();
    fixture.detectChanges();

    projection.set({ kind: 'combat', combat: null });
    fixture.detectChanges();
    TestBed.flushEffects();
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.projection')).toBeNull();
    expect(el.querySelector('.rest')).not.toBeNull();
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
