import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripExitLine } from '../../../../scripts/lib/cli-exit.mjs';
import { pngSize, encodePng } from '../../../../scripts/lib/png.mjs';
import {
  cleanupCampaigns, standardCampaign, makeCampaign, campaignYaml, terrainLayer, placesLayer, STRUCTURE,
  landFeature, square, readAtlasFile, placeSheet, writeAtlas, baseManifest, buildingsLayer,
} from './lib/test-support.mjs';
import { listStyles } from './lib/styles.mjs';
import { LAYERS, readAtlas } from './lib/model.mjs';
import { BAKE_INPUT, layersHash } from './lib/bake.mjs';
import { pointInPolygon } from './lib/geometry.mjs';

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

test('status shows the places in scope that have no feature yet; a listed place counts as placed', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root, { kind: 'region', places: ['north'] }));
  const result = run('status', root);
  assert.equal(result.code, 0);
  const status = json(result.stdout);
  assert.equal(status.folder, 'Atlas');
  assert.equal(status.exists, true);
  assert.deepEqual(status.pending.map((p) => p.id), ['port-ash']);
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

const landmassConstraint = (id, center, radius) => ({
  kind: 'landmass', id, center, radius, provenance: 'master', sources: [],
});

function writeConstraints(root, constraints) {
  return writeJsonFile(path.join(root, 'constraints.json'), { layer: 'terrain', constraints, features: [] });
}

function readTerrain(root) {
  return JSON.parse(readAtlasFile(root, 'terrain.json'));
}

test('generate-terrain builds the land from the constraints in terrain.json and writes it', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  assert.equal(run('write-layer', root, 'terrain', writeConstraints(root, [landmassConstraint('main', [500, 500], [300, 300])])).code, 0);

  const result = run('generate-terrain', root);
  assert.equal(result.code, 0);
  const out = json(result.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.written, 'Atlas/terrain.json');
  assert.ok(out.features >= 1);
  assert.deepEqual(out.problems, []);
  assert.equal(readTerrain(root).features[0].id, 'land-1');
  assert.equal(lastLine(result.stdout), 'exit: 0');
});

test('generate-terrain without terrain.json exits 1 and writes nothing', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  const result = run('generate-terrain', root);
  assert.equal(result.code, 1);
  assert.equal(json(result.stdout).problems[0].code, 'missing-layer');
  assert.equal(fs.existsSync(path.join(root, 'Atlas', 'terrain.json')), false);
});

test('generate-terrain on a locked layer accepts an appended constraint and refuses an edited first one', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  run('write-layer', root, 'terrain', writeConstraints(root, [landmassConstraint('main', [500, 500], [300, 300])]));
  assert.equal(run('generate-terrain', root).code, 0);
  assert.equal(run('lock', root, 'terrain').code, 0);
  const lockedFeatures = readTerrain(root).features;

  // Append a constraint: allowed, the locked land is kept as it was.
  const terrain = readTerrain(root);
  terrain.constraints.push(landmassConstraint('far-isle', [120, 120], [60, 60]));
  fs.writeFileSync(path.join(root, 'Atlas', 'terrain.json'), `${JSON.stringify(terrain, null, 2)}\n`);
  const extended = run('generate-terrain', root);
  assert.equal(extended.code, 0, extended.stdout);
  const after = readTerrain(root);
  assert.deepEqual(after.features.slice(0, lockedFeatures.length), lockedFeatures);
  assert.equal(after.features.length > lockedFeatures.length, true);

  // Edit the first constraint: refused, and the file is unchanged.
  const edited = readTerrain(root);
  edited.constraints[0].radius = [200, 200];
  fs.writeFileSync(path.join(root, 'Atlas', 'terrain.json'), `${JSON.stringify(edited, null, 2)}\n`);
  const before = readAtlasFile(root, 'terrain.json');
  const refused = run('generate-terrain', root);
  assert.equal(refused.code, 1);
  assert.equal(json(refused.stdout).ok, false);
  assert.ok(json(refused.stdout).changed.includes('(constraints)'));
  assert.equal(readAtlasFile(root, 'terrain.json'), before);
});

test('preview writes the PNG under the campaign cache and prints its path', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  run('write-layer', root, 'terrain', writeConstraints(root, [landmassConstraint('main', [500, 500], [300, 300])]));
  run('generate-terrain', root);
  const result = run('preview', root);
  assert.equal(result.code, 0);
  assert.deepEqual(json(result.stdout), { ok: true, file: '.campaign/cache/atlas/preview.png' });
  const png = fs.readFileSync(path.join(root, '.campaign', 'cache', 'atlas', 'preview.png'));
  assert.deepEqual(pngSize(png), { width: 1024, height: 1024 });
});

