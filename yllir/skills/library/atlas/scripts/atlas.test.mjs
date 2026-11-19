import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripExitLine } from '../../../../scripts/lib/cli-exit.mjs';
import { pngSize } from '../../../../scripts/lib/png.mjs';
import {
  cleanupCampaigns, standardCampaign, makeCampaign, campaignYaml, terrainLayer, placesLayer,
  landFeature, square, readAtlasFile, placeSheet, writeAtlas, baseManifest,
} from './lib/test-support.mjs';
import { listStyles } from './lib/styles.mjs';

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
