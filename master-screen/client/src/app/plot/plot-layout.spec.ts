import { describe, expect, it } from 'vitest';
import type { PlotEdge, PlotNode, PlotResponse } from '@shared/types';
import {
  SCENE_SIZE,
  SESSION_SIZE,
  computeRanks,
  dependencyChain,
  fitTransform,
  layoutPlot,
  routeEdge,
  zoomAt,
} from './plot-layout';

const session = (id: string, extra: Partial<PlotNode> = {}): PlotNode => ({
  id,
  kind: 'session',
  title: `Session ${id}`,
  path: `sessions/${id}.md`,
  ...extra,
});
const scene = (id: string, extra: Partial<PlotNode> = {}): PlotNode => ({
  id,
  kind: 'scene',
  title: `Scene ${id}`,
  path: `scenes/${id}.md`,
  ...extra,
});
/**
 * Server semantics: `from` is the prerequisite, `to` the item that needs it. Written here as
 * needs(dependent, prerequisite) so the test reads like the plan: needs('s2', 's1') = s2 needs s1.
 */
const needs = (dependent: string, prerequisite: string): PlotEdge => ({ from: prerequisite, to: dependent, kind: 'depends' });
const follows = (from: string, to: string): PlotEdge => ({ from, to, kind: 'order' });

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('computeRanks', () => {
  it('ranks each node after everything it depends on (longest path)', () => {
    const ranks = computeRanks(['a', 'b', 'c', 'd'], [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'a', target: 'c' },
    ]);
    expect(ranks.get('a')).toBe(0);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('c')).toBe(2);
    expect(ranks.get('d')).toBe(0);
  });

  it('terminates on a cycle and still ranks every node', () => {
    const ranks = computeRanks(['a', 'b'], [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ]);
    expect(ranks.has('a')).toBe(true);
    expect(ranks.has('b')).toBe(true);
    expect(ranks.get('b')).toBeGreaterThan(ranks.get('a') ?? -1);
  });
});

describe('layoutPlot', () => {
  it('places every node in a column after its prerequisites, with no overlap', () => {
    const data: PlotResponse = {
      nodes: [session('s1'), scene('sc1'), scene('sc2'), session('s2'), scene('sc3')],
      edges: [needs('s2', 's1'), needs('sc1', 's1'), needs('sc2', 'sc1'), needs('sc3', 's2'), follows('s1', 's2')],
    };
    const layout = layoutPlot(data);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(byId.get('s1')?.rank).toBe(0);
    expect(byId.get('s2')?.x ?? 0).toBeGreaterThan(byId.get('s1')?.x ?? 0);
    expect(byId.get('sc2')?.x ?? 0).toBeGreaterThan(byId.get('sc1')?.x ?? 0);

    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        expect(overlaps(layout.nodes[i], layout.nodes[j])).toBe(false);
      }
    }
    expect(layout.nodes.find((node) => node.id === 's1')?.w).toBe(SESSION_SIZE.w);
    expect(layout.nodes.find((node) => node.id === 'sc1')?.h).toBe(SCENE_SIZE.h);
  });

  it('keeps sessions in file sequence with the order edges', () => {
    const layout = layoutPlot({
      nodes: [session('s1'), session('s2'), session('s3')],
      edges: [follows('s1', 's2'), follows('s2', 's3')],
    });
    const rank = new Map(layout.nodes.map((node) => [node.id, node.rank]));
    expect(rank.get('s1')).toBeLessThan(rank.get('s2') ?? 0);
    expect(rank.get('s2')).toBeLessThan(rank.get('s3') ?? 0);
  });

  it('draws a three-node chain in order of play: each arrow runs from the prerequisite to the item that needs it', () => {
    // a (first) -> b -> c: b needs a, c needs b. The map must place a, b, c left to right, and every
    // arrow must start at the right side of its prerequisite and end at the left side of its dependent.
    const layout = layoutPlot({
      nodes: [session('a'), session('b'), session('c')],
      edges: [needs('b', 'a'), needs('c', 'b')],
    });
    const x = new Map(layout.nodes.map((node) => [node.id, node.x]));
    const rank = new Map(layout.nodes.map((node) => [node.id, node.rank]));
    expect([rank.get('a'), rank.get('b'), rank.get('c')]).toEqual([0, 1, 2]);
    expect(x.get('a')).toBeLessThan(x.get('b') ?? 0);
    expect(x.get('b')).toBeLessThan(x.get('c') ?? 0);

    expect(layout.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    const node = (id: string) => layout.nodes.find((item) => item.id === id);
    for (const edge of layout.edges) {
      const source = node(edge.source);
      const target = node(edge.target);
      if (!source || !target) throw new Error('edge without its nodes');
      // Path numbers: start x, start y, two control points, then the end point (last two).
      const numbers = (edge.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      const [startX] = numbers;
      const [endX, endY] = numbers.slice(-2);
      expect(startX).toBe(source.x + source.w);
      expect(endX).toBe(target.x);
      expect(endY).toBe(target.y + target.h / 2);
    }
  });

  it('routes an arrow from the prerequisite to the dependent for depends edges', () => {
    const layout = layoutPlot({ nodes: [session('s1'), session('s2')], edges: [needs('s2', 's1')] });
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]).toMatchObject({ kind: 'depends', source: 's1', target: 's2' });
    expect(layout.edges[0].d.startsWith('M')).toBe(true);
  });

  it('handles an empty plot', () => {
    const layout = layoutPlot({ nodes: [], edges: [] });
    expect(layout.nodes).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
  });
});