test('generate <root> relief writes relief.json from its range constraints', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  run('write-layer', root, 'terrain', writeJsonFile(path.join(root, 't.json'), terrainLayer()));
  const relief = {
    layer: 'relief',
    constraints: [{ kind: 'range', id: 'peaks', type: 'mountains', spine: [[200, 500], [800, 500]], width: 120, provenance: 'master', sources: [] }],
    features: [],
  };
  assert.equal(run('write-layer', root, 'relief', writeJsonFile(path.join(root, 'r.json'), relief)).code, 0);
  const result = run('generate', root, 'relief');
  assert.equal(result.code, 0);
  assert.equal(json(result.stdout).ok, true);
  const written = JSON.parse(readAtlasFile(root, 'relief.json'));
  assert.equal(written.features[0].id, 'peaks');
  assert.equal(written.features[0].type, 'mountains');
});

test('generate <root> routes without places gives exit 1 missing-prerequisite and writes nothing', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  run('write-layer', root, 'terrain', writeJsonFile(path.join(root, 't.json'), terrainLayer()));
  const routes = {
    layer: 'routes',
    constraints: [{ kind: 'road', id: 'road-ab', from: 'north', to: 'south', provenance: 'master', sources: [] }],
    features: [],
  };
  run('write-layer', root, 'routes', writeJsonFile(path.join(root, 'ro.json'), routes));
  const result = run('generate', root, 'routes');
  assert.equal(result.code, 1);
  assert.equal(json(result.stdout).problems[0].code, 'missing-prerequisite');
  assert.equal(lastLine(result.stdout), 'exit: 1');
  assert.deepEqual(JSON.parse(readAtlasFile(root, 'routes.json')).features, []);
});

test('generate-terrain still works as an alias of generate terrain; an unknown layer is a usage error', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  run('write-layer', root, 'terrain', writeJsonFile(path.join(root, 't.json'), terrainLayer()));
  const alias = run('generate-terrain', root);
  assert.equal(alias.code, 0);
  assert.equal(json(alias.stdout).ok, true);
  assert.equal(run('generate', root, 'volcanoes').code, 2);
});

/** A campaign.yaml that passes validateConfig, with the given language and categories. */
function validYaml(language, structure) {
  return [
    'schema: 1',
    'campaign:',
    '  name: "Test"',
    '  slug: test-campaign',
    '  created: 2026-11-01',
    'language:',
    `  main: ${language}`,
    '  other: []',
    'prose:',
    '  register: plain',
    'system:',
    '  adapter: none',
    'structure:',
    ...structure.flatMap((c) => [`  - id: ${c.id}`, `    folder: ${c.folder}`, `    type: ${c.type}`]),
    '',
  ].join('\n');
}

const PLACES_ONLY = [{ id: 'luoghi', folder: 'World', type: 'places' }, { id: 'persone', folder: 'People', type: 'subjects' }];

test('places lists every place with its parent from the folders, sorted by file, and the placed ones with their point', () => {
  const root = standardCampaign();
  run('init', root, scopeFile(root));
  run('write-layer', root, 'places', writeJsonFile(path.join(root, 'p.json'), placesLayer([['north', [300, 400]]])));
  const result = run('places', root);
  assert.equal(result.code, 0);
  assert.equal(lastLine(result.stdout), 'exit: 0');
  const out = json(result.stdout);
  assert.deepEqual(out.places.map((p) => p.file), ['World/North/North.md', 'World/North/Port Ash.md', 'World/South.md']);
  const [north, ash, south] = out.places;
  assert.deepEqual(
    { id: north.id, parent: north.parent, placed: north.placed, at: north.at, icon: north.icon },
    { id: 'north', parent: null, placed: true, at: [300, 400], icon: 'town' },
  );
  assert.equal(ash.parent, 'north');
  assert.equal(ash.placed, false);
  assert.equal(ash.at, null);
  assert.equal(south.parent, null);
  assert.deepEqual(out.scope, { kind: 'region', places: ['north'] });
});

test('places without an atlas folder lists the places as not placed, with scope null, and exits 0', () => {
  const root = makeCampaign({
    'World/North/North.md': placeSheet({ id: 'north', title: 'North' }),
    'World/North/Port Ash.md': placeSheet({ id: 'port-ash', title: 'Port Ash' }),
  }, { yaml: validYaml('en', PLACES_ONLY) });
  const result = run('places', root);
  assert.equal(result.code, 0);
  const out = json(result.stdout);
  assert.equal(out.scope, null);
  assert.deepEqual(out.places.map((p) => [p.id, p.parent, p.placed]), [['north', null, false], ['port-ash', 'north', false]]);
});

