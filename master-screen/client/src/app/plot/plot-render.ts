// Draws the plot flowchart: the mermaid source comes from the server, mermaid lays it out as SVG, and
// this file gives every node and edge the look of the plot map: a flat card with a kind label, a title
// and a status icon, the same CSS classes as before (styled in plot-map.css). The mermaid package is
// imported here, so it loads only when the plot screen draws a map. Mermaid's own stylesheet and the
// server's class colours are removed from the SVG, so only the app's CSS decides how it looks.

import type { PlotFlowNode } from '@shared/types';
import type { DiagramTheme } from '../reader/mermaid';

export interface PlotSize {
  width: number;
  height: number;
}

/** Card sizes of the plot map (plot-layout.ts before the Mermaid flowchart). */
export const SESSION_SIZE = { w: 220, h: 72 };
export const SCENE_SIZE = { w: 180, h: 48 };
/** Longest title on a card; a longer one ends with an ellipsis. */
export const TITLE_MAX = 28;
const CARD_RADIUS = 12;
/** Id of the arrowhead marker that every dependency edge points at. */
export const ARROW_ID = 'plot-arrow';
const SVG_NS = 'http://www.w3.org/2000/svg';
const STATUSES = ['played', 'ready', 'waiting'] as const;

let counter = 0;

/**
 * Draws the mermaid source as an SVG element (not yet in the page). Strict security and SVG labels:
 * no HTML from the source ever reaches the page.
 */
export async function renderPlot(source: string, theme: DiagramTheme): Promise<SVGSVGElement> {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    darkMode: theme === 'dark',
    flowchart: { htmlLabels: false, curve: 'basis' },
  } as Parameters<typeof mermaid.initialize>[0]);
  counter += 1;
  const { svg } = await mermaid.render(`ms-plot-${counter}`, source);
  const box = document.createElement('div');
  box.innerHTML = svg;
  const element = box.querySelector('svg');
  if (!element) throw new Error('mermaid returned no svg');
  return element;
}

/**
 * Gives the drawn SVG the plot map's look. Call it once the SVG is in the page (it measures the nodes).
 * Every node becomes a card of the old size, centred where mermaid put it; every dependency edge gets
 * the arrowhead; every dashed edge (file order) is a plain dashed line; session clusters become quiet
 * dashed outlines. Sets the SVG's natural size from its viewBox and returns it.
 */
export function decoratePlot(
  svg: SVGSVGElement,
  nodes: readonly PlotFlowNode[],
  kindText: (kind: PlotFlowNode['kind']) => string,
): PlotSize {
  for (const style of Array.from(svg.querySelectorAll('style'))) style.remove();
  for (const defs of Array.from(svg.querySelectorAll('defs'))) defs.remove();
  svg.insertBefore(arrowDefs(), svg.firstChild);

  for (const cluster of Array.from(svg.querySelectorAll<SVGGElement>('g.cluster'))) decorateCluster(cluster);
  for (const edge of Array.from(svg.querySelectorAll<SVGPathElement>('path.flowchart-link'))) decorateEdge(edge);
  for (const group of Array.from(svg.querySelectorAll<SVGGElement>('g.node'))) {
    decorateNode(group, nodes.find((node) => matchesGroup(group.id, node.id)), kindText);
  }

  const parts = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const size = { width: parts[2] ?? 0, height: parts[3] ?? 0 };
  if (size.width > 0 && size.height > 0) {
    svg.setAttribute('width', String(size.width));
    svg.setAttribute('height', String(size.height));
  }
  svg.style.maxWidth = 'none';
  return size;
}