describe('lanes: sessions in chronological order', () => {
  const placed = (layout: ReturnType<typeof layoutPlot>, id: string) => {
    const node = layout.nodes.find((item) => item.id === id);
    if (!node) throw new Error(`no node ${id}`);
    return node;
  };
  const centre = (node: { y: number; h: number }) => node.y + node.h / 2;

  it('places an unlinked session in a lane after the last column of the previous one, on another row', () => {
    const layout = layoutPlot({
      nodes: [
        session('s1', { path: 'sessions/s1.md' }),
        scene('a1', { session: 's1' }),
        scene('a2', { session: 's1' }),
        session('s2', { path: 'sessions/s2.md' }),
        scene('b1', { session: 's2' }),
        scene('b2', { session: 's2' }),
      ],
      edges: [follows('a1', 'a2'), follows('b1', 'b2')],
    });
    const lastOfFirst = Math.max(...['s1', 'a1', 'a2'].map((id) => placed(layout, id).rank));
    expect(placed(layout, 's2').rank).toBe(lastOfFirst + 1);
    expect(placed(layout, 'b1').rank).toBeGreaterThan(placed(layout, 's2').rank);
    expect(placed(layout, 'b2').rank).toBeGreaterThan(placed(layout, 'b1').rank);

    // The lane is one row: a session and its scenes share the same centre line.
    expect(centre(placed(layout, 'a1'))).toBe(centre(placed(layout, 's1')));
    expect(centre(placed(layout, 'b2'))).toBe(centre(placed(layout, 's2')));
    // The second lane is on a different row, below the first.
    expect(placed(layout, 's2').y).toBeGreaterThan(placed(layout, 'a2').y + placed(layout, 'a2').h);
  });

  it('keeps unrelated lanes free of overlaps', () => {
    const layout = layoutPlot({
      nodes: [
        session('s1', { path: 'sessions/a.md' }),
        scene('a1', { session: 's1' }),
        scene('a2', { session: 's1' }),
        scene('a3', { session: 's1' }),
        session('s2', { path: 'sessions/b.md' }),
        scene('b1', { session: 's2' }),
        session('s3', { path: 'sessions/c.md' }),
        scene('c1', { session: 's3' }),
        scene('c2', { session: 's3' }),
        scene('loose', {}),
      ],
      edges: [follows('a1', 'a2'), follows('a2', 'a3'), needs('a3', 'a1'), follows('c1', 'c2'), needs('loose', 'a1')],
    });
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        expect(overlaps(layout.nodes[i], layout.nodes[j])).toBe(false);
      }
    }
    expect(placed(layout, 's3').rank).toBeGreaterThan(placed(layout, 'b1').rank);
  });

  it('decides the order of unlinked sessions by path', () => {
    const layout = layoutPlot({
      nodes: [session('x', { path: 'sessions/b.md' }), session('y', { path: 'sessions/a.md' })],
      edges: [],
    });
    expect(placed(layout, 'y').rank).toBe(0);
    expect(placed(layout, 'x').rank).toBe(1);
  });

  it('lets a dependency override the path order', () => {
    const layout = layoutPlot({
      nodes: [session('late', { path: 'sessions/a.md' }), session('early', { path: 'sessions/z.md' })],
      edges: [needs('late', 'early')],
    });
    expect(placed(layout, 'early').rank).toBe(0);
    expect(placed(layout, 'late').rank).toBe(1);
  });

  it('orders by depth before path: a session that needs another comes after every session of the same depth', () => {
    // Path order would give W (b), Z (a) right after W, then Y (c). Depth gives W (0), Y (0), Z (1).
    const layout = layoutPlot({
      nodes: [session('Y', { path: 'sessions/c.md' }), session('Z', { path: 'sessions/a.md' }), session('W', { path: 'sessions/b.md' })],
      edges: [needs('Z', 'W')],
    });
    expect(placed(layout, 'W').rank).toBe(0);
    expect(placed(layout, 'Y').rank).toBe(1);
    expect(placed(layout, 'Z').rank).toBe(2);
  });
});

