import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchHit } from '@shared/types';
import { ApiService } from '../core/api.service';
import { DocNavService } from '../core/doc-nav.service';
import { Palette, PaletteController } from './palette';

const hits: SearchHit[] = [
  { path: 'characters/vell.md', title: 'Vell', snippet: 'The Duke of Vell.', masterOnly: false },
  { path: 'notes/secret.md', title: 'Secret notes', snippet: 'Vell is lying.', masterOnly: true },
];

describe('Palette', () => {
  let api: { search: ReturnType<typeof vi.fn>; docs: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    api = {
      search: vi.fn(async () => ({ query: 'vell', hits })),
      docs: vi.fn(async () => ({ docs: [] })),
    };
    TestBed.configureTestingModule({
      imports: [Palette],
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  async function openWithResults() {
    const fixture = TestBed.createComponent(Palette);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    component.onInput('vell');
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, component };
  }

  function press(fixture: { nativeElement: HTMLElement }, key: string, init: KeyboardEventInit = {}) {
    fixture.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  }

  it('moves the highlight with the arrow keys, wrapping at both ends', async () => {
    const { fixture, component } = await openWithResults();
    expect(component.entries()).toHaveLength(2);
    expect(component.cursor()).toBe(0);
    press(fixture, 'ArrowDown');
    expect(component.cursor()).toBe(1);
    press(fixture, 'ArrowDown');
    expect(component.cursor()).toBe(0);
    press(fixture, 'ArrowUp');
    expect(component.cursor()).toBe(1);
  });

  it('opens the highlighted document on Enter and closes the palette', async () => {
    const { fixture, component } = await openWithResults();
    const controller = TestBed.inject(PaletteController);
    controller.show();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    press(fixture, 'ArrowDown');
    press(fixture, 'Enter');
    expect(navigate).toHaveBeenCalledWith('/doc/notes/secret.md');
    expect(controller.open()).toBe(false);
    expect(component).toBeTruthy();
  });

  it('closes on Escape and keeps Tab inside the dialog', async () => {
    const { fixture } = await openWithResults();
    const controller = TestBed.inject(PaletteController);
    controller.show();
    press(fixture, 'Escape');
    expect(controller.open()).toBe(false);

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    const host: HTMLElement = fixture.nativeElement;
    const controls = host.querySelectorAll<HTMLElement>('input, a[href], button:not([disabled])');
    const first = controls[0];
    const last = controls[controls.length - 1];
    first.focus();
    // Tab from the last control wraps to the first, and Shift+Tab from the first wraps to the last.
    last.focus();
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    host.dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('lists favourites when the query is empty, before any search', async () => {
    const fixture = TestBed.createComponent(Palette);
    fixture.detectChanges();
    TestBed.inject(DocNavService).toggleFavourite('characters/vell.md');
    fixture.detectChanges();
    expect(fixture.componentInstance.entries()).toEqual([
      expect.objectContaining({ path: 'characters/vell.md', group: 'favourite' }),
    ]);
    expect(api.search).not.toHaveBeenCalled();
  });
});
