import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plotFlowchartFile, readPlotFlowchart, checkPlotFlowchart } from './plot-flowchart.mjs';
import { plotMap } from './plot-map.mjs';
import { listCanonicalSheets, listSheets } from '../subjects.mjs';

const CAMPAIGN = [
  'name: Test',
  'language:',
  '  main: en',
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '  - id: cronaca',
  '    folder: Cronaca',
  '    type: chronicle',
  '',
].join('\n');

const SESSION_1 = '---\nid: s1\ndepends_on: []\n---\n\n# Sessione 1\n\nTesto.\n';
const SESSION_2 = '---\nid: s2\ndepends_on: [s1]\n---\n\n# Sessione 2\n\nTesto.\n';
const SCENE = '---\nid: s1-scena\nsession: s1\ndepends_on: []\n---\n\n# Scena\n\nTesto.\n';

const FLOWCHART = [
  '---',
  'type: plot-map',
  'generated: 2026-11-15',
  '---',
  '',
  '# Trama',
  '',
  '```mermaid',
  'flowchart TD',
  '  subgraph s1 [Sessione 1]',
  '    s1c1[Scena]',
  '  end',
  '  subgraph s2 [Sessione 2]',
  '    s2c1[Scena due]',
  '  end',
  '  s1 --> s2',
  '  %% path: s1 = Trama/Sessione 1/Sessione 1.md',
  '  %% path: s1c1 = Trama/Sessione 1/Eventi/Scena.md',
  '  %% path: s2 = Trama/Sessione 2/Sessione 2.md',
  '  %% path: s2c1 = Trama/Sessione 2/Sessione 2.md',
  '```',
  '',
].join('\n');