describe('routeEdge', () => {
  it('leaves the right side of a source to the left of a target further right', () => {
    const d = routeEdge({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 100, w: 100, h: 50 });
    expect(d).toMatch(/^M100 25 C/);
    expect(d.endsWith(' 300 125')).toBe(true);
  });

  it('routes vertically when the target sits in the same column', () => {
    const d = routeEdge({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 200, w: 100, h: 50 });
    expect(d).toMatch(/^M50 50 C/);
    expect(d.endsWith(' 50 200')).toBe(true);
  });
});

describe('dependencyChain', () => {
  it('collects the node and everything it needs, transitively, but not what needs it', () => {
    const edges = [needs('c', 'b'), needs('b', 'a'), needs('d', 'c'), follows('a', 'd')];
    expect([...dependencyChain('c', edges)].sort()).toEqual(['a', 'b', 'c']);
    expect([...dependencyChain('a', edges)]).toEqual(['a']);
  });
});

describe('zoom and fit', () => {
  it('keeps the point under the pointer still while zooming', () => {
    const next = zoomAt({ x: 0, y: 0, k: 1 }, 2, 100, 100);
    expect(next.k).toBe(2);
    expect((100 - next.x) / next.k).toBe(100);
    expect((100 - next.y) / next.k).toBe(100);
  });

  it('never zooms beyond the limits', () => {
    expect(zoomAt({ x: 0, y: 0, k: 2.4 }, 10, 0, 0).k).toBeLessThanOrEqual(2.5);
    expect(zoomAt({ x: 0, y: 0, k: 0.4 }, 0.01, 0, 0).k).toBeGreaterThanOrEqual(0.3);
  });

  it('fits the whole content in the viewport and centres it, never above 100 %', () => {
    const t = fitTransform({ width: 1000, height: 500 }, { width: 500, height: 500 }, 16);
    expect(t.k).toBeCloseTo(468 / 1000, 5);
    expect(t.x).toBeCloseTo((500 - 1000 * t.k) / 2, 5);
    expect(fitTransform({ width: 100, height: 100 }, { width: 800, height: 800 }).k).toBe(1);
    expect(fitTransform({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0, k: 1 });
  });
});