test('init on a campaign with no atlas category adds it (Atlante in Italian) and turns the module on', () => {
  const root = makeCampaign({ 'World/North/North.md': placeSheet({ id: 'north', title: 'North' }) }, { yaml: validYaml('it', PLACES_ONLY) });
  fs.rmSync(path.join(root, 'Atlas'), { recursive: true, force: true });
  const result = run('init', root, scopeFile(root));
  assert.equal(result.code, 0, result.stdout);
  const out = json(result.stdout);
  assert.equal(out.written, 'Atlante/atlas.json');
  assert.equal(out.categoryAdded, true);
  assert.equal(out.moduleEnabled, true);
  const yaml = fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8');
  assert.match(yaml, /folder: "?Atlante"?\n    type: atlas/);
  assert.match(yaml, /modules:\n  atlas: true/);
  assert.ok(fs.existsSync(path.join(root, 'Atlante', 'atlas.json')));
});

test('init in an English campaign uses the folder Atlas; a second init is refused and campaign.yaml is unchanged', () => {
  const root = makeCampaign({ 'World/North/North.md': placeSheet({ id: 'north', title: 'North' }) }, { yaml: validYaml('en', PLACES_ONLY) });
  const scope = scopeFile(root);
  assert.equal(run('init', root, scope).code, 0);
  assert.ok(fs.existsSync(path.join(root, 'Atlas', 'atlas.json')));
  const before = fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8');
  const second = run('init', root, scope);
  assert.equal(second.code, 1);
  assert.equal(json(second.stdout).problems[0].code, 'atlas-exists');
  assert.equal(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8'), before);
});

test('init picks another folder name when Atlante is already a category, and fills the defaults of seed, canvas and style', () => {
  const structure = [...PLACES_ONLY, { id: 'storia', folder: 'Atlante', type: 'free' }];
  const root = makeCampaign({ 'World/North/North.md': placeSheet({ id: 'north', title: 'North' }) }, { yaml: validYaml('it', structure) });
  fs.mkdirSync(path.join(root, 'Atlante'));
  fs.writeFileSync(path.join(root, 'scope.json'), JSON.stringify({ scope: { kind: 'region', places: ['north'] } }));
  const result = run('init', root, path.join(root, 'scope.json'));
  assert.equal(result.code, 0, result.stdout);
  assert.equal(json(result.stdout).written, 'Atlante della campagna/atlas.json');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Atlante della campagna', 'atlas.json'), 'utf8'));
  const slugSeed = parseInt(crypto.createHash('sha256').update('test-campaign').digest('hex').slice(0, 7), 16);
  assert.equal(manifest.seed, slugSeed);
  assert.deepEqual(manifest.canvas, { width: 4000, height: 3000 });
  assert.equal(manifest.style, 'fantasy-color');
});

test('init with a refused scope leaves campaign.yaml exactly as it was', () => {
  const root = makeCampaign({ 'World/North/North.md': placeSheet({ id: 'north', title: 'North' }) }, { yaml: validYaml('it', PLACES_ONLY) });
  const before = fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8');
  const bad = writeJsonFile(path.join(root, 'bad.json'), { scope: { kind: 'planet', places: [] } });
  assert.equal(run('init', root, bad).code, 1);
  assert.equal(fs.readFileSync(path.join(root, 'campaign.yaml'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, 'Atlante')), false);
});

test('--open is accepted only by preview and render; elsewhere it is a usage error', () => {
  const root = standardCampaign();
  assert.equal(run('status', root, '--open').code, 2);
  assert.equal(run('places', root, '--open').code, 2);
});

/** A campaign with a valid atlas (terrain and one place), style fantasy-color. */
function renderableCampaign() {
  const root = standardCampaign();
  writeAtlas(root, {
    manifest: baseManifest({ style: 'fantasy-color' }),
    layers: { terrain: terrainLayer(), places: placesLayer([['north', [500, 500]]]) },
  });
  return root;
}

/** The bytes of every layer file of the atlas, by name. */
function layerBytes(root) {
  const out = {};
  for (const name of ['terrain', 'places']) out[name] = readAtlasFile(root, `${name}.json`);
  return out;
}

test('render writes the master export and prints its result with exit 0', () => {
  const root = renderableCampaign();
  const result = run('render', root);
  assert.equal(result.code, 0, result.stdout);
  const out = json(result.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.dir, '.campaign/cache/atlas/master');
  assert.equal(out.stats.places, 1);
  assert.deepEqual(out.checks, []);
  assert.deepEqual(out.problems, []);
  assert.ok(fs.existsSync(path.join(root, out.dir, 'index.html')));
});

test('render --audience players writes the players export and runs its checks', () => {
  const root = renderableCampaign();
  const result = run('render', root, '--audience', 'players');
  assert.equal(result.code, 0, result.stdout);
  const out = json(result.stdout);
  assert.equal(out.dir, '.campaign/cache/atlas/players');
  assert.deepEqual(out.checks.map((c) => c.status), ['pass', 'pass', 'pass']);
});

test('render of an atlas that does not validate exits 1 with dir null; --open does not open a failed build', () => {
  const root = standardCampaign();
  writeAtlas(root, {
    manifest: baseManifest({ style: 'fantasy-color' }),
    layers: { terrain: terrainLayer(), places: placesLayer([['ghost', [500, 500]]]) },
  });
  const result = run('render', root, '--open');
  assert.equal(result.code, 1);
  const out = json(result.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.dir, null);
  assert.ok(out.problems.some((p) => p.code === 'unknown-place'));
  assert.equal(out.opened, undefined);
});

test('render takes only the audience master or players, and --audience only on render', () => {
  const root = renderableCampaign();
  assert.equal(run('render', root, '--audience', 'gm').code, 2);
  assert.equal(run('render', root, '--audience').code, 2);
  assert.equal(run('status', root, '--audience', 'players').code, 2);
});

test('styles prints the installed styles and the one the atlas uses, and writes nothing', () => {
  const root = renderableCampaign();
  const before = layerBytes(root);
  const result = run('styles', root);
  assert.equal(result.code, 0, result.stdout);
  const out = json(result.stdout);
  const fantasy = out.styles.find((s) => s.id === 'fantasy-color');
  assert.ok(fantasy && fantasy.installed === true);
  assert.deepEqual(out.current, { id: 'fantasy-color', source: 'master', requested: null });
  assert.deepEqual(layerBytes(root), before);
});

test('set-style with an unknown id exits 1 unknown-style and leaves atlas.json as it was', () => {
  const root = renderableCampaign();
  const atlasBefore = readAtlasFile(root, 'atlas.json');
  const result = run('set-style', root, 'no-such-style');
  assert.equal(result.code, 1);
  assert.equal(json(result.stdout).problems[0].code, 'unknown-style');
  assert.equal(readAtlasFile(root, 'atlas.json'), atlasBefore);
});

test('set-style to an installed style, and to auto, writes only the style of atlas.json', () => {
  const root = renderableCampaign();
  const layers = layerBytes(root);
  const installed = run('set-style', root, 'fantasy-color');
  assert.equal(installed.code, 0, installed.stdout);
  assert.deepEqual(json(installed.stdout), { ok: true, style: 'fantasy-color', problems: [] });
  assert.equal(JSON.parse(readAtlasFile(root, 'atlas.json')).style, 'fantasy-color');
  assert.deepEqual(layerBytes(root), layers);

  const auto = run('set-style', root, 'auto');
  assert.equal(auto.code, 0, auto.stdout);
  assert.equal(JSON.parse(readAtlasFile(root, 'atlas.json')).style, 'auto');
  assert.deepEqual(layerBytes(root), layers);
});

const NOT_INSTALLED = listStyles().filter((s) => !s.installed).map((s) => s.id);
test('set-style to a listed style that is not installed exits 1 style-not-installed', {
  skip: NOT_INSTALLED.length === 0 ? 'every listed style is installed' : false,
}, () => {
  const root = renderableCampaign();
  const atlasBefore = readAtlasFile(root, 'atlas.json');
  const result = run('set-style', root, NOT_INSTALLED[0]);
  assert.equal(result.code, 1);
  assert.equal(json(result.stdout).problems[0].code, 'style-not-installed');
  assert.equal(readAtlasFile(root, 'atlas.json'), atlasBefore);
});

/** A point inside a polygon: the first point of a 5-unit grid over its bounding box that pointInPolygon accepts. */
function insideOf(polygon) {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  for (let y = Math.min(...ys); y <= Math.max(...ys); y += 5) {
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 5) {
      if (pointInPolygon([x, y], polygon)) return [x, y];
    }
  }
  return null;
}

