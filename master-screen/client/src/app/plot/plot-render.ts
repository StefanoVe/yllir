// Draws the plot flowchart: the mermaid source comes from the server, and this file turns it into SVG
// in the app's own colours. The mermaid package is imported here, so it loads only when the plot
// screen draws a map. Nodes keep their status look (played, ready, waiting) and get a torn-paper edge,
// as the interface guidelines ask for plot nodes.

import type { DiagramTheme } from '../reader/mermaid';

export type PlotStatus = 'played' | 'ready' | 'waiting';

export interface PlotSize {
  width: number;
  height: number;
}

/** The app's colour tokens, read from the stylesheet so the map follows the theme. */
interface Tokens {
  surface: string;
  surface2: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  accent: string;
  font: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const STATUSES: readonly PlotStatus[] = ['played', 'ready', 'waiting'];
/** Pixels between two jitter points of a torn edge, and how far a point may move inwards. */
const TEAR_STEP = 14;
const TEAR_DEPTH = 3;
const MARK_RADIUS = 4;

let counter = 0;

function readTokens(): Tokens {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string): string => css.getPropertyValue(name).trim();
  return {
    surface: token('--color-surface'),
    surface2: token('--color-surface-2'),
    border: token('--color-border'),
    borderStrong: token('--color-border-strong'),
    text: token('--color-text'),
    textMuted: token('--color-text-muted'),
    accent: token('--color-accent'),
    font: token('--font-family-hand'),
  };
}

/**
 * Draws the mermaid source as an SVG element (not yet in the page). Strict security and SVG labels:
 * no HTML from the source ever reaches the page.
 */
export async function renderPlot(source: string, theme: DiagramTheme): Promise<SVGSVGElement> {
  const { default: mermaid } = await import('mermaid');
  const t = readTokens();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    darkMode: theme === 'dark',
    flowchart: { htmlLabels: false, curve: 'basis' },
    themeVariables: {
      background: t.surface,
      fontFamily: t.font,
      primaryColor: t.surface,
      primaryTextColor: t.text,
      primaryBorderColor: t.borderStrong,
      secondaryColor: t.surface2,
      tertiaryColor: t.surface2,
      lineColor: t.textMuted,
      textColor: t.text,
      clusterBkg: t.surface2,
      clusterBorder: t.border,
      edgeLabelBackground: t.surface,
      titleColor: t.text,
    },
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
 * Gives the drawn SVG its look. Call it once the SVG is in the page (it measures the shapes). Each
 * node's rectangle becomes a torn-paper path seeded by the node id, so the shape never changes between
 * draws; status is shown by the outline style and a small mark in the corner, not by colour alone.
 * Sets the SVG's natural size from its viewBox and returns it.
 */
export function decoratePlot(svg: SVGSVGElement): PlotSize {
  const t = readTokens();
  for (const group of Array.from(svg.querySelectorAll<SVGGElement>('g.node'))) {
    const shape = group.querySelector<SVGGraphicsElement>(':scope > .label-container')
      ?? group.querySelector<SVGGraphicsElement>(':scope > rect, :scope > polygon, :scope > path');
    if (!shape) continue;
    const box = shape.getBBox();
    const status = STATUSES.find((name) => group.classList.contains(name));
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'plot-shape');
    path.setAttribute('d', tornPath(group.id, box));
    path.setAttribute('style', shapeStyle(status, t));
    shape.replaceWith(path);
    group.classList.add('plot-node');
    const mark = markFor(status, box, t);
    if (mark) group.appendChild(mark);
  }
  const viewBox = svg.viewBox.baseVal;
  const size = { width: viewBox.width, height: viewBox.height };
  if (size.width > 0 && size.height > 0) {
    svg.setAttribute('width', String(size.width));
    svg.setAttribute('height', String(size.height));
  }
  svg.style.maxWidth = 'none';
  return size;
}

/** Outline and fill of a node by its status; a node without status is the plain card. */
export function shapeStyle(status: PlotStatus | undefined, t: Tokens): string {
  if (status === 'played') return `fill:${t.surface2};stroke:${t.textMuted};stroke-width:1.5`;
  if (status === 'ready') return `fill:${t.surface};stroke:${t.accent};stroke-width:2.5`;
  if (status === 'waiting') return `fill:${t.surface};stroke:${t.borderStrong};stroke-width:1.5;stroke-dasharray:5 4`;
  return `fill:${t.surface};stroke:${t.borderStrong};stroke-width:1.5`;
}

/** The corner mark: a tick when played, a filled dot when ready, an empty ring when waiting. */
function markFor(status: PlotStatus | undefined, box: DOMRect | SVGRect, t: Tokens): SVGElement | null {
  if (!status) return null;
  const cx = box.x + box.width - 10;
  const cy = box.y + 10;
  if (status === 'played') {
    const tick = document.createElementNS(SVG_NS, 'path');
    tick.setAttribute('class', 'plot-mark');
    tick.setAttribute('d', `M${cx - 4} ${cy} L${cx - 1} ${cy + 3} L${cx + 4} ${cy - 3}`);
    tick.setAttribute('style', `fill:none;stroke:${t.textMuted};stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round`);
    return tick;
  }
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('class', 'plot-mark');
  dot.setAttribute('cx', String(cx));
  dot.setAttribute('cy', String(cy));
  dot.setAttribute('r', String(MARK_RADIUS));
  dot.setAttribute(
    'style',
    status === 'ready'
      ? `fill:${t.accent};stroke:${t.accent};stroke-width:1.5`
      : `fill:none;stroke:${t.textMuted};stroke-width:1.5`,
  );
  return dot;
}

/**
 * A torn edge around the box: points along each side, pushed inwards by a small amount, so the
 * shape stays inside its box and the text keeps its margin. The same id always gives the same tear.
 */
export function tornPath(id: string, box: { x: number; y: number; width: number; height: number }): string {
  const { x, y, width, height } = box;
  if (width <= 0 || height <= 0) return `M${x} ${y} H${x + width} V${y + height} H${x} Z`;
  const rand = seededRandom(hash(id));
  const count = (length: number) => Math.max(2, Math.round(length / TEAR_STEP));
  const points: Array<[number, number]> = [];
  const top = count(width);
  for (let i = 0; i < top; i++) points.push([x + (width * i) / top, y + rand() * TEAR_DEPTH]);
  const right = count(height);
  for (let i = 0; i < right; i++) points.push([x + width - rand() * TEAR_DEPTH, y + (height * i) / right]);
  const bottom = count(width);
  for (let i = 0; i < bottom; i++) points.push([x + width - (width * i) / bottom, y + height - rand() * TEAR_DEPTH]);
  const left = count(height);
  for (let i = 0; i < left; i++) points.push([x + rand() * TEAR_DEPTH, y + height - (height * i) / left]);
  const [first, ...rest] = points;
  const head = `M${round(first[0])} ${round(first[1])}`;
  return `${head}${rest.map(([px, py]) => ` L${round(px)} ${round(py)}`).join('')} Z`;
}

function round(value: number): string {
  return value.toFixed(1);
}

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}
