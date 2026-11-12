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
import { Router } from '@angular/router';
import { LucideAngularModule, Maximize, ZoomIn, ZoomOut } from 'lucide-angular';
import type { PlotNode, PlotResponse } from '@shared/types';
import { docUrl } from '../core/doc-nav.service';
import { isPanelFailure } from '../live-panels/panel-http';
import { PanelStrings } from '../live-panels/strings';
import { PlotApi } from './plot-api';
import {
  type Transform,
  dependencyChain,
  fitTransform,
  layoutPlot,
  zoomAt,
} from './plot-layout';

/** Pixels of pointer travel before a press counts as a pan rather than a click. */
const PAN_THRESHOLD_PX = 4;
const TITLE_MAX = 28;

/**
 * The plot map: sessions as large cards, scenes as small ones, arrows for declared dependencies and
 * dashed lines for file order. Hovering or focusing a node lights its chain of dependencies.
 * Enter on a node opens its document. A text list of the same map is kept for screen readers.
 */
@Component({
  selector: 'ms-plot-map',
  imports: [LucideAngularModule],
  templateUrl: './plot-map.html',
  styleUrl: './plot-map.css',
})
export class PlotMapComponent {
  private readonly api = inject(PlotApi);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  readonly s = inject(PanelStrings);

  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');

  readonly icons = { Maximize, ZoomIn, ZoomOut };
  readonly data = signal<PlotResponse | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly transform = signal<Transform>({ x: 0, y: 0, k: 1 });
  readonly hovered = signal<string | null>(null);

  readonly layout = computed(() => {
    const data = this.data();
    return data ? layoutPlot(data) : null;
  });
  readonly hasSessions = computed(() => (this.data()?.nodes ?? []).some((node) => node.kind === 'session'));
  readonly chain = computed(() => {
    const id = this.hovered();
    const data = this.data();
    return id !== null && data ? dependencyChain(id, data.edges) : null;
  });
  readonly transformAttr = computed(() => {
    const t = this.transform();
    return `translate(${t.x} ${t.y}) scale(${t.k})`;
  });
  readonly nodeView = computed(() => {
    const layout = this.layout();
    const chain = this.chain();
    return (layout?.nodes ?? []).map((node) => ({
      ...node,
      lit: chain === null || chain.has(node.id),
      label: this.labelOf(node),
      short: node.title.length > TITLE_MAX ? `${node.title.slice(0, TITLE_MAX - 1)}…` : node.title,
      done: this.isDone(node),
    }));
  });
  readonly edgeView = computed(() => {
    const layout = this.layout();
    const chain = this.chain();
    return (layout?.edges ?? []).map((edge) => ({
      ...edge,
      lit: chain !== null && edge.kind === 'depends' && chain.has(edge.from) && chain.has(edge.to),
      dim: chain !== null && !(edge.kind === 'depends' && chain.has(edge.from) && chain.has(edge.to)),
    }));
  });

  private drag: { x: number; y: number; moved: boolean } | null = null;
  private suppressClick = false;

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
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(await this.api.load());
      afterNextRender(() => this.fit(), { injector: this.injector });
    } catch (failure) {
      this.error.set(isPanelFailure(failure) ? failure.error : this.s.text('panels.errors.generic'));
    } finally {
      this.loading.set(false);
    }
  }

  /** Shows the whole map inside the viewport. */
  fit(): void {
    const layout = this.layout();
    if (!layout) return;
    const el = this.viewport().nativeElement;
    this.transform.set(fitTransform(layout, { width: el.clientWidth, height: el.clientHeight }));
  }

  zoomBy(factor: number): void {
    const el = this.viewport().nativeElement;
    this.transform.update((t) => zoomAt(t, factor, el.clientWidth / 2, el.clientHeight / 2));
  }

  setHover(id: string | null): void {
    this.hovered.set(id);
  }

  open(node: PlotNode): void {
    if (this.suppressClick) return;
    void this.router.navigateByUrl(docUrl(node.path));
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

  /** Dependencies of one node, as titles, for the text list and the node label. */
  needsText(node: PlotNode): string {
    const data = this.data();
    if (!data) return '';
    const titles = new Map(data.nodes.map((item) => [item.id, item.title] as const));
    const needs = data.edges
      .filter((edge) => edge.kind === 'depends' && edge.to === node.id)
      .map((edge) => titles.get(edge.from) ?? edge.from);
    return needs.length === 0 ? this.s.text('plot.needsNothing') : this.s.text('plot.needs', { list: needs.join(', ') });
  }

  kindText(kind: PlotNode['kind']): string {
    return this.s.text(kind === 'session' ? 'plot.kind.session' : 'plot.kind.scene');
  }

  private labelOf(node: PlotNode): string {
    const parts = [node.title, this.kindText(node.kind)];
    if (node.status) parts.push(this.s.text('plot.status', { status: node.status }));
    return parts.join(' · ');
  }

  private isDone(node: PlotNode): boolean {
    return /^(done|complete|completed|played|finished)$/i.test((node.status ?? '').trim());
  }
}