test('an urban atlas: init at the urban canvas, generate its layers with an empty blocks list, place a building, and refuse a change to locked ground', () => {
  const root = standardCampaign();
  const scope = writeJsonFile(path.join(root, 'scope.json'), { scope: { kind: 'settlement', places: ['north'] } });
  const init = run('init', root, scope);
  assert.equal(init.code, 0, init.stdout);
  assert.deepEqual(JSON.parse(readAtlasFile(root, 'atlas.json')).canvas, { width: 2400, height: 1800 });

  const candidate = (name, constraints) => writeJsonFile(path.join(root, `${name}-candidate.json`), { layer: name, constraints, features: [] });
  const river = { kind: 'river', id: 'river-main', source: [0, 900], mouth: [2400, 1000], via: [[1200, 950]], width: 60, provenance: 'master', sources: [] };
  const mainStreet = { kind: 'street', id: 'main-street', rank: 'main', path: [[200, 600], [2200, 600]], provenance: 'master', sources: [] };
  const marketSquare = { kind: 'square', id: 'market-square', at: [1200, 1200], size: [160, 120], provenance: 'master', sources: [] };
  const townWall = {
    kind: 'wall',
    id: 'town-wall',
    ring: [[300, 300], [2100, 300], [2100, 1500], [300, 1500]],
    thickness: 12,
    towers: 'corners',
    gates: [{ at: [1200, 300], width: 30 }],
    provenance: 'master',
    sources: [],
  };
  assert.equal(run('write-layer', root, 'ground', candidate('ground', [river])).code, 0);
  assert.equal(run('write-layer', root, 'streets', candidate('streets', [mainStreet, marketSquare])).code, 0);
  assert.equal(run('write-layer', root, 'walls', candidate('walls', [townWall])).code, 0);
  assert.equal(run('write-layer', root, 'green', candidate('green', [])).code, 0);
  assert.equal(run('write-layer', root, 'blocks', candidate('blocks', [])).code, 0);
  assert.equal(run('write-layer', root, 'districts', candidate('districts', [])).code, 0);

  for (const name of ['ground', 'green', 'walls', 'streets', 'blocks', 'districts']) {
    const result = run('generate', root, name);
    assert.equal(result.code, 0, `${name}: ${result.stdout}`);
    assert.equal(json(result.stdout).ok, true);
  }
  const blocks = JSON.parse(readAtlasFile(root, 'blocks.json'));
  assert.deepEqual(blocks.constraints, []);
  assert.ok(blocks.features.length > 0);
  const spot = insideOf(blocks.features[0].polygon);
  assert.ok(spot, 'a block with a point inside');

  const buildings = writeJsonFile(path.join(root, 'buildings-candidate.json'), buildingsLayer([['north', spot, 'tavern']]));
  assert.equal(run('write-layer', root, 'buildings', buildings).code, 0);

  const valid = run('validate', root);
  assert.equal(valid.code, 0, valid.stdout);
  assert.equal(json(valid.stdout).ok, true);

  const status = run('status', root);
  assert.equal(status.code, 0);
  const out = json(status.stdout);
  assert.deepEqual(Object.keys(out.layers), LAYERS);
  assert.equal(out.layers.ground.present, true);
  assert.equal(out.layers.buildings.features, 1);
  assert.deepEqual(out.pending.map((p) => p.id), ['port-ash']);

  const places = run('places', root);
  assert.equal(places.code, 0);
  const listed = json(places.stdout).places;
  const north = listed.find((p) => p.id === 'north');
  assert.deepEqual(
    { placed: north.placed, at: north.at, icon: north.icon },
    { placed: true, at: spot, icon: 'tavern' },
  );
  assert.equal(listed.find((p) => p.id === 'port-ash').placed, false);

  assert.equal(run('lock', root, 'ground').code, 0);
  const before = readAtlasFile(root, 'ground.json');
  const widened = writeJsonFile(path.join(root, 'ground-changed.json'), { layer: 'ground', constraints: [{ ...river, width: 80 }], features: [] });
  const refused = run('write-layer', root, 'ground', widened);
  assert.equal(refused.code, 1);
  assert.equal(json(refused.stdout).ok, false);
  assert.equal(readAtlasFile(root, 'ground.json'), before);
});

