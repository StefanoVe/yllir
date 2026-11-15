import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PlotResponse, PlotSheetsResponse } from '../../../shared/src/types.js';
import { makeCampaign, makeFramework, get, startApp, tempDir, type Harness } from '../live/test-support.js';
import {
  toPlotFlow,
  toPlotResponse,
  toPlotSheets,
  type PlotFlowchartResult,
  type PlotMapResult,
} from '../plot/map.js';

const REAL_FRAMEWORK = fileURLToPath(new URL('../../../../yllir', import.meta.url));
const REAL_PLOT_MAP = path.join(REAL_FRAMEWORK, 'scripts/lib/plot/plot-map.mjs');

const harnesses: Harness[] = [];
after(async () => {
  for (const h of harnesses) {
    await h.server.close();
    await h.ctx.closeAll();
  }
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

/**
 * A framework root for the HTTP tests: the real plot-map module (re-exported by URL) and a fake
 * plot-flowchart module that returns `flow`. `flow: undefined` leaves the flowchart module out.
 */
function makeFlowFramework(flow: PlotFlowchartResult | undefined): string {
  const root = tempDir('ms-plot-framework-');
  const dir = path.join(root, 'scripts', 'lib', 'plot');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'plot-map.mjs'),
    `export { plotMap } from ${JSON.stringify(pathToFileURL(REAL_PLOT_MAP).href)};\n`,
  );
  if (flow !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'plot-flowchart.mjs'),
      `export function readPlotFlowchart() { return ${JSON.stringify(flow)}; }\n`,
    );
  }
  return root;
}

const FLOW_MERMAID = [
  'flowchart TD',
  '  subgraph S1["Sessione 1"]',
  '    s1["Sessione 1"]',
  '    e1["Faro"]',
  '  end',
  '  s2["Sessione 2"]',
  '  d1{Scelta}',
  '  s1 --> s2',
  '  s1 -.-> e1',
  '  s1 --> d1',
].join('\n');

/** The flowchart of FIXTURE: s1 and s2 sessions, e1 a scene, x1 a path that is no sheet, d1 a decision. */
const FLOW: PlotFlowchartResult = {
  file: 'Trama/Mappa della trama.md',
  mermaid: FLOW_MERMAID,
  paths: [
    { id: 's1', path: 'Trama/Sessione 1/Sessione 1.md' },
    { id: 's2', path: 'Trama/Sessione 2/Sessione 2.md' },
    { id: 'e1', path: 'Trama/Sessione 1/Eventi/Faro.md' },
    { id: 'x1', path: 'Trama/Non esiste.md' },
  ],
  errors: [],
};

async function flowOf(
  files: Record<string, string>,
  flow: PlotFlowchartResult | undefined = FLOW,
): Promise<{ h: Harness; body: PlotResponse; text: string }> {
  const root = makeCampaign(files);
  const h = await startApp(root, makeFlowFramework(flow));
  harnesses.push(h);
  const res = await get(h, '/plot');
  assert.equal(res.status, 200, res.text);
  return { h, body: res.json as PlotResponse, text: res.text };
}

describe('GET /api/plot joins the flowchart with the plot map', () => {
  it('keeps the sheets of the flowchart that are sheets of the plot, with titles, kinds and statuses', async () => {
    const { body } = await flowOf(FIXTURE);
    assert.equal(body.missing, false);
    assert.deepEqual(body.nodes, [
      { id: 's1', path: 'Trama/Sessione 1/Sessione 1.md', title: 'Sessione 1', kind: 'session', status: 'played' },
      { id: 's2', path: 'Trama/Sessione 2/Sessione 2.md', title: 'Sessione 2', kind: 'session', status: 'ready' },
      { id: 'e1', path: 'Trama/Sessione 1/Eventi/Faro.md', title: 'Faro', kind: 'scene' },
    ]);
    assert.equal('status' in body.nodes[2], false, 'a scene has no status');
  });

  it('sends the flowchart source with the status classes appended for the nodes that have a status', async () => {
    const { body } = await flowOf(FIXTURE);
    assert.ok(body.mermaid.startsWith(FLOW_MERMAID + '\n'), body.mermaid);
    const lines = body.mermaid.split('\n');
    for (const line of [
      'classDef played fill:#d9d9d9,stroke:#4a4a4a,color:#111111',
      'classDef ready fill:#fff4c2,stroke:#9a7b00,color:#111111',
      'classDef waiting fill:#ffffff,stroke:#8a8a8a,color:#333333,stroke-dasharray:4 3',
      'class s1 played',
      'class s2 ready',
    ]) {
      assert.ok(lines.includes(line), `missing line: ${line}`);
    }
    assert.equal(lines.some((line) => line.startsWith('class e1')), false, 'a scene gets no class line');
    assert.equal(lines.some((line) => line.startsWith('class x1')), false, 'an unknown path gets no class line');
  });

  it('never carries the body text of a document', async () => {
    const { text } = await flowOf(FIXTURE);
    assert.equal(text.includes('SEGRETO'), false);
  });

  it('answers missing with an empty source when there is no flowchart file', async () => {
    const { body } = await flowOf(FIXTURE, { ...FLOW, file: null, mermaid: '', paths: [], errors: [] });
    assert.deepEqual(body, { mermaid: '', nodes: [], missing: true });
  });

  it('answers an empty source and no nodes when the file has no mermaid block', async () => {
    const { body } = await flowOf(FIXTURE, { ...FLOW, mermaid: '', paths: [], errors: [] });
    assert.deepEqual(body, { mermaid: '', nodes: [], missing: false });
  });

  it('answers 503 with the plain message when the flowchart module is absent', async () => {
    const root = makeCampaign(FIXTURE);
    const h = await startApp(root, makeFlowFramework(undefined));
    harnesses.push(h);
    const res = await get(h, '/plot');
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, { error: 'This version of Yllir does not support the plot map yet.' });
  });

  it('answers 503 when the plot map module is absent', async () => {
    const root = makeCampaign(FIXTURE);
    const h = await startApp(root, makeFramework({ libs: false }));
    harnesses.push(h);
    const res = await get(h, '/plot');
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, { error: 'This version of Yllir does not support the plot map yet.' });
  });
});

