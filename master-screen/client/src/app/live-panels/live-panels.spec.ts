import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Type } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatOp, Combatant, CombatState, DocResponse, LiveSnapshot, LogEntry, SearchResponse } from '@shared/types';
import { LiveActionsService, type LogInput, type LogPatch } from './live-actions.service';
import { LiveCombatComponent } from './live-combat';
import { LiveLogComponent } from './live-log';
import { LiveLookupComponent } from './live-lookup';

const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function combatant(id: string, name: string, extra: Partial<Combatant> = {}): Combatant {
  return { id, name, side: 'enemy', initiative: 10, hp: 20, hpMax: 24, conditions: [], resources: {}, ...extra };
}

function combatState(extra: Partial<CombatState> = {}): CombatState {
  return {
    active: true,
    round: 2,
    turn: 1,
    order: ['c-1', 'c-2'],
    combatants: [combatant('c-1', 'Mira', { side: 'pc' }), combatant('c-2', 'Brute')],
    events: [{ at: '2026-11-12T20:00:00.000Z', text: 'Mira starts the round.' }],
    revision: 3,
    ...extra,
  };
}

function snapshot(extra: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    session: { id: '2026-11-12', title: 'Harbour night', startedAt: '2026-11-12T19:00:00.000Z' },
    log: [],
    combat: null,
    board: { revision: 0, cards: [], frames: [], arrows: [] },
    revision: 'r1',
    ...extra,
  };
}

function entry(id: string, kind: LogEntry['kind'], extra: Partial<LogEntry> = {}): LogEntry {
  return { id, at: '2026-11-12T20:00:00.000Z', kind, text: `Note ${id}`, by: 'master', ...extra };
}

function fakeActions() {
  return {
    addLogEntry: vi.fn(async (_input: LogInput): Promise<LiveSnapshot> => snapshot()),
    updateLogEntry: vi.fn(async (_id: string, _patch: LogPatch): Promise<LiveSnapshot> => snapshot()),
    removeLogEntry: vi.fn(async (_id: string): Promise<LiveSnapshot> => snapshot()),
    combat: vi.fn(async (_op: CombatOp): Promise<LiveSnapshot> => snapshot()),
    searchDocs: vi.fn(async (query: string): Promise<SearchResponse> => ({ query, hits: [] })),
    readDoc: vi.fn(async (path: string): Promise<DocResponse> => ({ path, title: path, masterOnly: false, headings: [], blocks: [], backlinks: [] })),
  };
}

function setup<T>(component: Type<T>, actions: ReturnType<typeof fakeActions>): ComponentFixture<T> {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: LiveActionsService, useValue: actions }],
  });
  return TestBed.createComponent(component);
}

function render(fixture: ComponentFixture<unknown>): void {
  fixture.detectChanges();
}

describe('LiveCombatComponent', () => {
  let actions: ReturnType<typeof fakeActions>;
  let fixture: ComponentFixture<LiveCombatComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    actions = fakeActions();
    fixture = setup(LiveCombatComponent, actions);
    el = fixture.nativeElement as HTMLElement;
  });

  it('marks the turn on the right row, not by colour alone', async () => {
    fixture.componentRef.setInput('snapshot', snapshot({ combat: combatState({ turn: 1 }) }));
    render(fixture);
    await flush();
    const current = el.querySelector('[data-combatant-id="c-2"]') as HTMLElement;
    const other = el.querySelector('[data-combatant-id="c-1"]') as HTMLElement;
    expect(current.classList.contains('current')).toBe(true);
    expect(current.getAttribute('aria-current')).toBe('step');
    expect(other.classList.contains('current')).toBe(false);
    expect(current.querySelector('[aria-label="Current turn"]')).not.toBeNull();
  });

  it('offers to start the combat when none is running, and starts it with the start operation', async () => {
    fixture.componentRef.setInput('snapshot', snapshot({ combat: null }));
    render(fixture);
    await flush();
    const start = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Start combat'));
    expect(start).toBeDefined();
    start?.click();
    await flush();
    expect(actions.combat).toHaveBeenCalledWith({ op: 'start' });
  });

  it('adds a condition with the right operation', async () => {
    fixture.componentRef.setInput('snapshot', snapshot({ combat: combatState() }));
    render(fixture);
    await flush();
    openConditionForm(fixture, el, 'c-1');
    await flush();
    const form = el.querySelector('form.cond-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(actions.combat).toHaveBeenCalledWith({
      op: 'condition-add',
      id: 'c-1',
      condition: 'blinded',
      duration: 'until_removed',
    });
  });

  it('shows the server refusal inline, next to the row, and keeps the form open', async () => {
    actions.combat.mockRejectedValueOnce({ error: 'The rules do not know the condition "hungry".', status: 409 });
    fixture.componentRef.setInput('snapshot', snapshot({ combat: combatState() }));
    render(fixture);
    await flush();
    openConditionForm(fixture, el, 'c-1');
    await flush();
    (el.querySelector('form.cond-form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    render(fixture);
    const row = el.querySelector('[data-combatant-id="c-1"]') as HTMLElement;
    expect(row.querySelector('[role="alert"]')?.textContent).toContain('The rules do not know the condition "hungry".');
    expect(el.querySelector('form.cond-form')).not.toBeNull();
  });

  it('applies damage with Enter in the amount box', async () => {
    fixture.componentRef.setInput('snapshot', snapshot({ combat: combatState() }));
    render(fixture);
    await flush();
    const row = el.querySelector('[data-combatant-id="c-2"]') as HTMLElement;
    const box = row.querySelector('input.amount') as HTMLInputElement;
    box.value = '4';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(actions.combat).toHaveBeenCalledWith({ op: 'damage', id: 'c-2', amount: 4 });
  });

  it('moves to the next turn with N while the panel has focus', async () => {
    fixture.componentRef.setInput('snapshot', snapshot({ combat: combatState() }));
    render(fixture);
    await flush();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await flush();
    expect(actions.combat).toHaveBeenCalledWith({ op: 'next' });
  });
});

