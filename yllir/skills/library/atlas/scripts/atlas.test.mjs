import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripExitLine } from '../../../../scripts/lib/cli-exit.mjs';
import {
  cleanupCampaigns, standardCampaign, makeCampaign, campaignYaml, terrainLayer, placesLayer,
  landFeature, square, readAtlasFile,
} from './lib/test-support.mjs';

after(cleanupCampaigns);

const CLI = fileURLToPath(new URL('./atlas.mjs', import.meta.url));

/** Runs the CLI; returns the exit code and stdout, whatever the exit code is. */
function run(...args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

function lastLine(stdout) {
  return stdout.trimEnd().split('\n').at(-1);
}

/** Parses the JSON printed by the CLI (everything before the exit line). */
function json(stdout) {
  return JSON.parse(stripExitLine(stdout));
}

function writeJsonFile(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function scopeFile(root, scope = { kind: 'region', places: ['north'] }) {
  return writeJsonFile(path.join(root, 'scope.json'), {
    scope,
    canvas: { width: 1000, height: 1000 },
    seed: 7,
    style: 'default',
  });
}

function movedTerrain() {
  const layer = terrainLayer();
  layer.features[0].polygon[2] = [880, 880];
  return layer;
}

test('no arguments: usage on stderr and exit 2 as the last line', () => {
  const result = run();
  assert.equal(result.code, 2);
  assert.equal(lastLine(result.stdout), 'exit: 2');
});

test('init then init again gives exit 1 atlas-exists', () => {
  const root = standardCampaign();
  const scope = scopeFile(root);
  const first = run('init', root, scope);
  assert.equal(first.code, 0);
  assert.equal(lastLine(first.stdout), 'exit: 0');
  assert.ok(fs.existsSync(path.join(root, 'Atlas', 'atlas.json')));

  const second = run('init', root, scope);
  assert.equal(second.code, 1);
  assert.equal(json(second.stdout).problems[0].code, 'atlas-exists');
  assert.equal(lastLine(second.stdout), 'exit: 1');
});

test('init with an invalid manifest writes nothing', () => {
  const root = standardCampaign();
  const bad = writeJsonFile(path.join(root, 'bad.json'), { scope: { kind: 'planet', places: [] } });
  const result = run('init', root, bad);
  assert.equal(result.code, 1);
  assert.equal(fs.existsSync(path.join(root, 'Atlas', 'atlas.json')), false);
});

test('write-layer writes a valid terrain layer and the manifest entry', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  const candidate = writeJsonFile(path.join(root, 'terrain.json'), terrainLayer());
  const result = run('write-layer', root, 'terrain', candidate);
  assert.equal(result.code, 0);
  assert.equal(json(result.stdout).ok, true);
  assert.equal(JSON.parse(readAtlasFile(root, 'terrain.json')).layer, 'terrain');
  assert.deepEqual(JSON.parse(readAtlasFile(root, 'atlas.json')).layers.terrain, { locked: false });
});

test('lock, then a changed terrain is refused and the file is unchanged on disk', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  const good = writeJsonFile(path.join(root, 'terrain.json'), terrainLayer());
  assert.equal(run('write-layer', root, 'terrain', good).code, 0);

  const locked = run('lock', root, 'terrain');
  assert.equal(locked.code, 0);
  assert.equal(json(locked.stdout).features, 1);
  assert.equal(lastLine(locked.stdout), 'exit: 0');

  const before = readAtlasFile(root, 'terrain.json');
  const changed = writeJsonFile(path.join(root, 'moved.json'), movedTerrain());
  const refused = run('write-layer', root, 'terrain', changed);
  assert.equal(refused.code, 1);
  assert.equal(json(refused.stdout).ok, false);
  assert.ok(json(refused.stdout).changed.includes('land-main'));
  assert.equal(lastLine(refused.stdout), 'exit: 1');
  assert.equal(readAtlasFile(root, 'terrain.json'), before);
});

test('write-layer with --unlock writes the changed locked layer and unlocks it', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  const good = writeJsonFile(path.join(root, 'terrain.json'), terrainLayer());
  run('write-layer', root, 'terrain', good);
  run('lock', root, 'terrain');

  const changed = writeJsonFile(path.join(root, 'moved.json'), movedTerrain());
  const result = run('write-layer', root, 'terrain', changed, '--unlock');
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(readAtlasFile(root, 'atlas.json')).layers.terrain, { locked: false });
  assert.equal(JSON.parse(readAtlasFile(root, 'terrain.json')).features[0].polygon[2][0], 880);
});

test('write-layer refuses a new land overlapping locked land, unless unlocked', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  run('write-layer', root, 'terrain', writeJsonFile(path.join(root, 't.json'), terrainLayer()));
  run('lock', root, 'terrain');

  const clash = terrainLayer([
    landFeature('land-main', square(100, 100, 900, 900)),
    landFeature('land-clash', square(300, 300, 400, 400)),
  ]);
  const result = run('write-layer', root, 'terrain', writeJsonFile(path.join(root, 'clash.json'), clash));
  assert.equal(result.code, 1);
  assert.deepEqual(json(result.stdout).overlaps, ['land-clash']);
});

test('status shows the places in scope that have no feature yet', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root, { kind: 'region', places: ['north'] }));
  const result = run('status', root);
  assert.equal(result.code, 0);
  const status = json(result.stdout);
  assert.equal(status.folder, 'Atlas');
  assert.equal(status.exists, true);
  assert.deepEqual(status.pending.map((p) => p.id), ['north', 'port-ash']);
  assert.equal(status.layers.terrain.present, false);
  assert.equal(lastLine(result.stdout), 'exit: 0');
});

test('status without an atlas folder exits 1', () => {
  const root = makeCampaign({}, { yaml: campaignYaml([{ id: 'luoghi', folder: 'World', type: 'places' }]) });
  const result = run('status', root);
  assert.equal(result.code, 1);
  assert.equal(json(result.stdout).folder, null);
  assert.equal(lastLine(result.stdout), 'exit: 1');
});

test('validate exits 0 on a valid atlas and 1 when a layer breaks a rule', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  run('write-layer', root, 'terrain', writeJsonFile(path.join(root, 't.json'), terrainLayer()));
  const place = writeJsonFile(path.join(root, 'p.json'), placesLayer([['north', [500, 500]]]));
  assert.equal(run('write-layer', root, 'places', place).code, 0);
  assert.equal(run('validate', root).code, 0);

  fs.writeFileSync(path.join(root, 'Atlas', 'places.json'), JSON.stringify(placesLayer([['ghost', [500, 500]]]), null, 2));
  const broken = run('validate', root);
  assert.equal(broken.code, 1);
  assert.ok(json(broken.stdout).problems.some((p) => p.code === 'unknown-place'));
  assert.equal(lastLine(broken.stdout), 'exit: 1');
});

test('lock refuses a layer file that is missing', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  const result = run('lock', root, 'relief');
  assert.equal(result.code, 1);
  assert.equal(json(result.stdout).problems[0].code, 'missing-layer');
});
