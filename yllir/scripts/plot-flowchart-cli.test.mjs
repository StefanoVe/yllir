import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./engine.mjs', import.meta.url));

const CAMPAIGN = [
  'name: Test',
  'structure:',
  '  - id: trama',
  '    folder: Trama',
  '    type: plot',
  '',
].join('\n');

const SESSION = '---\nid: s1\ndepends_on: []\n---\n\n# Sessione 1\n\nTesto.\n';

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
  '  s1[Sessione 1]',
  '  %% path: s1 = Trama/Sessione 1/Sessione 1.md',
  '```',
  '',
].join('\n');

/** Creates a campaign folder with the given files (relative path -> content), runs body, then removes it. */
function withCampaign(files, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-flowchart-cli-'));
  const all = { 'campaign.yaml': CAMPAIGN, 'Trama/Sessione 1/Sessione 1.md': SESSION, ...files };
  try {
    for (const [rel, content] of Object.entries(all)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function cli(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

/** The JSON document a command printed, without the trailing `exit: <code>` line. */
function json(result) {
  return JSON.parse(result.stdout.slice(0, result.stdout.lastIndexOf('\nexit:')));
}

test('plot-flowchart prints an empty error list and exits 0 for a valid flowchart', () => {
  withCampaign({ 'Trama/Plot map.md': FLOWCHART }, (root) => {
    const result = cli(['plot-flowchart', root]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(json(result), []);
    assert.match(result.stdout, /\nexit: 0\n$/);
  });
});

test('plot-flowchart prints the errors and exits 1 when the flowchart is missing', () => {
  withCampaign({}, (root) => {
    const result = cli(['plot-flowchart', root]);
    assert.equal(result.status, 1);
    const errors = json(result);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'plot-flowchart-missing');
    assert.equal(errors[0].file, 'Trama/Plot map.md');
  });
});

test('plot-flowchart reports a bad path and an unmapped scene, sorted, with exit 1', () => {
  const broken = FLOWCHART.replace('Trama/Sessione 1/Sessione 1.md', 'Trama/Nope.md');
  const scene = '---\nid: s1-scena\nsession: s1\n---\n\n# Scena\n\nTesto.\n';
  withCampaign({ 'Trama/Plot map.md': broken, 'Trama/Sessione 1/Eventi/Scena.md': scene }, (root) => {
    const result = cli(['plot-flowchart', root]);
    assert.equal(result.status, 1);
    const errors = json(result);
    assert.deepEqual(errors.map((e) => e.code), ['plot-flowchart-bad-path', 'plot-flowchart-unmapped', 'plot-flowchart-unmapped']);
    assert.equal(errors[0].file, 'Trama/Plot map.md');
  });
});

test('plot-flowchart takes no options: an unexpected flag is a usage error with exit 2', () => {
  withCampaign({ 'Trama/Plot map.md': FLOWCHART }, (root) => {
    const result = cli(['plot-flowchart', root, '--files', 'x']);
    assert.equal(result.status, 2);
    assert.equal(json(result).error, 'usage');
  });
});
