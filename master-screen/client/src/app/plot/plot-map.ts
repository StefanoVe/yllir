import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Maximize, ZoomIn, ZoomOut } from 'lucide-angular';
import type { PlotFlowNode, PlotResponse } from '@shared/types';
import type { SourceRef } from '@shared/cockpit-types';
import { DocumentModal } from '../cockpit/modals/document-modal';
import { I18n } from '../i18n';
import { currentTheme, watchTheme } from '../reader/mermaid';
import { PlotApi } from './plot-api';
import { PLOT_DRAWER } from './plot-drawer';
import { isPlotFailure } from './plot-http';
import { matchesGroup } from './plot-render';

/** Pixels of pointer travel before a press counts as a pan rather than a click. */
const PAN_THRESHOLD_PX = 4;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;
const FIT_PADDING_PX = 16;
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Transform {
  x: number;
  y: number;
  k: number;
}

interface Size {
  width: number;
  height: number;
}

/** One drawn dependency or order edge, read from the SVG after it is decorated. */
interface DrawnEdge {
  element: SVGPathElement;
  from: string;
  to: string;
  depends: boolean;
}

/**
 * The plot map: the flowchart the assistant keeps in the plot file, drawn as SVG. Hovering or focusing
 * a node lights its chain of dependencies. A click or Enter on a node opens its sheet in the popup.
 * A text list of the same nodes is kept for screen readers.
 */
@Component({
  selector: 'ms-plot-map',
  imports: [LucideAngularModule, DocumentModal],
  templateUrl: './plot-map.html',
  styleUrl: './plot-map.css',
})
export class PlotMapComponent {
  private readonly api = inject(PlotApi);
  private readonly drawer = inject(PLOT_DRAWER);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  readonly s = inject(I18n);

  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');

  readonly icons = { Maximize, ZoomIn, ZoomOut };
  readonly data = signal<PlotResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly drawError = signal<string | null>(null);
  readonly transform = signal<Transform>({ x: 0, y: 0, k: 1 });
  /** Natural size of the drawn SVG, in px, before zoom. */
  readonly content = signal<Size | null>(null);
  /** The node under the pointer or the keyboard focus, or null. */
  readonly hovered = signal<string | null>(null);
  /** The sheet shown in the popup, or null when none is open. */
  readonly sheet = signal<SourceRef | null>(null);
  /** The plot sheets in navigator order, for the popup's previous and next buttons. */
  readonly sheets = signal<SourceRef[]>([]);

