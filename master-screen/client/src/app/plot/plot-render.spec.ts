import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlotFlowNode } from '@shared/types';
import { SCENE_SIZE, SESSION_SIZE, decoratePlot, matchesGroup } from './plot-render';

const nodes: PlotFlowNode[] = [
  { id: 's1', kind: 'session', title: 'The harbour', path: 'sessions/1/main.md', status: 'played' },
  { id: 'sc1', kind: 'scene', title: 'The arrival with a very long title that keeps going', path: 'sessions/1/arrival.md' },
];

const kindText = (kind: PlotFlowNode['kind']) => (kind === 'session' ? 'Session' : 'Scene');

/** Mermaid's output for two nodes, a cluster, a solid and a dashed edge. */
function mermaidFixture(): SVGSVGElement {
  const box = document.createElement('div');
  box.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
    '<style>#x .node rect { fill: red; }</style>' +
    '<defs><marker id="flowchart-pointEnd"><path/></marker></defs>' +
    '<g class="cluster" id="flowchart-arc-3"><rect style="fill:red" x="0" y="0" width="300" height="200"/>' +
    '<g class="cluster-label"><text style="fill:black">Arc one</text></g></g>' +
    '<g class="node default played" id="flowchart-s1-0" style="fill:#d9d9d9">' +
    '<rect class="label-container" x="-50" y="-20" width="100" height="40"/><g class="label"><text>The harbour</text></g></g>' +
    '<g class="node default" id="flowchart-sc1-1"><rect class="label-container" x="-40" y="-20" width="80" height="40"/></g>' +
    '<g class="edgePaths">' +
    '<path class="flowchart-link LS-s1 LE-sc1 edge-pattern-solid" d="M0 0" marker-end="url(#flowchart-pointEnd)" style="stroke:red"/>' +
    '<path class="flowchart-link LS-sc1 LE-s1 edge-pattern-dashed" d="M0 0" marker-end="url(#flowchart-pointEnd)"/>' +
    '</g></svg>';
  return box.querySelector('svg') as SVGSVGElement;
}

describe('plot-render', () => {
  beforeEach(() => {
    // jsdom has no layout: every shape measures as a 100 x 40 box centred on the origin.
    (Element.prototype as unknown as { getBBox: () => unknown }).getBBox = () => ({ x: -50, y: -20, width: 100, height: 40 });
  });

  afterEach(() => {
    delete (Element.prototype as unknown as { getBBox?: unknown }).getBBox;
  });

  it('matches a mermaid group id to its flowchart id only', () => {
    expect(matchesGroup('flowchart-s1-0', 's1')).toBe(true);
    expect(matchesGroup('flowchart-s10-0', 's1')).toBe(false);
    expect(matchesGroup('flowchart-s1-0', 's1.x')).toBe(false);
  });

  it('draws every node as the old card of its kind, centred where mermaid drew it', () => {
    const svg = mermaidFixture();
    decoratePlot(svg, nodes, kindText);
    const session = svg.querySelector<SVGGElement>('g.node[id="flowchart-s1-0"]');
    const card = session?.querySelector('rect.card');
    expect(session?.classList.contains('session')).toBe(true);
    expect(card?.getAttribute('width')).toBe(String(SESSION_SIZE.w));
    expect(card?.getAttribute('height')).toBe(String(SESSION_SIZE.h));
    expect(card?.getAttribute('x')).toBe(String(0 - SESSION_SIZE.w / 2));
    expect(card?.getAttribute('rx')).toBe('12');
    expect(session?.querySelector('text.kind-label')?.textContent).toBe('Session');
    expect(session?.querySelector('text.title-label')?.textContent).toBe('The harbour');
    const scene = svg.querySelector<SVGGElement>('g.node[id="flowchart-sc1-1"]');
    expect(scene?.querySelector('rect.card')?.getAttribute('width')).toBe(String(SCENE_SIZE.w));
    expect(scene?.querySelector('text.title-label')?.textContent?.length).toBe(28);
    expect(scene?.querySelector('text.title-label')?.textContent?.endsWith('…')).toBe(true);
  });

  it('shows a tick for a played session and no icon for a node without status', () => {
    const svg = mermaidFixture();
    decoratePlot(svg, nodes, kindText);
    expect(svg.querySelector('g.node[id="flowchart-s1-0"] .status path')).not.toBeNull();
    expect(svg.querySelector('g.node[id="flowchart-s1-0"] .status circle')).toBeNull();
    expect(svg.querySelector('g.node[id="flowchart-sc1-1"] .status')).toBeNull();
  });

  it('removes mermaid styles and the torn-paper shapes', () => {
    const svg = mermaidFixture();
    decoratePlot(svg, nodes, kindText);
    expect(svg.querySelector('style')).toBeNull();
    // The root keeps its own max-width style; no drawn element may carry mermaid's inline style.
    expect(Array.from(svg.querySelectorAll('[style]')).filter((el) => el !== svg)).toHaveLength(0);
    expect(svg.querySelector('path.plot-shape')).toBeNull();
    expect(svg.querySelector('.plot-mark')).toBeNull();
  });

  it('turns dependencies into arrows and dashed file order into plain dashed lines', () => {
    const svg = mermaidFixture();
    decoratePlot(svg, nodes, kindText);
    const depends = svg.querySelector('path.edge.depends');
    const order = svg.querySelector('path.edge.order');
    expect(depends?.getAttribute('data-from')).toBe('s1');
    expect(depends?.getAttribute('data-to')).toBe('sc1');
    expect(depends?.getAttribute('marker-end')).toBe('url(#plot-arrow)');
    expect(order?.getAttribute('data-from')).toBe('sc1');
    expect(order?.hasAttribute('marker-end')).toBe(false);
    expect(svg.querySelector('marker#plot-arrow path.arrow-head')).not.toBeNull();
  });

  it('draws a session cluster as a dashed outline with no fill', () => {
    const svg = mermaidFixture();
    decoratePlot(svg, nodes, kindText);
    const outline = svg.querySelector('g.cluster > rect');
    expect(outline?.getAttribute('class')).toBe('cluster-outline');
    expect(outline?.hasAttribute('style')).toBe(false);
    expect(svg.querySelector('g.cluster text')?.getAttribute('class')).toBe('cluster-title');
  });

  it('gives the SVG its natural size from the viewBox', () => {
    expect(decoratePlot(mermaidFixture(), nodes, kindText)).toEqual({ width: 400, height: 300 });
  });
});