function openConditionForm(fixture: ComponentFixture<unknown>, el: HTMLElement, id: string): void {
  (el.querySelector(`button[data-trigger-for="${id}"]`) as HTMLButtonElement).click();
  fixture.detectChanges();
  const item = [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((n) => n.textContent?.includes('Add condition'));
  item?.click();
  fixture.detectChanges();
}

describe('LiveLogComponent', () => {
  let actions: ReturnType<typeof fakeActions>;
  let fixture: ComponentFixture<LiveLogComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    actions = fakeActions();
    fixture = setup(LiveLogComponent, actions);
    el = fixture.nativeElement as HTMLElement;
  });

  it('resolves an open thread with a PATCH of resolved', async () => {
    fixture.componentRef.setInput('snapshot', snapshot({ log: [entry('e-1', 'thread')] }));
    render(fixture);
    await flush();
    const resolve = el.querySelector('button[aria-label="Mark as resolved"]') as HTMLButtonElement;
    resolve.click();
    await flush();
    expect(actions.updateLogEntry).toHaveBeenCalledWith('e-1', { resolved: true });
  });

  it('shows the open threads pinned at the top and marks what the assistant added', async () => {
    fixture.componentRef.setInput(
      'snapshot',
      snapshot({ log: [entry('e-1', 'thread'), entry('e-2', 'fact', { by: 'agent' })] }),
    );
    render(fixture);
    await flush();
    const summary = el.querySelector('details.threads summary')?.textContent ?? '';
    expect(summary).toContain('(1)');
    expect(el.querySelector('.by')?.textContent?.trim()).toBe('assistant');
  });

  it('adds a note with Enter from the composer, with the chosen kind', async () => {
    fixture.componentRef.setInput('snapshot', snapshot({ log: [] }));
    render(fixture);
    await flush();
    const area = el.querySelector('textarea.input') as HTMLTextAreaElement;
    area.value = 'The gate opens';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(actions.addLogEntry).toHaveBeenCalledWith({ kind: 'fact', text: 'The gate opens' });
  });

  it('sends nothing for an empty note', async () => {
    fixture.componentRef.setInput('snapshot', snapshot({ log: [] }));
    render(fixture);
    await flush();
    const area = el.querySelector('textarea.input') as HTMLTextAreaElement;
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(actions.addLogEntry).not.toHaveBeenCalled();
  });
});

describe('LiveLookupComponent', () => {
  it('shows a snippet that looks like HTML as text, and highlights the query words', async () => {
    const actions = fakeActions();
    actions.searchDocs.mockResolvedValue({
      query: 'vell',
      hits: [{ path: 'characters/alia.md', title: 'Alia of Vell', snippet: '<img src=x onerror="alert(1)"> Vell keep', masterOnly: true }],
    });
    const fixture = setup(LiveLookupComponent, actions);
    const el = fixture.nativeElement as HTMLElement;
    render(fixture);
    const input = el.querySelector('input.field') as HTMLInputElement;
    input.value = 'vell';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(200);
    render(fixture);
    await flush();

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.row-snippet')?.textContent).toContain('<img src=x');
    expect(el.querySelector('mark')?.textContent).toBe('Vell');
    expect(el.querySelector('.row-title [role="img"]')).not.toBeNull();
  });

  it('puts a document drag onto the card type, as JSON', async () => {
    const actions = fakeActions();
    actions.searchDocs.mockResolvedValue({
      query: 'alia',
      hits: [{ path: 'characters/alia.md', title: 'Alia', snippet: '', masterOnly: false }],
    });
    const fixture = setup(LiveLookupComponent, actions);
    const el = fixture.nativeElement as HTMLElement;
    render(fixture);
    const input = el.querySelector('input.field') as HTMLInputElement;
    input.value = 'alia';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(200);
    render(fixture);
    await flush();

    const store = new Map<string, string>();
    const data = {
      effectAllowed: 'none',
      setData: (type: string, value: string) => store.set(type, value),
    } as unknown as DataTransfer;
    const handle = el.querySelector('.handle') as HTMLElement;
    const drag = new Event('dragstart', { bubbles: true });
    Object.defineProperty(drag, 'dataTransfer', { value: data });
    handle.dispatchEvent(drag);
    expect(JSON.parse(store.get('application/x-yllir-card') ?? 'null')).toEqual({ kind: 'document', path: 'characters/alia.md' });
  });
});