test('generate-terrain on an urban atlas is allowed: the terrain layer is a layer of every atlas', () => {
  const root = standardCampaign();
  const scope = writeJsonFile(path.join(root, 'scope.json'), { scope: { kind: 'settlement', places: ['north'] } });
  assert.equal(run('init', root, scope).code, 0);
  assert.equal(run('write-layer', root, 'terrain', writeConstraints(root, [landmassConstraint('main', [1200, 900], [900, 700])])).code, 0);
  const result = run('generate-terrain', root);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(readTerrain(root).features[0].id, 'land-1');
  assert.equal(lastLine(result.stdout), 'exit: 0');
});

/** A layer file (constraints only) for write-layer, for any layer name. */
function writeLayerConstraints(root, name, constraints) {
  return writeJsonFile(path.join(root, `${name}-constraints.json`), { layer: name, constraints, features: [] });
}

test('a region with a generated terrain takes a river, streets and blocks in a small area; validate is ok and status lists every layer', () => {
  const root = standardCampaign();
  assert.equal(run('init', root, scopeFile(root)).code, 0);
  assert.equal(run('write-layer', root, 'terrain', writeConstraints(root, [landmassConstraint('main', [500, 500], [300, 300])])).code, 0);
  assert.equal(run('generate', root, 'terrain').code, 0);

  const river = { kind: 'river', id: 'river-small', source: [420, 200], mouth: [560, 260], width: 12, provenance: 'master', sources: [] };
  const street = { kind: 'street', id: 'small-street', rank: 'main', path: [[400, 520], [600, 520]], provenance: 'master', sources: [] };
  const fill = { kind: 'fill', id: 'town', character: 'common', provenance: 'master', sources: [] };
  assert.equal(run('write-layer', root, 'ground', writeLayerConstraints(root, 'ground', [river])).code, 0);
  assert.equal(run('write-layer', root, 'streets', writeLayerConstraints(root, 'streets', [street])).code, 0);
  for (const name of ['ground', 'streets']) {
    const generated = run('generate', root, name);
    assert.equal(generated.code, 0, `${name}: ${generated.stdout}`);
  }
  assert.equal(run('write-layer', root, 'blocks', writeLayerConstraints(root, 'blocks', [fill])).code, 0);
  const blocks = run('generate', root, 'blocks');
  assert.equal(blocks.code, 0, blocks.stdout);
  assert.ok(json(blocks.stdout).features > 0);

  const valid = run('validate', root);
  assert.equal(valid.code, 0, valid.stdout);
  assert.equal(json(valid.stdout).ok, true);

  const status = json(run('status', root).stdout);
  assert.deepEqual(Object.keys(status.layers), LAYERS);
  assert.equal(status.layers.terrain.features, 1);
  assert.equal(status.layers.ground.features, 1);
  assert.equal(status.layers.streets.features, 1);
  assert.ok(status.layers.blocks.features > 0);
  assert.equal(status.layers.biomes.present, false);
});

