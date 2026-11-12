import type { PlotEdge, PlotNode, PlotResponse } from '@shared/types';

export const SESSION_SIZE = { w: 220, h: 72 };
export const SCENE_SIZE = { w: 180, h: 48 };
/** Width of one column; every node is centred in its column. */
const COLUMN_WIDTH = 220;
const COLUMN_GAP = 96;
const ROW_GAP = 28;
const MARGIN = 32;
const SWEEPS = 4;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedNode extends PlotNode, Box {
  rank: number;
}

export interface PlacedEdge {
  from: string;
  to: string;
  kind: PlotEdge['kind'];
  /** Where the arrow starts and ends: `source` is drawn before `target`. */
  source: string;
  target: string;
  /** SVG path data of the edge. */
  d: string;
}

export interface PlotLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

export interface Arrow {
  source: string;
  target: string;
}

/**
 * Direction of an edge on the map, as the server sends it (master-screen/server/src/plot/map.ts):
 * a `depends` edge has `from` = the prerequisite and `to` = the item that depends on it, so the arrow
 * runs from `from` to `to`, in the order of play. An `order` edge has `from` = the earlier item of a
 * file sequence and `to` = the next one, so it runs the same way. Both kinds therefore point
 * from `from` to `to`; the arrowhead sits at `to`.
 */
export function edgeArrow(edge: PlotEdge): Arrow {
  return { source: edge.from, target: edge.to };
}

/**
 * Layer of every node: the longest path from a node with nothing before it. Edges that close a
 * cycle are ignored (found by a depth-first walk), so the layering always terminates.
 */
export function computeRanks(ids: readonly string[], arrows: readonly Arrow[]): Map<string, number> {
  const known = new Set(ids);
  const out = new Map<string, string[]>();
  for (const id of ids) out.set(id, []);
  for (const arrow of arrows) {
    if (arrow.source === arrow.target || !known.has(arrow.source) || !known.has(arrow.target)) continue;
    const next = out.get(arrow.source) ?? [];
    if (!next.includes(arrow.target)) next.push(arrow.target);
    out.set(arrow.source, next);
  }

  const state = new Map<string, 'open' | 'done'>();
  const dag: Array<[string, string]> = [];
  const visit = (id: string): void => {
    state.set(id, 'open');
    for (const next of out.get(id) ?? []) {
      if (state.get(next) === 'open') continue; // closes a cycle: dropped
      dag.push([id, next]);
      if (!state.has(next)) visit(next);
    }
    state.set(id, 'done');
  };
  for (const id of ids) if (!state.has(id)) visit(id);

  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const [, to] of dag) indegree.set(to, (indegree.get(to) ?? 0) + 1);
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indegree.get(id) === 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const [from, to] of dag) {
      if (from !== id) continue;
      rank.set(to, Math.max(rank.get(to) ?? 0, (rank.get(id) ?? 0) + 1));
      indegree.set(to, (indegree.get(to) ?? 0) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    }
  }
  return rank;
}

/** Arrows of the layout: every `depends` edge, and the file order between sessions. */
function layoutArrows(nodes: readonly PlotNode[], edges: readonly PlotEdge[]): Arrow[] {
  const sessions = new Set(nodes.filter((node) => node.kind === 'session').map((node) => node.id));
  return edges
    .filter((edge) => edge.kind === 'depends' || (sessions.has(edge.from) && sessions.has(edge.to)))
    .map(edgeArrow);
}

/** Node ids of a column reordered by the average position of their neighbours in the next or previous column. */
function sweep(columns: string[][], neighbours: Map<string, string[]>, forward: boolean): void {
  const position = new Map<string, number>();
  columns.forEach((column) => column.forEach((id, index) => position.set(id, index)));
  const order = forward ? columns.map((_, index) => index) : columns.map((_, index) => columns.length - 1 - index);
  for (const c of order) {
    const column = columns[c];
    if (!column) continue;
    const score = (id: string, index: number): number => {
      const linked = (neighbours.get(id) ?? []).map((other) => position.get(other)).filter((p): p is number => p !== undefined);
      return linked.length === 0 ? index : linked.reduce((sum, p) => sum + p, 0) / linked.length;
    };
    const ranked = column.map((id, index) => ({ id, value: score(id, index), index }));
    ranked.sort((a, b) => a.value - b.value || a.index - b.index);
    columns[c] = ranked.map((item) => item.id);
    columns[c].forEach((id, index) => position.set(id, index));
  }
}

/**
 * Places the map in columns (one per layer). Columns are ordered so that linked nodes sit close to
 * each other, which reduces crossings. Nothing overlaps: each column stacks its nodes vertically.
 */
