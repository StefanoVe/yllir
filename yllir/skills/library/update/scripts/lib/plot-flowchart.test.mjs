import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plotFlowchartState } from './plot-flowchart.mjs';
import * as detectModule from '../../migrations/plot-flowchart-v1/deterministic.mjs';
import * as completeModule from '../../migrations/plot-flowchart-v1/complete.mjs';

const CAMPAIGN = [
  'name: Test',
  'language:',
  '  main: en',
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

const LAKE = '---\nid: lake\ndepends_on: []\n---\n\n# The lake\n\nText.\n';
const WARNING = '---\nid: warning\nsession: lake\ndepends_on: []\n---\n\n# Warning\n\nText.\n';
const LOST = '---\nid: lost\nsession: lake\ndepends_on: []\n---\n\n# The lost boat\n\nText.\n';

const MAP = [
  '---',
  'type: plot-map',
  'generated: 2026-11-15',
  '---',
  '',
  '# Plot map',
  '',
  '```mermaid',
  'flowchart TD',
  '  subgraph s1 ["The lake"]',
  '    s1c1["Warning"]',
  '  end',
  '  %% path: s1 = Trama/The lake/The lake.md',
  '  %% path: s1c1 = Trama/The lake/Eventi/Warning.md',
  '```',
  '',
].join('\n');

/** Creates a temporary campaign with the given files (relative path -> content). */
function makeCampaign(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-plot-flowchart-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries({ 'campaign.yaml': CAMPAIGN, ...files })) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const SESSIONS = {
  'Trama/The lake/The lake.md': LAKE,
  'Trama/The lake/Eventi/Warning.md': WARNING,
};

test('a campaign without sessions has nothing to draw: no detection, complete', (t) => {
  const root = makeCampaign(t, {});
  assert.equal(plotFlowchartState(root).status, 'none');
  assert.equal(detectModule.detect(root), false);
  assert.equal(detectModule.apply(root).status, 'complete');
  assert.equal(completeModule.complete(root).status, 'complete');
});

test('sessions and no map file: the migration is needed, and pending until the map exists', (t) => {
  const root = makeCampaign(t, SESSIONS);
  assert.equal(plotFlowchartState(root).status, 'missing');
  assert.equal(detectModule.detect(root), true);
  assert.equal(detectModule.apply(root, { dryRun: true }).status, 'pending');
  const done = completeModule.complete(root);
  assert.equal(done.status, 'pending');
  assert.equal(done.errors[0].code, 'plot-flowchart-missing');
  assert.equal(fs.existsSync(path.join(root, 'Trama', 'Plot map.md')), false, 'detection writes nothing');
});

test('a map file that maps every session and scene passes: complete, and not needed again', (t) => {
  const root = makeCampaign(t, { ...SESSIONS, 'Trama/Plot map.md': MAP });
  assert.equal(plotFlowchartState(root).status, 'ok');
  assert.equal(detectModule.detect(root), false);
  assert.equal(detectModule.apply(root).status, 'complete');
  assert.deepEqual(completeModule.complete(root), { status: 'complete', errors: [] });
});

test('a scene that the map does not cite is an error: the migration stays pending', (t) => {
  const root = makeCampaign(t, { ...SESSIONS, 'Trama/The lake/Eventi/The lost boat.md': LOST, 'Trama/Plot map.md': MAP });
  const state = plotFlowchartState(root);
  assert.equal(state.status, 'errors');
  assert.ok(state.errors.some((error) => error.code === 'plot-flowchart-unmapped'));
  const done = completeModule.complete(root);
  assert.equal(done.status, 'pending');
  assert.ok(done.errors.some((error) => error.code === 'plot-flowchart-unmapped'));
});
