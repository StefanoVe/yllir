import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'geographic-layout.mjs');
const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

// Same campaign shape as the library test fixture; copied so the two test files stay independent.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-geo-cli-'));
  temporaryRoots.push(root);
  fs.writeFileSync(path.join(root, 'campaign.yaml'), [
    'language:', '  main: en', 'structure:',
    '  - id: plot', '    type: plot', '    folder: Plot',
    '  - id: places', '    type: places', '    folder: World',
    '  - id: people', '    type: subjects', '    folder: People',
    '  - id: objects', '    type: objects', '    folder: Objects',
  ].join('\n') + '\n');
  const put = (rel, body) => { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
  const place = (id, title) => `---\nid: ${id}\n---\n# ${title}\n`;
  put('World/World.md', place('world', 'World'));
  put('World/World/Coast/Coast.md', place('coast', 'Coast'));
  put('World/World/Coast/Port.md', place('port', 'Port'));
  put('World/World/Coast/Market.md', place('market', 'Market'));
  put('People/Ada.md', '---\nid: ada\nlocation: [port, market]\n---\n# Ada\n[Coast](../World/World/Coast/Coast.md)\n![map](img/portrait.png)\n');
  put('Objects/Relic.md', '---\nid: relic\nlocation: [port]\n---\n# Relic\n');
  put('Plot/Session 1/Event.md', '---\nid: arrival\nappearances:\n  - subject: ada\n    location: [port]\n  - subject: relic\n    location: [market]\n---\n# Arrival\n');
  put('People/img/portrait.png', 'image');
  return root;
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('plan then apply with --files reports the final paths of the named files', () => {
  const root = fixture();
  const planOut = '.campaign/state/write/plan.json';
  const appliedOut = '.campaign/state/write/applied.json';
  const planned = runCli([root, 'plan', '--out', planOut]);
  assert.equal(planned.status, 0, planned.stderr + planned.stdout);
  const applied = runCli([root, 'apply', '--plan', planOut, '--files', 'People/Ada.md,Objects/Relic.md', '--out', appliedOut]);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  assert.match(applied.stdout, /exit: 0\n$/);
  const result = JSON.parse(fs.readFileSync(path.join(root, appliedOut), 'utf8'));
  assert.equal(result.status, 'applied');
  assert.deepEqual(result.finalFiles, ['People/World/Coast/Ada.md', 'Objects/World/Coast/Relic.md']);
  assert(fs.existsSync(path.join(root, 'People/World/Coast/Ada.md')));
  assert(fs.existsSync(path.join(root, 'Objects/World/Coast/Relic.md')));
});

test('a usage error exits 2 and writes no file in the campaign', () => {
  const root = fixture();
  const result = runCli([root, 'apply', '--out', '.campaign/state/write/applied.json']);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /usage:/);
  assert.match(result.stdout, /exit: 2\n$/);
  assert.equal(fs.existsSync(path.join(root, '.campaign')), false);
});

test('an output path outside .campaign/state/write is refused with a non-zero exit', () => {
  const root = fixture();
  const result = runCli([root, 'plan', '--out', 'out/plan.json']);
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(root, 'out/plan.json')), false);
});
