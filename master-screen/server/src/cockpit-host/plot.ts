// The plot graph of the cockpit, from the framework's plot map (plotMap in
// scripts/lib/plot/plot-map.mjs, read through the master screen's plot/map.ts). The module is
// loaded once, asynchronously, before the archive rebuilds; the graph itself is built
// synchronously from the disk. Owner: cockpit host.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PlotGraph, PlotMapEdge, PlotMapGroup, PlotMapNode } from '../cockpit/ports.js';
import type { Ctx } from '../context.js';
import { sessionNodeId, toPlotResponse, type PlotMapResult } from '../plot/map.js';

export const PLOT_MODULE = 'scripts/lib/plot/plot-map.mjs';

interface PlotMapModule {
  plotMap(root: string): PlotMapResult;
}

export interface PlotGraphSource {
  /** Loads the framework module once. Never throws. */
  load(): Promise<void>;
  /** The plot graph of the campaign now, or an empty graph when the module is not loaded or fails. */
  build(): PlotGraph;
}

function emptyGraph(): PlotGraph {
  return { source: '', nodes: [], groups: [], edges: [], unresolved: [] };
}

export function createPlotGraphSource(ctx: Ctx): PlotGraphSource {
  let plotMap: PlotMapModule['plotMap'] | undefined;
  let loading: Promise<void> | undefined;

  const load = (): Promise<void> => {
    loading ??= (async () => {
      const file = path.join(ctx.frameworkRoot, PLOT_MODULE);
      if (!fs.existsSync(file)) return;
      try {
        const mod = (await import(pathToFileURL(file).href)) as PlotMapModule;
        plotMap = mod.plotMap;
      } catch (error) {
        ctx.log(`cockpit plot module: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return loading;
  };

  return {
    load,
    build(): PlotGraph {
      if (plotMap === undefined) return emptyGraph();
      let result: PlotMapResult;
      try {
        result = plotMap(ctx.campaignRoot);
      } catch (error) {
        ctx.log(`cockpit plot map: ${error instanceof Error ? error.message : String(error)}`);
        return emptyGraph();
      }
      return toGraph(result);
    },
  };
}

/** The cockpit's graph from the plot map: sessions are groups, scenes are events inside them. */
export function toGraph(result: PlotMapResult): PlotGraph {
  const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
  const response = toPlotResponse({ sessions });
  const arcOf = new Map<string, string>();
  const groupTitles = new Map<string, string>();
  for (const session of sessions) {
    arcOf.set(sessionNodeId(session.id), session.arc);
    if (session.arc !== '') groupTitles.set(`arc:${session.arc}`, session.arc);
  }
  const groupOf = (node: string): string | undefined => {
    const arc = arcOf.get(node) ?? '';
    return arc === '' ? undefined : `arc:${arc}`;
  };

  const nodes: PlotMapNode[] = [];
  const edges: PlotMapEdge[] = [];
  for (const node of response.nodes) {
    const target = { path: node.path, anchor: '', title: node.title };
    if (node.kind === 'session') {
      const group = groupOf(node.id);
      nodes.push({ id: node.id, title: node.title, ...(group ? { group } : {}), target, kind: 'group' });
      continue;
    }
    const session = node.session ?? '';
    const group = groupOf(session);
    nodes.push({ id: node.id, title: node.title, ...(group ? { group } : {}), target, kind: 'event' });
    edges.push({ id: `membership:${session}>${node.id}`, from: session, to: node.id, optional: false, relation: 'membership' });
  }
  for (const edge of response.edges) {
    edges.push({
      id: `${edge.kind}:${edge.from}>${edge.to}`,
      from: edge.from,
      to: edge.to,
      optional: false,
      relation: 'narrative',
    });
  }

  // Declared dependencies on ids that are not in the campaign.
  const known = new Set<string>();
  for (const session of sessions) {
    known.add(session.id);
    for (const scene of session.events) known.add(scene.id);
  }
  const unresolved = new Set<string>();
  for (const session of sessions) {
    for (const dep of [...session.depends_on, ...session.events.flatMap((scene) => scene.depends_on)]) {
      if (!known.has(dep)) unresolved.add(dep);
    }
  }

  const groups: PlotMapGroup[] = [...groupTitles].map(([id, title]) => ({ id, title }));
  return { source: '', nodes, groups, edges, unresolved: [...unresolved].sort() };
}
