import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Ctx } from '../context.js';
import { createPlotGraphSource, toGraph } from './plot.js';
import { contextFor, copyFixture, removeCampaign } from './test-support.js';

let root: string;
let ctx: Ctx;

before(async () => {
  root = await copyFixture();
  ctx = contextFor(root);
});

after(async () => {
  await ctx.closeAll();
  await removeCampaign(root);
});

describe('cockpit plot graph', () => {
  it('builds the graph of the fixture plot without throwing', async () => {
    const source = createPlotGraphSource(ctx);
    await source.load();
    const graph = source.build();
    assert.ok(Array.isArray(graph.nodes));
    assert.ok(Array.isArray(graph.edges));
    assert.ok(graph.nodes.some((node) => node.kind === 'group'), 'the sessions are groups');
    assert.ok(graph.nodes.some((node) => node.kind === 'event'), 'the scenes are events');
    assert.ok(graph.nodes.every((node) => node.target === undefined || node.target.path.endsWith('.md')));
  });

  it('answers an empty graph before the framework module is loaded', () => {
    const graph = createPlotGraphSource(ctx).build();
    assert.deepEqual(graph, { source: '', nodes: [], groups: [], edges: [], unresolved: [] });
  });

  it('maps sessions, scenes, arcs and unknown dependencies', () => {
    const graph = toGraph({
      sessions: [
        {
          id: 's1',
          file: 'Trama/S1/S1.md',
          name: 'Uno',
          arc: 'Arco',
          depends_on: [],
          played: false,
          ready: true,
          events: [{ id: 'e1', file: 'Trama/S1/Eventi/E1.md', name: 'Primo', depends_on: ['ghost'] }],
        },
        {
          id: 's2',
          file: 'Trama/S2/S2.md',
          name: 'Due',
          arc: 'Arco',
          depends_on: ['s1'],
          played: false,
          ready: false,
          events: [],
        },
      ],
    });
    assert.deepEqual(graph.groups, [{ id: 'arc:Arco', title: 'Arco' }]);
    const session = graph.nodes.find((node) => node.id === 'session:s1');
    assert.equal(session?.kind, 'group');
    assert.equal(session?.group, 'arc:Arco');
    assert.equal(session?.target?.path, 'Trama/S1/S1.md');
    const scene = graph.nodes.find((node) => node.id === 'scene:e1');
    assert.equal(scene?.kind, 'event');
    assert.ok(graph.edges.some((edge) => edge.relation === 'membership' && edge.from === 'session:s1' && edge.to === 'scene:e1'));
    assert.ok(graph.edges.some((edge) => edge.relation === 'narrative' && edge.from === 'session:s1' && edge.to === 'session:s2'));
    assert.deepEqual(graph.unresolved, ['ghost']);
  });
});
