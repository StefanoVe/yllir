import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocResponse, PlotResponse } from '@shared/types';
import { DocumentsService } from '../cockpit/support/documents.service';
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

const sheets = {
  sheets: [
    { path: 'sessions/1/main.md', title: 'The harbour', kind: 'session' },
    { path: 'sessions/1/arrival.md', title: 'The arrival', kind: 'scene', session: 's1' },
  ],
};

describe('PlotMapComponent', () => {
  let api: { load: ReturnType<typeof vi.fn>; sheets: ReturnType<typeof vi.fn> };
  let documents: { detail: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<PlotMapComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    api = {
      load: vi.fn(async () => data),
      sheets: vi.fn(async () => sheets),
    };
    documents = {
      detail: vi.fn(async (path: string) => ({ path, title: path, blocks: [], masterOnly: false }) as unknown as DocResponse),
    };
    TestBed.configureTestingModule({
      imports: [PlotMapComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: PlotApi, useValue: api },
        { provide: DocumentsService, useValue: documents },
      ],
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

  it('opens a clicked node in the popup instead of navigating to the reader', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    create();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    const node = el.querySelector<SVGGElement>('g.node[data-path="sessions/1/main.md"]');
    node?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    expect(fixture.componentInstance.sheet()).toEqual({ path: 'sessions/1/main.md' });
    expect(navigate).not.toHaveBeenCalled();
    expect(el.querySelector('cockpit-document-modal')).not.toBeNull();
  });

  it('gives the popup the ordered sheets so it can walk to the next one', async () => {
    create();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    el.querySelector<SVGGElement>('g.node[data-path="sessions/1/main.md"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    expect(el.querySelector('.sheet-position')?.textContent?.trim()).toBe('1 / 2');
  });

  it('keeps the map when the sheets list fails', async () => {
    api.sheets.mockRejectedValueOnce(new Error('offline'));
    create();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    expect(el.querySelectorAll('g.node')).toHaveLength(3);
    expect(el.querySelector('p[role="alert"]')).toBeNull();
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