/** The drawn node or cluster of a flowchart id. Mermaid names node groups `flowchart-<id>-<n>`. */
export function matchesGroup(groupId: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:flowchart-)?${escaped}(?:-\\d+)?$`).test(groupId);
}

/** Replaces a node's drawn shape and label with the old card: rect, kind label, title and status icon. */
function decorateNode(
  group: SVGGElement,
  node: PlotFlowNode | undefined,
  kindText: (kind: PlotFlowNode['kind']) => string,
): void {
  const shape = childMatching(group, (child) => child.classList.contains('label-container'))
    ?? childMatching(group, (child) => ['rect', 'polygon', 'path'].includes(child.tagName.toLowerCase()));
  if (!shape) return;
  const box = (shape as SVGGraphicsElement).getBBox();
  const kind: PlotFlowNode['kind'] = node?.kind ?? 'scene';
  const title = node?.title ?? (group.textContent ?? '').trim();
  const status = node?.status ?? STATUSES.find((name) => group.classList.contains(name));
  const size = kind === 'session' ? SESSION_SIZE : SCENE_SIZE;
  const x = box.x + box.width / 2 - size.w / 2;
  const y = box.y + box.height / 2 - size.h / 2;

  group.removeAttribute('style');
  group.replaceChildren();
  group.classList.add(kind);
  group.append(
    svgElement('rect', { class: 'card', x, y, width: size.w, height: size.h, rx: CARD_RADIUS }),
    svgElement('text', { class: 'kind-label', x: x + 12, y: y + 18 }, kindText(kind)),
    svgElement(
      'text',
      { class: 'title-label', x: x + 12, y: y + (kind === 'session' ? 50 : 36) },
      shorten(title),
    ),
  );
  if (status) group.append(statusIcon(status === 'played', x + size.w - 24, y + 6));
}

/** The old status icon: a tick when played, an empty ring otherwise. */
function statusIcon(done: boolean, x: number, y: number): SVGElement {
  const icon = svgElement('g', { class: 'status', transform: `translate(${x} ${y})`, 'aria-hidden': 'true' });
  icon.append(
    done
      ? svgElement('path', { d: 'M4 12 L9 17 L18 7' })
      : svgElement('circle', { cx: 11, cy: 11, r: 6 }),
  );
  return icon;
}

/** Mermaid's edge becomes a plain line: dependencies keep an arrowhead, dashed file order does not. */
function decorateEdge(edge: SVGPathElement): void {
  const from = classValue(edge, 'LS-');
  const to = classValue(edge, 'LE-');
  const dashed = edge.classList.contains('edge-pattern-dashed') || edge.classList.contains('edge-pattern-dotted');
  const arrowed = edge.hasAttribute('marker-end');
  edge.removeAttribute('style');
  edge.removeAttribute('marker-end');
  edge.removeAttribute('marker-start');
  edge.setAttribute('class', dashed ? 'edge order' : 'edge depends');
  edge.setAttribute('data-from', from);
  edge.setAttribute('data-to', to);
  if (!dashed && arrowed) edge.setAttribute('marker-end', `url(#${ARROW_ID})`);
}

/** A session cluster is a quiet dashed outline with no fill; its label is small and muted. */
function decorateCluster(cluster: SVGGElement): void {
  const outline = childMatching(cluster, (child) => child.tagName.toLowerCase() === 'rect');
  if (outline) {
    outline.removeAttribute('style');
    outline.setAttribute('class', 'cluster-outline');
  }
  const label = childMatching(cluster, (child) => child.classList.contains('cluster-label'));
  for (const text of Array.from(label?.querySelectorAll('text') ?? [])) {
    text.removeAttribute('style');
    text.setAttribute('class', 'cluster-title');
  }
}

function arrowDefs(): SVGElement {
  const defs = svgElement('defs');
  const marker = svgElement('marker', {
    id: ARROW_ID,
    viewBox: '0 0 10 10',
    refX: 9,
    refY: 5,
    markerWidth: 8,
    markerHeight: 8,
    orient: 'auto-start-reverse',
  });
  marker.append(svgElement('path', { class: 'arrow-head', d: 'M0 0 L10 5 L0 10 z' }));
  defs.append(marker);
  return defs;
}

function shorten(title: string): string {
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

/** The value of the first class that starts with `prefix` (mermaid writes `LS-<from>` and `LE-<to>`). */
function classValue(element: Element, prefix: string): string {
  const name = Array.from(element.classList).find((item) => item.startsWith(prefix));
  return name ? name.slice(prefix.length) : '';
}

function childMatching(parent: Element, test: (child: Element) => boolean): Element | undefined {
  return Array.from(parent.children).find(test);
}

function svgElement(
  name: string,
  attributes: Record<string, string | number> = {},
  text?: string,
): SVGElement {
  const element = document.createElementNS(SVG_NS, name) as SVGElement;
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}