/** Campaign with the given files (relative path -> content), the default sessions and scene included. */
function makeCampaign(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-flowchart-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const all = {
    'campaign.yaml': CAMPAIGN,
    'Trama/Sessione 1/Sessione 1.md': SESSION_1,
    'Trama/Sessione 2/Sessione 2.md': SESSION_2,
    'Trama/Sessione 1/Eventi/Scena.md': SCENE,
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    if (content === undefined) continue; // a file the test leaves out
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

test('plotFlowchartFile: the file name follows the campaign language, the folder is the first plot category', (t) => {
  const root = makeCampaign(t);
  assert.deepEqual(plotFlowchartFile(root), { folder: 'Trama', existing: null, fileName: 'Plot map.md' });

  const it = makeCampaign(t, { 'campaign.yaml': CAMPAIGN.replace('main: en', 'main: it') });
  assert.equal(plotFlowchartFile(it).fileName, 'Mappa della trama.md');
});

test('plotFlowchartFile: an existing file in the other language is found, and no plot category gives no folder', (t) => {
  const root = makeCampaign(t, { 'Trama/Mappa della trama.md': FLOWCHART });
  assert.deepEqual(plotFlowchartFile(root), {
    folder: 'Trama',
    existing: 'Trama/Mappa della trama.md',
    fileName: 'Plot map.md',
  });

  const bare = makeCampaign(t, { 'campaign.yaml': 'name: Test\nstructure: []\n' });
  assert.deepEqual(plotFlowchartFile(bare), { folder: null, existing: null, fileName: 'Plot map.md' });
});

test('readPlotFlowchart: returns the mermaid block and the path lines in file order', (t) => {
  const root = makeCampaign(t, { 'Trama/Plot map.md': FLOWCHART });
  const read = readPlotFlowchart(root);
  assert.equal(read.file, 'Trama/Plot map.md');
  assert.deepEqual(read.errors, []);
  assert.ok(read.mermaid.startsWith('flowchart TD'));
  assert.equal(read.mermaid.includes('```'), false);
  assert.deepEqual(read.paths, [
    { id: 's1', path: 'Trama/Sessione 1/Sessione 1.md' },
    { id: 's1c1', path: 'Trama/Sessione 1/Eventi/Scena.md' },
    { id: 's2', path: 'Trama/Sessione 2/Sessione 2.md' },
    { id: 's2c1', path: 'Trama/Sessione 2/Sessione 2.md' },
  ]);
});

test('readPlotFlowchart: no file gives an empty result without errors', (t) => {
  const root = makeCampaign(t);
  assert.deepEqual(readPlotFlowchart(root), { file: null, mermaid: '', paths: [], errors: [] });
});

test('readPlotFlowchart: a file without a mermaid block reports plot-flowchart-no-mermaid', (t) => {
  const root = makeCampaign(t, { 'Trama/Plot map.md': '---\ntype: plot-map\n---\n\n# Trama\n\nNessun grafo.\n' });
  const read = readPlotFlowchart(root);
  assert.equal(read.mermaid, '');
  assert.deepEqual(read.paths, []);
  assert.equal(read.errors[0].code, 'plot-flowchart-no-mermaid');
});

test('readPlotFlowchart never throws: an unreadable campaign gives an empty result', () => {
  const read = readPlotFlowchart('/nonexistent/yllir-campaign-root');
  assert.equal(read.file, null);
  assert.deepEqual(read.paths, []);
});

test('checkPlotFlowchart: a complete, valid flowchart has no errors', (t) => {
  const root = makeCampaign(t, { 'Trama/Plot map.md': FLOWCHART });
  assert.deepEqual(checkPlotFlowchart(root), []);
});

test('checkPlotFlowchart: sessions and scenes but no file gives plot-flowchart-missing', (t) => {
  const root = makeCampaign(t);
  assert.deepEqual(checkPlotFlowchart(root), [
    {
      code: 'plot-flowchart-missing',
      file: 'Trama/Plot map.md',
      message: 'the plot flowchart does not exist yet; the plot-mapper must create it',
    },
  ]);
});

test('checkPlotFlowchart: no sessions and no file is not an error', (t) => {
  const root = makeCampaign(t, {
    'Trama/Sessione 1/Sessione 1.md': undefined,
    'Trama/Sessione 2/Sessione 2.md': undefined,
    'Trama/Sessione 1/Eventi/Scena.md': undefined,
  });
  assert.deepEqual(checkPlotFlowchart(root), []);
});

test('checkPlotFlowchart: a path that does not exist gives plot-flowchart-bad-path', (t) => {
  const broken = FLOWCHART.replace('Trama/Sessione 2/Sessione 2.md\n  %% path: s2c1', 'Trama/Sessione 9/Sessione 9.md\n  %% path: s2c1');
  const root = makeCampaign(t, { 'Trama/Plot map.md': broken });
  const errors = checkPlotFlowchart(root);
  assert.deepEqual(errors.map((e) => e.code), ['plot-flowchart-bad-path']);
  assert.equal(errors[0].file, 'Trama/Plot map.md');
  assert.match(errors[0].message, /node s2 points to Trama\/Sessione 9/);
});

test('checkPlotFlowchart: a path that escapes the campaign is a bad path', (t) => {
  const escaping = FLOWCHART.replace('Trama/Sessione 1/Sessione 1.md', '../outside.md');
  const root = makeCampaign(t, { 'Trama/Plot map.md': escaping });
  assert.ok(checkPlotFlowchart(root).some((e) => e.code === 'plot-flowchart-bad-path'));
});

test('checkPlotFlowchart: a session or scene that no path line cites gives plot-flowchart-unmapped', (t) => {
  const partial = FLOWCHART.replace('  %% path: s1c1 = Trama/Sessione 1/Eventi/Scena.md\n', '');
  const root = makeCampaign(t, { 'Trama/Plot map.md': partial });
  const errors = checkPlotFlowchart(root);
  assert.deepEqual(errors, [
    {
      code: 'plot-flowchart-unmapped',
      file: 'Trama/Sessione 1/Eventi/Scena.md',
      message: 'scene s1-scena is not in the plot flowchart',
    },
  ]);
});

test('checkPlotFlowchart: a file without a mermaid block is reported', (t) => {
  const root = makeCampaign(t, { 'Trama/Plot map.md': '# Trama\n\nNiente.\n' });
  assert.deepEqual(checkPlotFlowchart(root).map((e) => e.code), [
    'plot-flowchart-no-mermaid',
    'plot-flowchart-unmapped',
    'plot-flowchart-unmapped',
    'plot-flowchart-unmapped',
  ]);
});

test('checkPlotFlowchart: the errors are sorted by code, file, then message', (t) => {
  const broken = FLOWCHART
    .replace('Trama/Sessione 2/Sessione 2.md\n  %% path: s2c1', 'Trama/Sessione 9/Sessione 9.md\n  %% path: s2c1')
    .replace('  %% path: s1c1 = Trama/Sessione 1/Eventi/Scena.md\n', '');
  const root = makeCampaign(t, { 'Trama/Plot map.md': broken });
  const codes = checkPlotFlowchart(root).map((e) => e.code);
  assert.deepEqual(codes, ['plot-flowchart-bad-path', 'plot-flowchart-unmapped']);
});

test('the plot flowchart is not a session: plotMap ignores it and reports no legacy layout', (t) => {
  const root = makeCampaign(t, { 'Trama/Plot map.md': FLOWCHART, 'Trama/Mappa della trama.md': FLOWCHART });
  const map = plotMap(root);
  assert.deepEqual(map.errors, []);
  assert.deepEqual(map.sessions.map((s) => s.id), ['s1', 's2']);
});

test('the plot flowchart is not a sheet: the sheet listers skip it at the root of a folder only', (t) => {
  const root = makeCampaign(t, {
    'Trama/Plot map.md': FLOWCHART,
    'Trama/Sessione 1/Plot map.md': '---\nid: x\n---\n\n# Altro\n',
  });
  assert.equal(listCanonicalSheets(root, 'Trama').includes('Trama/Plot map.md'), false);
  assert.equal(listSheets(root, 'Trama').includes('Trama/Plot map.md'), false);
  assert.equal(listSheets(root, 'Trama').includes('Trama/Sessione 1/Plot map.md'), true);
});
