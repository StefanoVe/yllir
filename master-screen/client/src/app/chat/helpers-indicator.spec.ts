import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Turn, TurnStep } from '@shared/types';
import { HelpersIndicator } from './helpers-indicator';

const AT = '2026-11-13T10:00:00.000Z';

function helper(id: string, text: string, state: TurnStep['state'] = 'running'): TurnStep {
  return { id, kind: 'agent', text, at: AT, state };
}

function turn(state: Turn['state'], steps: TurnStep[]): Turn {
  return { id: 't1', messageId: 'm1', state, activity: '', startedAt: AT, steps };
}

describe('HelpersIndicator', () => {
  let fixture: ComponentFixture<HelpersIndicator>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(HelpersIndicator);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function show(value: Turn | null, compact = false): HTMLElement {
    fixture.componentRef.setInput('turn', value);
    fixture.componentRef.setInput('compact', compact);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function el(selector: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);
  }

  it('is hidden when no helper runs', () => {
    show(turn('running', [helper('a', 'Done one', 'done')]));
    expect(el('[role="status"]')).toBeNull();
    expect(fixture.nativeElement.classList.contains('is-empty')).toBe(true);
  });

  it('is hidden for a queued turn and for no turn', () => {
    show(turn('queued', [helper('a', 'Waiting')]));
    expect(el('[role="status"]')).toBeNull();
    show(null);
    expect(el('[role="status"]')).toBeNull();
  });

  it('shows the singular text and the one sentence of a single helper', () => {
    const root = show(turn('running', [helper('a', 'Scrive la scheda del mercante')]));
    const status = el('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector('.count')?.textContent?.trim()).toBe('1 assistant working');
    const items = root.querySelectorAll<HTMLElement>('.item');
    expect(items.length).toBe(1);
    expect(items[0].textContent?.trim()).toBe('Scrive la scheda del mercante');
    expect(items[0].getAttribute('title')).toBe('Scrive la scheda del mercante');
  });

  it('shows the plural text and one line per helper', () => {
    const root = show(turn('running', [helper('a', 'First'), helper('b', 'Second')]));
    expect(root.querySelector('.count')?.textContent?.trim()).toBe('2 assistants working');
    const items = Array.from(root.querySelectorAll<HTMLElement>('.item')).map((item) => item.textContent?.trim());
    expect(items).toEqual(['First', 'Second']);
    expect(root.querySelector('.list')?.getAttribute('aria-label')).toBe('Assistants working');
  });

  it('compact: shows only the icon and the count badge, with the sentences in the tooltip and hidden text', () => {
    const root = show(turn('running', [helper('a', 'First'), helper('b', 'Second')]), true);
    expect(root.querySelector('.badge')?.textContent?.trim()).toBe('2');
    expect(root.querySelector('.list')).toBeNull();
    expect(root.querySelector('.count')).toBeNull();
    expect(el('.badge-wrap')?.getAttribute('title')).toBe('First\nSecond');
    expect(el('.sr-only')?.textContent).toContain('2 assistants working');
    expect(el('.sr-only')?.textContent).toContain('Second');
  });

  it('compact: singular count in the hidden text', () => {
    show(turn('running', [helper('a', 'Only one')]), true);
    expect(el('.badge')?.textContent?.trim()).toBe('1');
    expect(el('.sr-only')?.textContent).toContain('1 assistant working');
  });
});
