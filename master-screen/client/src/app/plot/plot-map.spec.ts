import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlotResponse } from '@shared/types';
import { PlotApi } from './plot-api';
import { PlotMapComponent } from './plot-map';

const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const data: PlotResponse = {
  nodes: [
    { id: 's1', kind: 'session', title: 'The harbour', path: 'sessions/1/main.md', status: 'done' },
    { id: 'sc1', kind: 'scene', title: 'The arrival', path: 'sessions/1/arrival.md' },
    { id: 's2', kind: 'session', title: 'The council', path: 'sessions/2/main.md' },
  ],
  // from = the prerequisite, to = the item that needs it (server semantics).
  edges: [
    { from: 's1', to: 'sc1', kind: 'depends' },
    { from: 's1', to: 's2', kind: 'depends' },
    { from: 'sc1', to: 's2', kind: 'order' },
  ],
};

describe('PlotMapComponent', () => {
  let api: { load: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<PlotMapComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    api = { load: vi.fn(async () => data) };
    TestBed.configureTestingModule({
      imports: [PlotMapComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: PlotApi, useValue: api }],
    });
  });

  function create(): void {
    fixture = TestBed.createComponent(PlotMapComponent);
    el = fixture.nativeElement as HTMLElement;
  }

  it('shows a legend that explains solid arrows and dashed lines', async () => {
    create();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    const legend = el.querySelector('ul.legend')?.textContent ?? '';
    expect(legend).toContain('Solid arrow: needs');
    expect(legend).toContain('Dashed line: just follows in the file');
    expect(el.querySelectorAll('path.edge.depends').length).toBe(2);
    expect(el.querySelectorAll('path.edge.order').length).toBe(1);
  });

  it('renders every node as a keyboard-reachable link with its status in the tooltip', async () => {
    create();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    const nodes = [...el.querySelectorAll<SVGGElement>('g.node')];
    expect(nodes).toHaveLength(3);
    expect(nodes.every((node) => node.getAttribute('tabindex') === '0')).toBe(true);
    const done = el.querySelector('g.node[data-path="sessions/1/main.md"]');
    expect(done?.querySelector('title')?.textContent).toContain('Status: done');
  });

  it('gives screen readers a text list with each node and what it needs', async () => {
    create();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    const items = [...el.querySelectorAll('section.sr-only li')].map((li) => li.textContent ?? '');
    expect(items).toHaveLength(3);
    expect(items.find((text) => text.startsWith('The arrival'))).toContain('Needs: The harbour');
    expect(items.find((text) => text.startsWith('The harbour'))).toContain('Needs nothing');
  });

  it('shows an empty state when there are no sessions', async () => {
    api.load.mockResolvedValueOnce({ nodes: [], edges: [] });
    create();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    expect(el.textContent).toContain('No sessions yet');
    expect(el.querySelector('ul.legend')).toBeNull();
  });
});