export function layoutPlot(data: PlotResponse): PlotLayout {
  const ids = data.nodes.map((node) => node.id);
  const ranks = computeRanks(ids, layoutArrows(data.nodes, data.edges));
  const maxRank = Math.max(0, ...ids.map((id) => ranks.get(id) ?? 0));

  const columns: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const id of ids) columns[ranks.get(id) ?? 0]?.push(id);

  // prerequisitesOf: for each item, the items it needs (they sit in the column before it).
  // dependentsOf: for each item, the items that need it (they sit in the column after it).
  const prerequisitesOf = new Map<string, string[]>();
  const dependentsOf = new Map<string, string[]>();
  for (const edge of data.edges) {
    if (edge.kind !== 'depends') continue;
    prerequisitesOf.set(edge.to, [...(prerequisitesOf.get(edge.to) ?? []), edge.from]);
    dependentsOf.set(edge.from, [...(dependentsOf.get(edge.from) ?? []), edge.to]);
  }
  for (let i = 0; i < SWEEPS; i++) {
    sweep(columns, prerequisitesOf, true);
    sweep(columns, dependentsOf, false);
  }

  const byId = new Map(data.nodes.map((node) => [node.id, node] as const));
  const sizeOf = (node: PlotNode) => (node.kind === 'session' ? SESSION_SIZE : SCENE_SIZE);
  const columnHeights = columns.map((column) =>
    column.reduce((sum, id) => sum + sizeOf(byId.get(id) as PlotNode).h, 0) + ROW_GAP * Math.max(0, column.length - 1),
  );
  const tallest = Math.max(0, ...columnHeights);

  const nodes: PlacedNode[] = [];
  columns.forEach((column, c) => {
    let y = MARGIN + (tallest - (columnHeights[c] ?? 0)) / 2;
    for (const id of column) {
      const node = byId.get(id);
      if (!node) continue;
      const size = sizeOf(node);
      nodes.push({ ...node, rank: c, x: MARGIN + c * (COLUMN_WIDTH + COLUMN_GAP) + (COLUMN_WIDTH - size.w) / 2, y, w: size.w, h: size.h });
      y += size.h + ROW_GAP;
    }
  });

  const placed = new Map(nodes.map((node) => [node.id, node] as const));
  const edges: PlacedEdge[] = [];
  for (const edge of data.edges) {
    const arrow = edgeArrow(edge);
    const source = placed.get(arrow.source);
    const target = placed.get(arrow.target);
    if (!source || !target) continue;
    edges.push({ from: edge.from, to: edge.to, kind: edge.kind, source: arrow.source, target: arrow.target, d: routeEdge(source, target) });
  }

  const columnCount = columns.length;
  return {
    width: MARGIN * 2 + Math.max(1, columnCount) * COLUMN_WIDTH + Math.max(0, columnCount - 1) * COLUMN_GAP,
    height: MARGIN * 2 + tallest,
    nodes,
    edges,
  };
}

/**
 * SVG path of an edge from the source box to the target box. A target to the right leaves from the
 * right side of the source and enters the left side of the target as a smooth curve. Anything else
 * (same column, or a target to the left) leaves and enters vertically.
 */
export function routeEdge(source: Box, target: Box): string {
  if (target.x >= source.x + source.w) {
    const sx = source.x + source.w;
    const sy = source.y + source.h / 2;
    const ex = target.x;
    const ey = target.y + target.h / 2;
    const dx = Math.max(40, (ex - sx) / 2);
    return `M${sx} ${sy} C${sx + dx} ${sy} ${ex - dx} ${ey} ${ex} ${ey}`;
  }
  if (target.x + target.w <= source.x) {
    const sx = source.x;
    const sy = source.y + source.h / 2;
    const ex = target.x + target.w;
    const ey = target.y + target.h / 2;
    const dx = Math.max(40, (sx - ex) / 2);
    return `M${sx} ${sy} C${sx - dx} ${sy} ${ex + dx} ${ey} ${ex} ${ey}`;
  }
  const below = target.y >= source.y;
  const sx = source.x + source.w / 2;
  const sy = below ? source.y + source.h : source.y;
  const ex = target.x + target.w / 2;
  const ey = below ? target.y : target.y + target.h;
  const dy = Math.max(30, Math.abs(ey - sy) / 2) * (below ? 1 : -1);
  return `M${sx} ${sy} C${sx} ${sy + dy} ${ex} ${ey - dy} ${ex} ${ey}`;
}

/**
 * The node and everything it needs, directly or through other nodes: walks `depends` edges backwards
 * from `to` (the dependent) to `from` (the prerequisite). Items that need the node are not included.
 */
export function dependencyChain(id: string, edges: readonly PlotEdge[]): Set<string> {
  const chain = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of edges) {
      if (edge.kind !== 'depends' || edge.to !== current || chain.has(edge.from)) continue;
      chain.add(edge.from);
      queue.push(edge.from);
    }
  }
  return chain;
}

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2.5;

export function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/** Zooms by `factor` around the screen point (px, py), so that point stays where it is. */
export function zoomAt(t: Transform, factor: number, px: number, py: number): Transform {
  const k = clampZoom(t.k * factor);
  const ratio = k / t.k;
  return { x: px - (px - t.x) * ratio, y: py - (py - t.y) * ratio, k };
}

/** Scale and offset that show the whole content centred in the viewport, never larger than 100 %. */
export function fitTransform(content: { width: number; height: number }, viewport: { width: number; height: number }, padding = 16): Transform {
  if (viewport.width <= 0 || viewport.height <= 0 || content.width <= 0 || content.height <= 0) return { x: 0, y: 0, k: 1 };
  const k = clampZoom(Math.min((viewport.width - padding * 2) / content.width, (viewport.height - padding * 2) / content.height, 1));
  return { x: (viewport.width - content.width * k) / 2, y: (viewport.height - content.height * k) / 2, k };
}