test('an urban atlas with only urban layers: generate biomes works on a synthetic terrain, which is not written to disk', () => {
  const root = standardCampaign();
  const scope = writeJsonFile(path.join(root, 'scope.json'), { scope: { kind: 'settlement', places: [] } });
  assert.equal(run('init', root, scope).code, 0);
  const forest = { kind: 'biome', id: 'woods', type: 'forest', at: [1800, 1200], radius: 300, provenance: 'master', sources: [] };
  assert.equal(run('write-layer', root, 'biomes', writeLayerConstraints(root, 'biomes', [forest])).code, 0);
  const result = run('generate', root, 'biomes');
  assert.equal(result.code, 0, result.stdout);
  assert.equal(json(result.stdout).ok, true);
  assert.ok(json(result.stdout).features >= 1);
  assert.equal(fs.existsSync(path.join(root, 'Atlas', 'terrain.json')), false);
  assert.equal(run('validate', root).code, 0);
});

// ---- the bake: bake-input, bake-set, bake-clear, and the bake field of status ----

const bakeDirs = [];
after(() => {
  for (const dir of bakeDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Runs the CLI with extra environment variables (the rasterizer stub). */
function runEnv(env, ...args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

/**
 * A stub rasterizer module for YLLIR_ATLAS_RASTERIZER_STUB. It records the SVG, the width and the resourcesDir it
 * was given in `log`, and returns a PNG of that width (half as high), or throws rasterizer-unavailable.
 */
function rasterizerStub({ unavailable = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-atlas-stub-'));
  bakeDirs.push(dir);
  const log = path.join(dir, 'call.json');
  const pngUrl = new URL('../../../../scripts/lib/png.mjs', import.meta.url).href;
  const file = path.join(dir, 'stub.mjs');
  const failure = unavailable ? "const err = new Error('not installed here'); err.code = 'rasterizer-unavailable'; throw err;" : '';
  fs.writeFileSync(file, [
    "import fs from 'node:fs';",
    `import { encodePng } from ${JSON.stringify(pngUrl)};`,
    'export async function rasterizeSvg(svg, { width, resourcesDir }) {',
    `  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ svg, width, resourcesDir }));`,
    `  ${failure}`,
    '  const height = Math.round(width / 2);',
    '  return encodePng(width, height, new Uint8Array(width * height * 3).fill(255));',
    '}',
    '',
  ].join('\n'));
  return { env: { YLLIR_ATLAS_RASTERIZER_STUB: file }, log };
}

/** An empty data folder, so the real rasterizer is not installed there. */
function emptyDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-atlas-data-'));
  bakeDirs.push(dir);
  return dir;
}

/** A campaign with a written atlas (terrain and places), on the fantasy style. */
function bakeCampaign(layers = {}) {
  const root = standardCampaign();
  writeAtlas(root, {
    manifest: baseManifest({ style: 'fantasy-color' }),
    layers: {
      terrain: terrainLayer(),
      places: placesLayer([['north', [500, 500]]]),
      ...layers,
    },
  });
  return root;
}

/** A PNG file of the given size, written into a temporary folder; returns its path. */
function pngFile(width = 16, height = 8) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-atlas-png-'));
  bakeDirs.push(dir);
  const file = path.join(dir, 'bake.png');
  fs.writeFileSync(file, encodePng(width, height, new Uint8Array(width * height * 3).fill(120)));
  return file;
}

/** A WebP file header (VP8X) with the given canvas size. */
function webpFile(width, height) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-atlas-webp-'));
  bakeDirs.push(dir);
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  const file = path.join(dir, 'bake.webp');
  fs.writeFileSync(file, buf);
  return file;
}

test('status prints bake none for an atlas without a bake', () => {
  const root = bakeCampaign();
  const status = json(run('status', root).stdout);
  assert.equal(status.bake, 'none');
});

test('bake-input writes the players render as a PNG of the given width and prints its hash and size', () => {
  const root = bakeCampaign();
  const stub = rasterizerStub();
  const result = runEnv(stub.env, 'bake-input', root, '--size', '512');
  assert.equal(result.code, 0, result.stdout);
  const out = json(result.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.file, '.campaign/cache/atlas/bake/input.png');
  assert.deepEqual([out.width, out.height], [512, 256]);
  assert.equal(out.layersHash, layersHash(readAtlas(root).layers));
  assert.deepEqual(pngSize(fs.readFileSync(path.join(root, out.file))), { width: 512, height: 256 });

  const call = JSON.parse(fs.readFileSync(stub.log, 'utf8'));
  assert.equal(call.width, 512);
  assert.match(call.svg, /viewBox="0 0 1000 1000"/);
  assert.ok(call.svg.includes('/styles/fantasy-color/'), 'the textures are read from the framework assets');
  assert.equal(path.basename(call.resourcesDir), 'assets');
});

test('bake-input defaults to a width of 2048', () => {
  const root = bakeCampaign();
  const stub = rasterizerStub();
  const out = json(runEnv(stub.env, 'bake-input', root).stdout);
  assert.equal(out.width, 2048);
  assert.equal(JSON.parse(fs.readFileSync(stub.log, 'utf8')).width, 2048);
});

test('bake-input keeps master-only content out: a master-only folder, a master-only feature and their names are not drawn', () => {
  const structure = [...STRUCTURE, { id: 'segreto', folder: 'Secret', type: 'master-only' }];
  const root = standardCampaign({
    'Secret/Hidden Keep.md': placeSheet({ id: 'hidden-keep', title: 'Hidden Keep', body: 'Secret.' }),
  });
  fs.writeFileSync(path.join(root, 'campaign.yaml'), campaignYaml(structure));
  writeAtlas(root, {
    manifest: baseManifest({ style: 'fantasy-color' }),
    layers: {
      terrain: terrainLayer(),
      places: placesLayer([['north', [500, 500]], ['hidden-keep', [700, 700]], ['south', [200, 800]]]),
    },
  });
  const places = JSON.parse(readAtlasFile(root, 'places.json'));
  places.features[2].visibility = 'master';
  fs.writeFileSync(path.join(root, 'Atlas', 'places.json'), JSON.stringify(places));

  const stub = rasterizerStub();
  const result = runEnv(stub.env, 'bake-input', root, '--size', '512');
  assert.equal(result.code, 0, result.stdout);
  const svg = JSON.parse(fs.readFileSync(stub.log, 'utf8')).svg;
  assert.equal(svg.includes('Hidden Keep'), false);
  assert.equal(svg.includes('South'), false);
});

test('bake-input refuses an atlas without atlas.json and an atlas without any layer, and writes nothing', () => {
  const bare = standardCampaign();
  const stub = rasterizerStub();
  const noAtlas = runEnv(stub.env, 'bake-input', bare, '--size', '512');
  assert.equal(noAtlas.code, 1);
  assert.equal(json(noAtlas.stdout).ok, false);
  assert.deepEqual(json(noAtlas.stdout).problems.map((p) => p.code), ['no-atlas']);

  const empty = standardCampaign();
  writeAtlas(empty, { manifest: baseManifest({ style: 'fantasy-color' }), layers: {} });
  const noLayer = runEnv(stub.env, 'bake-input', empty, '--size', '512');
  assert.equal(noLayer.code, 1);
  assert.deepEqual(json(noLayer.stdout).problems.map((p) => p.code), ['missing-layer']);
  assert.equal(fs.existsSync(path.join(empty, BAKE_INPUT)), false);
});

test('bake-input without an installed rasterizer exits 1 rasterizer-unavailable and tells to run bake-setup', () => {
  const root = bakeCampaign();
  const result = runEnv({ YLLIR_ATLAS_RASTERIZER_STUB: '' }, 'bake-input', root, '--size', '512', '--data-dir', emptyDataDir());
  assert.equal(result.code, 1, result.stdout);
  const problem = json(result.stdout).problems[0];
  assert.equal(problem.code, 'rasterizer-unavailable');
  assert.match(problem.message, /bake-setup/);
  assert.equal(fs.existsSync(path.join(root, BAKE_INPUT)), false);
});

test('bake-input reports the rasterizer stub unavailable the same way', () => {
  const root = bakeCampaign();
  const stub = rasterizerStub({ unavailable: true });
  const result = runEnv(stub.env, 'bake-input', root, '--size', '512');
  assert.equal(result.code, 1);
  assert.equal(json(result.stdout).problems[0].code, 'rasterizer-unavailable');
});

test('--size outside 512..4096, not a number, or on another command, is a usage error', () => {
  const root = bakeCampaign();
  for (const size of ['100', '5000', 'big', '1024.5']) {
    const result = run('bake-input', root, '--size', size);
    assert.equal(result.code, 2, size);
  }
  assert.equal(run('bake-input', root, '--size').code, 2);
  assert.equal(run('status', root, '--size', '1024').code, 2);
  assert.equal(run('bake-input', root, '--data-dir').code, 2);
});

test('bake-set copies a PNG under its hash, records it in the manifest, and status says current', () => {
  const root = bakeCampaign();
  const image = pngFile(16, 8);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex').slice(0, 8);
  const result = run('bake-set', root, image);
  assert.equal(result.code, 0, result.stdout);
  const out = json(result.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.file, `Atlas/bake/bake-${digest}.png`);
  assert.equal(out.layersHash, layersHash(readAtlas(root).layers));
  assert.ok(fs.existsSync(path.join(root, 'Atlas', 'bake', `bake-${digest}.png`)));

  const manifest = JSON.parse(readAtlasFile(root, 'atlas.json'));
  assert.deepEqual(manifest.bake, {
    file: `bake/bake-${digest}.png`,
    layersHash: layersHash(readAtlas(root).layers),
    width: 16,
    height: 8,
  });
  assert.equal(json(run('status', root).stdout).bake, 'current');
  assert.equal(run('validate', root).code, 0);
});

test('a change to a layer after the bake makes it stale', () => {
  const root = bakeCampaign();
  assert.equal(run('bake-set', root, pngFile()).code, 0);
  assert.equal(json(run('status', root).stdout).bake, 'current');
  const changed = writeJsonFile(path.join(root, 'moved.json'), movedTerrain());
  assert.equal(run('write-layer', root, 'terrain', changed).code, 0);
  assert.equal(json(run('status', root).stdout).bake, 'stale');
});

test('bake-set replaces the older bake: only the new file stays in bake/', () => {
  const root = bakeCampaign();
  assert.equal(run('bake-set', root, pngFile(16, 8)).code, 0);
  const second = run('bake-set', root, pngFile(32, 16));
  assert.equal(second.code, 0);
  const files = fs.readdirSync(path.join(root, 'Atlas', 'bake'));
  assert.deepEqual(files, [path.basename(json(second.stdout).file)]);
  const manifest = JSON.parse(readAtlasFile(root, 'atlas.json'));
  assert.equal(manifest.bake.file, `bake/${files[0]}`);
  assert.deepEqual([manifest.bake.width, manifest.bake.height], [32, 16]);
});

test('bake-set accepts a WebP and reads its size from the header', () => {
  const root = bakeCampaign();
  const result = run('bake-set', root, webpFile(40, 20));
  assert.equal(result.code, 0, result.stdout);
  const manifest = JSON.parse(readAtlasFile(root, 'atlas.json'));
  assert.ok(manifest.bake.file.endsWith('.webp'));
  assert.deepEqual([manifest.bake.width, manifest.bake.height], [40, 20]);
});

test('bake-set refuses a file that is not an image, and one over 12 MB; nothing changes', () => {
  const root = bakeCampaign();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-atlas-bad-'));
  bakeDirs.push(dir);
  const text = path.join(dir, 'notes.png');
  fs.writeFileSync(text, 'this is a text file named like a picture');
  const refusedText = run('bake-set', root, text);
  assert.equal(refusedText.code, 1);
  assert.equal(json(refusedText.stdout).problems[0].code, 'bad-image');

  const big = path.join(dir, 'big.png');
  fs.writeFileSync(big, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(12 * 1024 * 1024)]));
  const refusedBig = run('bake-set', root, big);
  assert.equal(refusedBig.code, 1);
  assert.equal(json(refusedBig.stdout).problems[0].code, 'bad-image');

  assert.equal(fs.existsSync(path.join(root, 'Atlas', 'bake')), false);
  assert.equal(JSON.parse(readAtlasFile(root, 'atlas.json')).bake, undefined);
});

test('bake-clear removes the bake field and the files of bake/; status says none; a second clear is still ok', () => {
  const root = bakeCampaign();
  assert.equal(run('bake-set', root, pngFile()).code, 0);
  const cleared = run('bake-clear', root);
  assert.equal(cleared.code, 0, cleared.stdout);
  assert.equal(json(cleared.stdout).ok, true);
  assert.equal(fs.existsSync(path.join(root, 'Atlas', 'bake')), false);
  assert.equal(JSON.parse(readAtlasFile(root, 'atlas.json')).bake, undefined);
  assert.equal(json(run('status', root).stdout).bake, 'none');
  assert.equal(run('bake-clear', root).code, 0);
  assert.equal(run('validate', root).code, 0);
});

test('bake-set and bake-clear without an atlas exit 1 no-atlas and write nothing', () => {
  const bare = standardCampaign();
  const set = run('bake-set', bare, pngFile());
  assert.equal(set.code, 1);
  assert.equal(json(set.stdout).problems[0].code, 'no-atlas');
  assert.equal(fs.existsSync(path.join(bare, 'Atlas', 'atlas.json')), false);
  assert.equal(fs.existsSync(path.join(bare, 'Atlas', 'bake')), false);
});
