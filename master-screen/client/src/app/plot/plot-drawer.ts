import { InjectionToken } from '@angular/core';
import type { DiagramTheme } from '../reader/mermaid';
import type { PlotFlowNode } from '@shared/types';
import type { PlotSize } from './plot-render';

/** Draws the plot source as SVG. The real drawer loads mermaid on first use; tests provide a fake. */
export interface PlotDrawer {
  render(source: string, theme: DiagramTheme): Promise<SVGSVGElement>;
  /** Styles a drawn SVG that is already in the page. Only valid after render has resolved. */
  decorate(svg: SVGSVGElement, nodes: readonly PlotFlowNode[], kindText: (kind: PlotFlowNode['kind']) => string): PlotSize;
}

export const PLOT_DRAWER = new InjectionToken<PlotDrawer>('PLOT_DRAWER', {
  providedIn: 'root',
  factory: lazyDrawer,
});

/** The mermaid-backed drawer: plot-render.ts (and with it mermaid) is imported when the first map is drawn. */
function lazyDrawer(): PlotDrawer {
  let loaded: typeof import('./plot-render') | null = null;
  const load = async (): Promise<typeof import('./plot-render')> => {
    loaded ??= await import('./plot-render');
    return loaded;
  };
  return {
    render: async (source, theme) => (await load()).renderPlot(source, theme),
    decorate: (svg, nodes, kindText) => {
      if (!loaded) throw new Error('The plot drawer is not loaded yet.');
      return loaded.decoratePlot(svg, nodes, kindText);
    },
  };
}
