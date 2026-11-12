import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { PlotResponse } from '../../../shared/src/types.js';
import { makeCampaign, makeFramework, get, startApp, type Harness } from '../live/test-support.js';
import { toPlotResponse, type PlotMapResult } from '../plot/map.js';

const REAL_FRAMEWORK = fileURLToPath(new URL('../../../../yllir', import.meta.url));

const harnesses: Harness[] = [];
after(async () => {
  await Promise.all(harnesses.map((h) => h.server.close()));
});

// Same layout the framework's plot-map tests use: plot, chronicle and places categories.
const CAMPAIGN_YAML = [
  'name: Test',
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '  - id: cronaca',
  '    folder: Cronaca',
  '    type: chronicle',
  '  - id: luoghi',
  '    folder: Mondo',
  '    type: places',
  '',
].join('\n');

function plotDoc(id: string, dependsOn: string[], arc?: string, body = 'Testo.'): string {
  const arcLine = arc === undefined ? '' : `arc: ${arc}\n`;
  return `---\nid: ${id}\ndepends_on: [${dependsOn.join(', ')}]\n${arcLine}---\n\n# ${id}\n\n${body}\n`;
}

function eventDoc(id: string, session: string, dependsOn: string[]): string {
  return `---\nid: ${id}\nsession: ${session}\ndepends_on: [${dependsOn.join(', ')}]\n---\n\n# ${id}\n\nTesto.\n`;
}

/**
 * A plot of two arcs: session s-01 (played) -> s-02, s-03 without a link to s-02, and
 * session s-01 has three scenes: e-porto -> e-faro (declared), and e-mercato alone.
 */
const FIXTURE: Record<string, string> = {
  'campaign.yaml': CAMPAIGN_YAML,
  'Trama/Sessione 1/Sessione 1.md': plotDoc('s-01', [], 'Arco', 'SEGRETO-DEL-MASTER-5512'),
  'Trama/Sessione 2/Sessione 2.md': plotDoc('s-02', ['s-01'], 'Arco'),
  'Trama/Sessione 3/Sessione 3.md': plotDoc('s-03', [], 'Arco'),
  'Trama/Altra/Altra.md': plotDoc('a-01', [], 'Altro'),
  'Trama/Sessione 1/Eventi/Porto.md': eventDoc('e-porto', 's-01', []),
  'Trama/Sessione 1/Eventi/Faro.md': eventDoc('e-faro', 's-01', ['e-porto']),
  'Trama/Sessione 1/Eventi/Mercato.md': eventDoc('e-mercato', 's-01', []),
  'Cronaca/2026-01-01.md': '---\nid: c-1\nplayed: [s-01]\n---\n\n# Cronaca\n\nTesto.\n',
};

async function plotOf(files: Record<string, string>): Promise<{ h: Harness; body: PlotResponse }> {
  const root = makeCampaign(files);
  const h = await startApp(root, REAL_FRAMEWORK);
  harnesses.push(h);
  const res = await get(h, '/plot');
  assert.equal(res.status, 200, res.text);
  return { h, body: res.json as PlotResponse };
}

const byKey = (a: { from: string; to: string }, b: { from: string; to: string }): number =>
  `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`);

describe('GET /api/plot on a real plot-map fixture', () => {
  it('maps sessions and scenes to nodes with campaign-relative paths and statuses', async () => {
    const { body } = await plotOf(FIXTURE);
    const nodes = Object.fromEntries(body.nodes.map((n) => [n.id, n]));
    assert.deepEqual(nodes['session:s-01'], {
      id: 'session:s-01',
      kind: 'session',
      title: 'Sessione 1',
      path: 'Trama/Sessione 1/Sessione 1.md',
      status: 'played',
    });
    assert.equal(nodes['session:s-02'].status, 'ready');
    assert.equal(nodes['session:s-03'].status, 'ready');
    assert.equal(nodes['session:a-01'].status, 'ready');
    assert.deepEqual(nodes['scene:e-faro'], {
      id: 'scene:e-faro',
      kind: 'scene',
      title: 'Faro',
      path: 'Trama/Sessione 1/Eventi/Faro.md',
      session: 'session:s-01',
    });
    assert.equal(body.nodes.length, 4 + 3);
  });

  it('draws declared dependencies as depends edges, from prerequisite to dependent', async () => {
    const { body } = await plotOf(FIXTURE);
    const depends = body.edges.filter((e) => e.kind === 'depends').sort(byKey);
    assert.deepEqual(depends, [
      { from: 'scene:e-porto', to: 'scene:e-faro', kind: 'depends' },
      { from: 'session:s-01', to: 'session:s-02', kind: 'depends' },
    ]);
  });

  it('draws order edges only between consecutive items with no declared dependency', async () => {
    const { body } = await plotOf(FIXTURE);
    const order = body.edges.filter((e) => e.kind === 'order').sort(byKey);
    assert.deepEqual(order, [
      { from: 'scene:e-mercato', to: 'scene:e-porto', kind: 'order' },
      { from: 'session:s-02', to: 'session:s-03', kind: 'order' },
    ]);
  });

  it('never carries the body text of a document', async () => {
    const { h, body } = await plotOf(FIXTURE);
    assert.doesNotMatch(JSON.stringify(body), /SEGRETO/);
    assert.equal((await get(h, '/plot')).text.includes('SEGRETO'), false);
  });
});

describe('plot mapping', () => {
  it('ignores unknown dependencies and cycles and never invents an edge for them', () => {
    const result: PlotMapResult = {
      sessions: [
        {
          id: 'a',
          file: 'Trama/a/a.md',
          name: 'a',
          arc: 'Solo',
          depends_on: ['nope', 'a'],
          played: false,
          ready: false,
          events: [],
        },
      ],
    };
    const out = toPlotResponse(result);
    assert.equal(out.nodes.length, 1);
    assert.deepEqual(out.edges, []);
  });

  it('gives a scene the node id of its session and keeps two sessions of one arc in order', () => {
    const out = toPlotResponse({
      sessions: [
        { id: 'x', file: 'T/x/x.md', name: 'x', arc: 'A', depends_on: [], played: true, ready: false, events: [] },
        { id: 'y', file: 'T/y/y.md', name: 'y', arc: 'A', depends_on: [], played: false, ready: true, events: [] },
      ],
    });
    assert.deepEqual(out.edges, [{ from: 'session:x', to: 'session:y', kind: 'order' }]);
    assert.equal(out.nodes[1].status, 'ready');
  });
});

describe('GET /api/plot without the plot module', () => {
  it('answers 503 with the plain message', async () => {
    const root = makeCampaign({ 'campaign.yaml': CAMPAIGN_YAML });
    const h = await startApp(root, makeFramework({ libs: false }));
    harnesses.push(h);
    const res = await get(h, '/plot');
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, { error: 'This version of Yllir does not support the plot map yet.' });
  });
});
