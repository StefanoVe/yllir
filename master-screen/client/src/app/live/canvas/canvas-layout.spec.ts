import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '@shared/types';
import { PrefsService } from '../../core/prefs.service';
import { LiveStateService } from '../live-api.service';
import { LiveCanvas } from './canvas';

const EMPTY_BOARD: Board = { revision: 0, cards: [], frames: [], arrows: [] };

describe('LiveCanvas toolbar layout', () => {
  let fixture: ComponentFixture<LiveCanvas>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LiveCanvas],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: LiveStateService, useValue: { board: signal<Board | null>(EMPTY_BOARD), saveBoard: vi.fn(async (board: Board) => board) } },
        { provide: PrefsService, useValue: { slug: signal<string | null>(null), get: () => null, set: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(LiveCanvas);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('keeps the toolbar in a bar above the pannable surface, so it never covers the cards', () => {
    const toolbar = el.querySelector('ms-live-canvas-toolbar') as HTMLElement;
    const viewport = el.querySelector('.viewport') as HTMLElement;
    expect(toolbar).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(toolbar.closest('.viewport')).toBeNull();
    expect(toolbar.closest('.bar')).not.toBeNull();
    expect(viewport.contains(toolbar)).toBe(false);
  });

  it('keeps an accessible name and a tooltip on every icon button', () => {
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('ms-live-canvas-toolbar button.tool')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.getAttribute('title')).toBeTruthy();
    }
  });
});