describe('toPlotFlow', () => {
  const result: PlotMapResult = {
    sessions: [
      {
        id: 'x',
        file: 'T/x/x.md',
        name: 'X',
        arc: 'A',
        depends_on: [],
        played: true,
        ready: false,
        events: [{ id: 'e1', file: 'T/x/e1.md', name: 'E1', depends_on: [] }],
      },
      { id: 'y', file: 'T/y/y.md', name: 'Y', arc: 'A', depends_on: [], played: false, ready: false, events: [] },
    ],
  };

  it('answers missing with no source and no nodes when there is no flowchart file', () => {
    const out = toPlotFlow({ file: null, mermaid: '', paths: [], errors: [] }, result);
    assert.deepEqual(out, { mermaid: '', nodes: [], missing: true });
  });

  it('gives a waiting session the waiting status and appends its class line', () => {
    const out = toPlotFlow(
      {
        file: 'T/m.md',
        mermaid: 'flowchart TD\n  y["Y"]',
        paths: [{ id: 'y', path: 'T/y/y.md' }],
        errors: [],
      },
      result,
    );
    assert.deepEqual(out.nodes, [{ id: 'y', path: 'T/y/y.md', title: 'Y', kind: 'session', status: 'waiting' }]);
    assert.ok(out.mermaid.endsWith('class y waiting'));
  });

  it('keeps the source as it is when the file has no mermaid block', () => {
    const out = toPlotFlow({ file: 'T/m.md', mermaid: '', paths: [], errors: [] }, result);
    assert.deepEqual(out, { mermaid: '', nodes: [], missing: false });
  });
});

describe('plot graph mapping', () => {
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

describe('GET /api/plot/sheets on a real plot-map fixture', () => {
  it('lists each session followed by its own scenes, in the framework order of the plot', async () => {
    const root = makeCampaign(FIXTURE);
    const h = await startApp(root, REAL_FRAMEWORK);
    harnesses.push(h);
    const res = await get(h, '/plot/sheets');
    assert.equal(res.status, 200, res.text);
    const body = res.json as PlotSheetsResponse;
    assert.deepEqual(
      body.sheets.map((sheet) => `${sheet.kind}:${sheet.title}`),
      [
        'session:Altra',
        'session:Sessione 1',
        'scene:Mercato',
        'scene:Porto',
        'scene:Faro',
        'session:Sessione 2',
        'session:Sessione 3',
      ],
    );
    const faro = body.sheets.find((sheet) => sheet.title === 'Faro');
    assert.deepEqual(faro, {
      path: 'Trama/Sessione 1/Eventi/Faro.md',
      title: 'Faro',
      kind: 'scene',
      session: 'session:s-01',
    });
  });

  it('never carries the body text of a document', async () => {
    const root = makeCampaign(FIXTURE);
    const h = await startApp(root, REAL_FRAMEWORK);
    harnesses.push(h);
    const res = await get(h, '/plot/sheets');
    assert.equal(res.status, 200);
    assert.equal(res.text.includes('SEGRETO'), false);
  });
});

describe('toPlotSheets', () => {
  it('orders sessions with their scenes, keeps paths and skips entries without a file', () => {
    const out = toPlotSheets({
      sessions: [
        {
          id: 'x',
          file: 'T/x/x.md',
          name: 'X',
          arc: 'A',
          depends_on: [],
          played: true,
          ready: false,
          events: [
            { id: 'e1', file: 'T/x/e1.md', name: 'E1', depends_on: [] },
            { id: 'e2', file: '', name: 'E2', depends_on: [] },
            { id: 'e3', file: 'T/x/e3.md', name: 'E3', depends_on: [] },
          ],
        },
        {
          id: 'y',
          file: '',
          name: 'Y',
          arc: 'A',
          depends_on: [],
          played: false,
          ready: true,
          events: [{ id: 'e4', file: 'T/y/e4.md', name: 'E4', depends_on: [] }],
        },
      ],
    });
    assert.deepEqual(out, {
      sheets: [
        { path: 'T/x/x.md', title: 'X', kind: 'session' },
        { path: 'T/x/e1.md', title: 'E1', kind: 'scene', session: 'session:x' },
        { path: 'T/x/e3.md', title: 'E3', kind: 'scene', session: 'session:x' },
        { path: 'T/y/e4.md', title: 'E4', kind: 'scene', session: 'session:y' },
      ],
    });
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

describe('GET /api/plot/sheets without the plot module', () => {
  it('answers 503 with the same plain message as /api/plot', async () => {
    const root = makeCampaign({ 'campaign.yaml': CAMPAIGN_YAML });
    const h = await startApp(root, makeFramework({ libs: false }));
    harnesses.push(h);
    const res = await get(h, '/plot/sheets');
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, { error: 'This version of Yllir does not support the plot map yet.' });
  });
});
