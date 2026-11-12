import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)));
const run = (script, args) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8' });

test('music-query prints a JSON query and exits 0 for a usable place', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-cli-'));
  fs.writeFileSync(path.join(root, 'campaign.yaml'), 'schema: 1\nstructure:\n  - id: places\n    folder: Places\n    type: places\nmodules:\n  music: true\n');
  fs.mkdirSync(path.join(root, 'Places'));
  fs.writeFileSync(path.join(root, 'Places', 'Harbor.md'), '<!-- yllir\nid: harbor\nkind: place\nprovenance: master\nlocation: []\n-->\n\n# Harbor\n\nThe fog and the rain.\n');
  const result = run('music-query.mjs', [root, '--place', 'Places/Harbor.md']);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, true);
  assert.match(json.query, /harbor/);
  assert.match(json.query, /fog/);
});

test('music-query usage errors exit 2', () => {
  assert.equal(run('music-query.mjs', []).status, 2);
});

test('verify-link refuses without touching the network', () => {
  const result = run('verify-link.mjs', ['http://youtube.com/x']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).reason, 'not-https');
  assert.equal(run('verify-link.mjs', []).status, 2);
});

test('music-links format prints the Markdown line', () => {
  const out = execFileSync(process.execPath, [path.join(SCRIPTS, 'music-links.mjs'), 'format', '--title', 'Night', '--url', 'https://youtu.be/abc', '--mood', 'calm'], { encoding: 'utf8' });
  assert.equal(out, '- [Night](https://youtu.be/abc) — calm\n');
  assert.equal(run('music-links.mjs', ['format', '--title', 'x']).status, 2);
});
