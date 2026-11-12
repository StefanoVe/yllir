import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodePng, pngSize } from './png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP_JOB = path.join(HERE, '..', 'map-job.mjs');
const MAP_UVTT = path.join(HERE, '..', 'map-uvtt.mjs');

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function campaign() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-map-job-'));
  tmpDirs.push(root);
  fs.writeFileSync(path.join(root, 'campaign.yaml'), 'language:\n  main: it\n');
  fs.mkdirSync(path.join(root, 'Luoghi'));
  fs.writeFileSync(path.join(root, 'Luoghi', 'Taverna.md'), '# Taverna\n\nUn locale.\n');
  const layoutPath = path.join(root, 'layout-input.json');
  fs.writeFileSync(
    layoutPath,
    JSON.stringify({
      cols: 8,
      rows: 8,
      walls: [[0, 0, 8, 1]],
      doors: [{ id: 'door-cellar', cell: [3, 0], side: 'h' }],
      exits: [{ id: 'exit-street', cell: [7, 4] }],
      start: [1, 4],
      points: [{ id: 'bar', cell: [5, 3] }],
    }),
  );
  return { root, layoutPath };
}

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const lines = result.stdout.trim().split('\n');
  return { status: result.status, lines, text: result.stdout };
}

test('create, second create, bundle refused without art, then bundle and uvtt succeed', () => {
  const { root, layoutPath } = campaign();

  const first = run(MAP_JOB, [root, 'create', '--document', 'Luoghi/Taverna.md', '--layout', layoutPath]);
  assert.equal(first.status, 0, first.text);
  assert.deepEqual(first.lines.slice(0, 1), ['job: taverna-map-1']);
  assert.ok(first.lines.includes('size: 512x512'));
  assert.equal(first.lines.at(-1), 'exit: 0');
  const jobDir = path.join(root, '.campaign', 'state', 'maps', 'taverna-map-1');
  assert.ok(fs.existsSync(path.join(jobDir, 'layout.json')));
  assert.ok(fs.existsSync(path.join(jobDir, 'guide.png')));
  const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
  assert.deepEqual(job, { id: 'taverna-map-1', document: 'Luoghi/Taverna.md', cols: 8, rows: 8, cell: 64 });

  const second = run(MAP_JOB, [root, 'create', '--document', 'Luoghi/Taverna.md', '--layout', layoutPath]);
  assert.equal(second.status, 0, second.text);
  assert.equal(second.lines[0], 'job: taverna-map-2');

  const early = run(MAP_JOB, [root, 'bundle', '--job', 'taverna-map-1']);
  assert.equal(early.status, 1);
  assert.ok(early.lines.includes('error: bad-art'));
  assert.equal(early.lines.at(-1), 'exit: 1');

  fs.mkdirSync(path.join(jobDir, 'fit'));
  const wrong = encodePng(64, 64, new Uint8Array(64 * 64 * 3));
  fs.writeFileSync(path.join(jobDir, 'fit', 'background.png'), wrong);
  const mismatch = run(MAP_JOB, [root, 'bundle', '--job', 'taverna-map-1']);
  assert.equal(mismatch.status, 1);
  assert.ok(mismatch.lines.includes('error: bad-art'));

  const right = encodePng(512, 512, new Uint8Array(512 * 512 * 3).fill(128));
  fs.writeFileSync(path.join(jobDir, 'fit', 'background.png'), right);
  const bundle = run(MAP_JOB, [root, 'bundle', '--job', 'taverna-map-1']);
  assert.equal(bundle.status, 0, bundle.text);
  assert.ok(bundle.lines.includes(`bundle: ${path.join(jobDir, 'map-bundle.json')}`));
  const written = JSON.parse(fs.readFileSync(path.join(jobDir, 'map-bundle.json'), 'utf8'));
  assert.equal(written.schema, 'generate2dmap.map_bundle.v2');
  assert.equal(written.id, 'taverna-map-1');

  const uvtt = run(MAP_UVTT, [root, '--job', 'taverna-map-1']);
  assert.equal(uvtt.status, 0, uvtt.text);
  const data = JSON.parse(fs.readFileSync(path.join(jobDir, 'map.uvtt'), 'utf8'));
  assert.equal(data.format, 0.3);
  assert.equal(data.portals.length, 1);
  assert.equal(pngSize(Buffer.from(data.image, 'base64')).width, 512);
});

test('create refuses a missing document and an invalid layout with problem lines', () => {
  const { root, layoutPath } = campaign();
  const missing = run(MAP_JOB, [root, 'create', '--document', 'Luoghi/Nessuno.md', '--layout', layoutPath]);
  assert.equal(missing.status, 1);
  assert.ok(missing.lines.includes('error: not-found'));

  const badPath = path.join(root, 'bad-layout.json');
  fs.writeFileSync(badPath, JSON.stringify({ cols: 8, rows: 8, walls: [], exits: [{ id: 'x', cell: [3, 3] }], start: [1, 1] }));
  const bad = run(MAP_JOB, [root, 'create', '--document', 'Luoghi/Taverna.md', '--layout', badPath]);
  assert.equal(bad.status, 1);
  assert.ok(bad.lines.includes('error: bad-layout'));
  assert.ok(bad.lines.some((line) => line.startsWith('problem: not-border ')));
});

test('a usage error exits 2', () => {
  const { root } = campaign();
  const result = run(MAP_JOB, [root, 'create', '--document']);
  assert.equal(result.status, 2);
});
