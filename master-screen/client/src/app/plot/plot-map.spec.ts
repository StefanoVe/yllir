import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocResponse, PlotResponse } from '@shared/types';
import { DocumentsService } from '../cockpit/support/documents.service';
import { PlotApi } from './plot-api';
import { PlotMapComponent } from './plot-map';
import { PLOT_DRAWER } from './plot-drawer';

const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const data: PlotResponse = {
  mermaid: 'flowchart TD\n  s1 --> sc1\n  s1 --> s2',
  missing: false,
  nodes: [
    { id: 's1', kind: 'session', title: 'The harbour', path: 'sessions/1/main.md', status: 'played' },
    { id: 'sc1', kind: 'scene', title: 'The arrival', path: 'sessions/1/arrival.md', status: 'ready' },
    { id: 's2', kind: 'session', title: 'The council', path: 'sessions/2/main.md', status: 'waiting' },
  ],
};

const sheets = {
  sheets: [
    { path: 'sessions/1/main.md', title: 'The harbour', kind: 'session' },
    { path: 'sessions/1/arrival.md', title: 'The arrival', kind: 'scene', session: 's1' },
  ],
};

/** The SVG mermaid would draw: one group per node, named the way mermaid names them. */
function drawnSvg(): SVGSVGElement {
  const box = document.createElement('div');
  box.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
    '<g class="node default played" id="flowchart-s1-0"></g>' +
    '<g class="node default ready" id="flowchart-sc1-0"></g>' +
    '<g class="node default waiting" id="flowchart-s2-0"></g>' +
    '</svg>';
  return box.querySelector('svg') as SVGSVGElement;
}

describe('PlotMapComponent', () => {
  let api: { load: ReturnType<typeof vi.fn>; sheets: ReturnType<typeof vi.fn> };
  let documents: { detail: ReturnType<typeof vi.fn> };
  // mermaid is not run in the tests: the drawn SVG is a fixture with one group per node id.
  let drawer: { render: ReturnType<typeof vi.fn>; decorate: ReturnType<typeof vi.fn> };
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
    drawer = {
      render: vi.fn(async () => drawnSvg()),
      decorate: vi.fn(() => ({ width: 400, height: 300 })),
    };
    TestBed.configureTestingModule({
      imports: [PlotMapComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: PlotApi, useValue: api },
        { provide: PLOT_DRAWER, useValue: drawer },
        { provide: DocumentsService, useValue: documents },
      ],
    });
  });

  function create(): void {
    fixture = TestBed.createComponent(PlotMapComponent);
    el = fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
  }

  it('shows a legend for the arrows and for the three statuses', async () => {
    create();
    await settle();
    const legend = el.querySelector('ul.legend')?.textContent ?? '';
    expect(legend).toContain('Solid arrow: needs');
    expect(legend).toContain('Dashed line: just follows in the file');
    expect(legend).toContain('Ticked and shaded: already played.');
    expect(legend).toContain('Thick outline: ready to play next.');
    expect(legend).toContain('Dashed outline: waiting for something first.');
    expect(el.querySelectorAll('ul.legend .sample-shape')).toHaveLength(3);
  });

  it('draws the map from the server source with the app theme', async () => {
    create();
    await settle();
    expect(drawer.render).toHaveBeenCalledWith(data.mermaid, expect.stringMatching(/^(dark|default)$/));
    expect(drawer.decorate).toHaveBeenCalled();
    expect(el.querySelector('.canvas svg')).not.toBeNull();
  });

  it('makes every drawn node a keyboard-reachable link with its status in the label', async () => {
    create();
    await settle();
    const nodes = [...el.querySelectorAll<SVGGElement>('g.node')];
    expect(nodes).toHaveLength(3);
    expect(nodes.every((node) => node.getAttribute('tabindex') === '0')).toBe(true);
    const played = el.querySelector('g.node[data-path="sessions/1/main.md"]');
    expect(played?.getAttribute('aria-label')).toContain('Status: Played');
  });

  it('gives screen readers a text list with each node and its status', async () => {
    create();
    await settle();
    const items = [...el.querySelectorAll('section.sr-only li')].map((li) => li.textContent ?? '');
    expect(items).toHaveLength(3);
    expect(items.find((text) => text.startsWith('The arrival'))).toContain('Status: Ready');
  });

  it('opens a clicked node in the popup instead of navigating to the reader', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    create();
    await settle();
    el.querySelector<SVGGElement>('g.node[data-path="sessions/1/main.md"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(fixture.componentInstance.sheet()).toEqual({ path: 'sessions/1/main.md' });
    expect(navigate).not.toHaveBeenCalled();
    expect(el.querySelector('cockpit-document-modal')).not.toBeNull();
  });

  it('opens the node on Enter from the keyboard', async () => {
    create();
    await settle();
    const node = el.querySelector<SVGGElement>('g.node[data-path="sessions/2/main.md"]');
    node?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(fixture.componentInstance.sheet()).toEqual({ path: 'sessions/2/main.md' });
  });

  it('gives the popup the ordered sheets so it can walk to the next one', async () => {
    create();
    await settle();
    el.querySelector<SVGGElement>('g.node[data-path="sessions/1/main.md"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(el.querySelector('.sheet-position')?.textContent?.trim()).toBe('1 / 2');
  });

  it('keeps the map when the sheets list fails', async () => {
    api.sheets.mockRejectedValueOnce(new Error('offline'));
    create();
    await settle();
    expect(el.querySelectorAll('g.node')).toHaveLength(3);
    expect(el.querySelector('p[role="alert"]')).toBeNull();
  });

  it('shows the assistant message and no map when the plot file is missing', async () => {
    api.load.mockResolvedValueOnce({ mermaid: '', missing: true, nodes: [] });
    create();
    await settle();
    expect(el.textContent).toContain('The plot map is drawn by the assistant after the next session work.');
    expect(drawer.render).not.toHaveBeenCalled();
    expect(el.querySelector('.viewport')?.hasAttribute('hidden')).toBe(true);
    expect(el.querySelector('ul.legend')).toBeNull();
  });

  it('shows an empty state when there are no sessions', async () => {
    api.load.mockResolvedValueOnce({ mermaid: '', missing: false, nodes: [] });
    create();
    await settle();
    expect(el.textContent).toContain('No sessions yet');
    expect(el.querySelector('ul.legend')).toBeNull();
  });

  it('says so in plain words when the map source cannot be drawn', async () => {
    drawer.render.mockRejectedValueOnce(new Error('Parse error'));
    create();
    await settle();
    expect(el.querySelector('p[role="alert"]')?.textContent).toContain('could not be drawn');
    expect(el.querySelector('.viewport')?.hasAttribute('hidden')).toBe(true);
  });
});