  readonly missing = computed(() => this.data()?.missing === true);
  readonly hasSessions = computed(() => (this.data()?.nodes ?? []).some((node) => node.kind === 'session'));
  readonly showMap = computed(() => !this.missing() && this.drawError() === null && this.error() === null);
  readonly transformStyle = computed(() => {
    const t = this.transform();
    return `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
  });

  /** The drawn node groups by flowchart id, and the drawn edges, of the map on screen. */
  private nodeGroups = new Map<string, SVGGElement>();
  private edges: DrawnEdge[] = [];
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private suppressClick = false;
  private generation = 0;

  constructor() {
    afterNextRender(
      () => {
        const element = this.viewport().nativeElement;
        const onWheel = (event: WheelEvent) => {
          event.preventDefault();
          const rect = element.getBoundingClientRect();
          const factor = Math.exp(-event.deltaY * 0.0015);
          this.transform.update((t) => zoomAt(t, factor, event.clientX - rect.left, event.clientY - rect.top));
        };
        element.addEventListener('wheel', onWheel, { passive: false });
        this.destroyRef.onDestroy(() => element.removeEventListener('wheel', onWheel));
      },
      { injector: this.injector },
    );
    const stopWatching = watchTheme(() => void this.draw());
    this.destroyRef.onDestroy(stopWatching);
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [plot, sheets] = await Promise.all([this.api.load(), this.loadSheets()]);
      this.data.set(plot);
      this.sheets.set(sheets);
      afterNextRender(() => void this.draw(), { injector: this.injector });
    } catch (failure) {
      this.error.set(isPlotFailure(failure) ? failure.error : this.s.t('panels.errors.generic'));
    } finally {
      this.loading.set(false);
    }
  }

  /** The sheets for the navigator. A failure here must not break the map: the list is just empty. */
  private async loadSheets(): Promise<SourceRef[]> {
    try {
      return (await this.api.sheets()).sheets.map((sheet) => ({ path: sheet.path }));
    } catch {
      return [];
    }
  }

  /**
   * Draws the flowchart into the canvas (the drawer loads mermaid on first use). A draw that is
   * overtaken by a newer one (theme change, reload) stops before it touches the page.
   */
  async draw(): Promise<void> {
    const plot = this.data();
    if (!plot || plot.missing) return;
    const generation = ++this.generation;
    this.drawError.set(null);
    const canvas = this.canvas().nativeElement;
    if (plot.mermaid.trim() === '') {
      canvas.replaceChildren();
      return;
    }
    try {
      const svg = await this.drawer.render(plot.mermaid, currentTheme());
      if (generation !== this.generation) return;
      canvas.replaceChildren(svg);
      this.content.set(this.drawer.decorate(svg, plot.nodes, (kind) => this.kindText(kind)));
      this.bindNodes(svg, plot.nodes);
      this.paint();
      this.fit();
    } catch {
      if (generation !== this.generation) return;
      canvas.replaceChildren();
      this.drawError.set(this.s.t('plot.renderError'));
    }
  }

  /** Shows the whole map inside the viewport. */
  fit(): void {
    const size = this.content();
    if (!size) return;
    const el = this.viewport().nativeElement;
    this.transform.set(fitTransform(size, { width: el.clientWidth, height: el.clientHeight }));
  }

  zoomBy(factor: number): void {
    const el = this.viewport().nativeElement;
    this.transform.update((t) => zoomAt(t, factor, el.clientWidth / 2, el.clientHeight / 2));
  }

  /** Lights the chain of the node (or clears it with null). */
  setHover(id: string | null): void {
    this.hovered.set(id);
    this.paint();
  }

  /** A click opens the sheet in the popup, not in the reader. */
  open(node: PlotFlowNode): void {
    if (this.suppressClick) return;
    this.sheet.set({ path: node.path });
  }

  /**
   * Makes each drawn node that has an id in the list a link: focusable, labelled, hover and focus light
   * its chain, and click or Enter opens its sheet. Also collects the drawn edges for the lit/dim paint.
   */
  private bindNodes(svg: SVGSVGElement, nodes: PlotFlowNode[]): void {
    this.nodeGroups = new Map();
    for (const node of nodes) {
      const target = findGroup(svg, node.id);
      if (!target) continue;
      this.nodeGroups.set(node.id, target);
      target.setAttribute('role', 'link');
      target.setAttribute('tabindex', '0');
      target.setAttribute('aria-label', this.labelOf(node));
      target.setAttribute('data-path', node.path);
      const tooltip = target.querySelector('title') ?? document.createElementNS(SVG_NS, 'title');
      tooltip.textContent = this.labelOf(node);
      target.prepend(tooltip);
      target.addEventListener('click', (event) => {
        const hit = (event.target as Element | null)?.closest('g.node, g.cluster');
        if (hit === target) this.open(node);
      });
      target.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.open(node);
      });
      target.addEventListener('mouseenter', () => this.setHover(node.id));
      target.addEventListener('mouseleave', () => this.setHover(null));
      target.addEventListener('focus', () => this.setHover(node.id));
      target.addEventListener('blur', () => this.setHover(null));
    }
    this.edges = Array.from(svg.querySelectorAll<SVGPathElement>('path.edge')).map((element) => ({
      element,
      from: element.getAttribute('data-from') ?? '',
      to: element.getAttribute('data-to') ?? '',
      depends: element.classList.contains('depends'),
    }));
  }

  /**
   * Lit and dim, as the old map: with a node hovered, it and everything it needs stay lit (nodes get the
   * lit outline, the dependency edges between them the accent), everything else is dimmed.
   */
  private paint(): void {
    const id = this.hovered();
    const chain = id === null ? null : dependencyChain(id, this.edges);
    for (const [nodeId, group] of this.nodeGroups) {
      const lit = chain === null || chain.has(nodeId);
      group.classList.toggle('lit', chain !== null && lit);
      group.classList.toggle('dim', !lit);
    }
    for (const edge of this.edges) {
      const lit = chain !== null && edge.depends && chain.has(edge.from) && chain.has(edge.to);
      edge.element.classList.toggle('lit', lit);
      edge.element.classList.toggle('dim', chain !== null && !lit);
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.suppressClick = false;
    this.drag = { x: event.clientX, y: event.clientY, moved: false };
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return;
    drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    this.transform.update((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  }

  onPointerUp(): void {
    if (this.drag?.moved) this.suppressClick = true;
    this.drag = null;
  }

  kindText(kind: PlotFlowNode['kind']): string {
    return this.s.t(kind === 'session' ? 'plot.kind.session' : 'plot.kind.scene');
  }

  labelOf(node: PlotFlowNode): string {
    const parts = [node.title, this.kindText(node.kind)];
    if (node.status) parts.push(this.s.t('plot.status', { status: this.statusText(node.status) }));
    return parts.join(' · ');
  }

  statusText(status: NonNullable<PlotFlowNode['status']>): string {
    if (status === 'played') return this.s.t('plot.state.played');
    if (status === 'ready') return this.s.t('plot.state.ready');
    return this.s.t('plot.state.waiting');
  }
}

/** The drawn node or cluster of a flowchart id. */
function findGroup(svg: SVGSVGElement, id: string): SVGGElement | null {
  const groups = Array.from(svg.querySelectorAll<SVGGElement>('g.node, g.cluster'));
  return groups.find((group) => matchesGroup(group.id, id)) ?? null;
}

/**
 * The node and everything it needs, directly or through other nodes: walks dependency edges backwards
 * from `id` (the dependent) to the prerequisites. Items that need the node are not included.
 */
function dependencyChain(id: string, edges: readonly Pick<DrawnEdge, 'from' | 'to' | 'depends'>[]): Set<string> {
  const chain = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of edges) {
      if (!edge.depends || edge.to !== current || chain.has(edge.from)) continue;
      chain.add(edge.from);
      queue.push(edge.from);
    }
  }
  return chain;
}

function fitTransform(content: Size, viewport: Size): Transform {
  if (viewport.width <= 0 || viewport.height <= 0 || content.width <= 0 || content.height <= 0) return { x: 0, y: 0, k: 1 };
  const k = clampZoom(
    Math.min(
      (viewport.width - FIT_PADDING_PX * 2) / content.width,
      (viewport.height - FIT_PADDING_PX * 2) / content.height,
      1,
    ),
  );
  return { x: (viewport.width - content.width * k) / 2, y: (viewport.height - content.height * k) / 2, k };
}

function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/** Zooms by `factor` around the screen point (px, py), so that point stays where it is. */
function zoomAt(t: Transform, factor: number, px: number, py: number): Transform {
  const k = clampZoom(t.k * factor);
  const ratio = k / t.k;
  return { x: px - (px - t.x) * ratio, y: py - (py - t.y) * ratio, k };
}
