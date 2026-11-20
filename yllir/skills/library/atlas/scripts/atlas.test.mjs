import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripExitLine } from '../../../../scripts/lib/cli-exit.mjs';
import { cleanupCampaigns, makeCampaign, standardCampaign, campaignYaml } from './lib/test-support.mjs';
import { newImage, encodePngRgba, decodePng } from './lib/image.mjs';

const CLI = fileURLToPath(new URL('./atlas.mjs', import.meta.url));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-atlas-cli-'));
let counter = 0;

after(() => {
  cleanupCampaigns();
  fs.rmSync(WORK, { recursive: true, force: true });
});

const SEA = [28, 58, 74];
const LAND = [90, 130, 70];
const SEA_HEX = '#1c3a4a';

/** Runs the CLI; returns the exit code, stdout and stderr, whatever the exit code is. */
function run(...args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/** The JSON printed before the exit line. */
function json(result) {
  return JSON.parse(stripExitLine(result.stdout));
}

function lastLine(result) {
  return result.stdout.trimEnd().split('\n').at(-1);
}

function paint(image, x0, y0, x1, y1, rgb) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = rgb[0];
      image.data[i + 1] = rgb[1];
      image.data[i + 2] = rgb[2];
      image.data[i + 3] = 255;
    }
  }
}

/** A 160x120 picture: sea, with one land block at 40..120 x 30..90. */
function scene() {
  const image = newImage(160, 120, [...SEA, 255]);
  paint(image, 40, 30, 120, 90, LAND);
  return image;
}

function writePng(file, image) {
  fs.writeFileSync(file, encodePngRgba(image));
  return file;
}

function nextFile(name) {
  counter += 1;
  return path.join(WORK, `${counter}-${name}`);
}

/** A scope.json file outside the campaign. */
function scopeFile(scope = { kind: 'region', places: [], note: 'test region' }) {
  return writeText(nextFile('scope.json'), JSON.stringify({ scope }));
}

function writeText(file, text) {
  fs.writeFileSync(file, text);
  return file;
}

/** A picture of the scene, as a file outside the campaign. */
function basePicture(image = scene()) {
  return writePng(nextFile('base.png'), image);
}

/** Initialises the atlas of a campaign with the scene as its base. */
function initWithBase(root) {
  const result = run('init', root, scopeFile(), '--base', basePicture(), '--sea-color', SEA_HEX);
  assert.equal(result.code, 0, result.stdout);
  return result;
}

function writeLabels(root, labels) {
  const candidate = writeText(nextFile('labels.json'), JSON.stringify(labels));
  return run('labels-write', root, candidate);
}

function emptyLabelSet(overrides = {}) {
  return {
    lands: [],
    regions: [],
    nature: [],
    places: [],
    territories: [],
    legend: { show: true, corner: 'top-left' },
    ...overrides,
  };
}

const MASTER = { provenance: 'master', visibility: 'public', sources: [] };

function boxArg(box) {
  return `${box.x0},${box.y0},${box.x1},${box.y1}`;
}

test('status without an atlas folder exits 1', () => {
  const root = makeCampaign({}, { yaml: campaignYaml([{ id: 'luoghi', folder: 'World', type: 'places' }]) });
  const result = run('status', root);
  assert.equal(result.code, 1);
  assert.equal(lastLine(result), 'exit: 1');
  const status = json(result);
  assert.equal(status.folder, null);
  assert.equal(status.exists, false);
});

test('status before init reports no atlas.json and exits 0', () => {
  const root = standardCampaign();
  fs.mkdirSync(path.join(root, 'Atlas'));
  const result = run('status', root);
  assert.equal(result.code, 0);
  const status = json(result);
  assert.equal(status.folder, 'Atlas');
  assert.equal(status.exists, false);
  assert.equal(status.layers.terrain.present, false);
});

test('init with a base creates the files, and status shows the base and the canvas', () => {
  const root = standardCampaign();
  initWithBase(root);
  assert.ok(fs.existsSync(path.join(root, 'Atlas', 'atlas.json')));
  assert.ok(fs.existsSync(path.join(root, 'Atlas', 'base.png')));
  assert.ok(fs.existsSync(path.join(root, 'Atlas', 'land.png')));
  const status = json(run('status', root));
  assert.equal(status.exists, true);
  assert.equal(status.layers.terrain.present, true);
  assert.equal(status.layers.terrain.locked, false);
  assert.equal(status.layers.land.present, true);
  assert.equal(status.base.width, 160);
  assert.equal(status.base.height, 120);
  assert.match(status.base.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(status.problems, []);
  assert.ok(status.pending.length > 0, 'the places of the campaign are pending');
});

test('init without a base writes atlas.json with the placeholder canvas and no base', () => {
  const root = standardCampaign();
  const result = run('init', root, scopeFile());
  assert.equal(result.code, 0, result.stdout);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'Atlas', 'atlas.json'), 'utf8'));
  assert.equal(manifest.canvas.width, 1024);
  assert.equal(manifest.base, undefined);
  const status = json(run('status', root));
  assert.equal(status.layers.terrain.present, false);
  assert.equal(run('validate', root).code, 0);
});

test('init refuses when atlas.json already exists and changes nothing', () => {
  const root = standardCampaign();
  run('init', root, scopeFile());
  const before = fs.readFileSync(path.join(root, 'Atlas', 'atlas.json'), 'utf8');
  const result = run('init', root, scopeFile());
  assert.equal(result.code, 1);
  assert.equal(json(result).problems[0].code, 'atlas-exists');
  assert.equal(fs.readFileSync(path.join(root, 'Atlas', 'atlas.json'), 'utf8'), before);
});

test('init adds the atlas category when the campaign has none', () => {
  const files = standardCampaign();
  const yaml = [
    'schema: 1',
    'campaign:',
    '  name: "Test"',
    '  slug: test-campaign',
    '  created: 2026-11-01',
    'language:',
    '  main: en',
    '  other: []',
    'prose:',
    '  register: plain',
    'system:',
    '  adapter: none',
    'structure:',
    '  - id: luoghi',
    '    folder: World',
    '    type: places',
    '',
  ].join('\n');
  const root = makeCampaign({}, { yaml });
  fs.cpSync(path.join(files, 'World'), path.join(root, 'World'), { recursive: true });
  const result = run('init', root, scopeFile());
  assert.equal(result.code, 0, result.stdout);
  assert.equal(json(result).categoryAdded, true);
  assert.ok(fs.existsSync(path.join(root, 'Atlas', 'atlas.json')));
});

test('places lists every place sheet with its parent, none placed yet', () => {
  const root = standardCampaign();
  initWithBase(root);
  const result = run('places', root);
  assert.equal(result.code, 0);
  const places = json(result).places;
  const ids = places.map((p) => p.id);
  assert.deepEqual(ids, ['north', 'port-ash', 'south']);
  assert.equal(places.find((p) => p.id === 'port-ash').parent, 'north');
  assert.ok(places.every((p) => p.placed === false));
});

test('labels-write refuses a place in the sea and writes nothing', () => {
  const root = standardCampaign();
  initWithBase(root);
  const result = writeLabels(root, emptyLabelSet({
    places: [{ id: 'p1', place: 'north', x: 10, y: 10, kind: 'town', ...MASTER }],
  }));
  assert.equal(result.code, 1);
  const problems = json(result).problems;
  assert.ok(problems.some((p) => p.code === 'place-not-on-land'));
  assert.equal(fs.existsSync(path.join(root, 'Atlas', 'labels.json')), false);
});

test('labels-write accepts a place on land and then places lists it as placed', () => {
  const root = standardCampaign();
  initWithBase(root);
  const result = writeLabels(root, emptyLabelSet({
    lands: [{ id: 'l1', text: 'Nord', x: 80, y: 20, size: 20, ...MASTER }],
    places: [{ id: 'p1', place: 'north', x: 80, y: 60, kind: 'town', ...MASTER }],
  }));
  assert.equal(result.code, 0, result.stdout);
  const written = json(result).written;
  assert.equal(written.lands, 1);
  assert.equal(written.places, 1);
  assert.ok(fs.existsSync(path.join(root, 'Atlas', 'labels.json')));
  const north = json(run('places', root)).places.find((p) => p.id === 'north');
  assert.equal(north.placed, true);
  assert.equal(north.icon, 'town');
});

test('labels-write accepts a port within 12 pixels of land, and refuses one farther away', () => {
  const root = standardCampaign();
  initWithBase(root);
  const near = writeLabels(root, emptyLabelSet({
    places: [{ id: 'p1', place: 'north', x: 125, y: 60, kind: 'port', ...MASTER }],
  }));
  assert.equal(near.code, 0, near.stdout);
  const far = writeLabels(root, emptyLabelSet({
    places: [{ id: 'p1', place: 'north', x: 150, y: 60, kind: 'port', ...MASTER }],
  }));
  assert.equal(far.code, 1);
  assert.equal(json(far).problems[0].code, 'place-not-on-land');
});

test('labels-write refuses a place that is not a place of the world', () => {
  const root = standardCampaign();
  initWithBase(root);
  const result = writeLabels(root, emptyLabelSet({
    places: [{ id: 'p1', place: 'mara', x: 80, y: 60, kind: 'town', ...MASTER }],
  }));
  assert.equal(result.code, 1);
  assert.equal(json(result).problems[0].code, 'bad-reference');
});

test('lock land refuses a land-removing candidate, and --extend accepts only a pure addition', () => {
  const root = standardCampaign();
  initWithBase(root);
  assert.equal(run('lock', root, 'land').code, 0);
  const status = json(run('status', root));
  assert.equal(status.layers.land.locked, true);

  // Removal: sea painted over the land block inside its box. Refused by the lock.
  const removed = scene();
  paint(removed, 60, 40, 100, 80, SEA);
  const removal = run('accept', root, '--candidate', writePng(nextFile('removed.png'), removed), '--box', '40,30,120,90');
  assert.equal(removal.code, 1);
  assert.equal(json(removal).code, 'land-locked');

  // Pure addition: land painted over sea in a corner box. Refused without --extend, accepted with it.
  const added = scene();
  paint(added, 5, 5, 25, 25, LAND);
  const addedFile = writePng(nextFile('added.png'), added);
  const refused = run('accept', root, '--candidate', addedFile, '--box', '0,0,40,40');
  assert.equal(refused.code, 1);
  assert.equal(json(refused).code, 'land-locked');
  const accepted = run('accept', root, '--candidate', addedFile, '--box', '0,0,40,40', '--extend');
  assert.equal(accepted.code, 0, accepted.stdout);
  assert.ok(json(accepted).gained > 0);
  assert.equal(json(accepted).lost, 0);

  // After the addition, removing land is still refused even with --extend.
  const current = decodePng(fs.readFileSync(path.join(root, 'Atlas', 'base.png')));
  paint(current, 60, 40, 100, 80, SEA);
  const again = run('accept', root, '--candidate', writePng(nextFile('removed-again.png'), current), '--box', '40,30,120,90', '--extend');
  assert.equal(again.code, 1);
  assert.equal(json(again).code, 'land-locked');
});

test('base-set is refused when the land is locked', () => {
  const root = standardCampaign();
  initWithBase(root);
  run('lock', root, 'land');
  const result = run('base-set', root, basePicture());
  assert.equal(result.code, 1);
  assert.equal(json(result).code, 'base-locked');
});

test('lock release needs --unlock and clears the flag', () => {
  const root = standardCampaign();
  initWithBase(root);
  run('lock', root, 'all');
  const withoutUnlock = run('lock', root, 'release', 'land');
  assert.equal(withoutUnlock.code, 2);
  const released = run('lock', root, 'release', 'land', '--unlock');
  assert.equal(released.code, 0, released.stdout);
  const status = json(run('status', root));
  assert.equal(status.layers.land.locked, false);
  assert.equal(status.layers.terrain.locked, true);
});

test('grid, crop, compose and verify each write their picture', () => {
  const root = standardCampaign();
  initWithBase(root);
  const grid = run('grid', root, '--box', '0,0,80,60');
  assert.equal(grid.code, 0, grid.stdout);
  assert.ok(fs.existsSync(path.join(root, '.campaign', 'cache', 'atlas', 'work', 'grid.png')));

  const box = { x0: 20, y0: 20, x1: 100, y1: 80 };
  const crop = run('crop', root, '--box', boxArg(box));
  assert.equal(crop.code, 0, crop.stdout);
  assert.ok(json(crop).scale >= 1);
  assert.ok(fs.existsSync(path.join(root, '.campaign', 'cache', 'atlas', 'work', 'crop.png')));

  const raw = writePng(nextFile('raw.png'), newImage(80, 60, [...LAND, 255]));
  const compose = run('compose', root, '--raw', raw, '--box', boxArg(box), '--mode', 'land');
  assert.equal(compose.code, 0, compose.stdout);
  const candidate = json(compose).out;
  assert.ok(fs.existsSync(candidate));

  const verify = run('verify', root, '--after', candidate, '--box', boxArg(box));
  assert.equal(verify.code, 0, verify.stdout);
  assert.equal(typeof json(verify).gained, 'number');
  assert.ok(fs.existsSync(path.join(root, '.campaign', 'cache', 'atlas', 'work', 'verify.png')));
});

test('territories prints the area of each territory and writes the preview picture', () => {
  const root = standardCampaign();
  initWithBase(root);
  const written = writeLabels(root, emptyLabelSet({
    territories: [{ id: 't1', color: '#b03a2e', seeds: [[80, 60]], ...MASTER }],
  }));
  assert.equal(written.code, 0, written.stdout);
  const result = run('territories', root);
  assert.equal(result.code, 0, result.stdout);
  const data = json(result);
  assert.ok(data.areas.t1 > 1000, `area ${data.areas.t1}`);
  assert.ok(fs.existsSync(data.out));
});

test('render master writes the index page and render players also succeeds', () => {
  const root = standardCampaign();
  initWithBase(root);
  const master = run('render', root, '--audience', 'master');
  assert.equal(master.code, 0, master.stdout);
  const masterDir = json(master).dir;
  assert.ok(fs.existsSync(path.resolve(root, masterDir, 'index.html')));

  const players = run('render', root, '--audience', 'players');
  assert.equal(players.code, 0, players.stdout);
  assert.equal(json(players).ok, true);
});

test('report writes the placed places and the question, or the word nothing', () => {
  const root = standardCampaign();
  const written = run('report', root, '--placed', 'north,south', '--ask', 'Which river?');
  assert.equal(written.code, 0);
  const file = path.join(root, '.campaign', 'state', 'atlas', 'report.txt');
  assert.equal(fs.readFileSync(file, 'utf8'), 'placed: north,south\nask: Which river?\n');

  assert.equal(run('report', root, '--ask', 'none').code, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), 'nothing\n');
});

test('styles lists the installed styles and set-style accepts only installed ids', () => {
  const root = standardCampaign();
  initWithBase(root);
  const styles = run('styles', root);
  assert.equal(styles.code, 0, styles.stdout);
  const listed = json(styles).styles.map((s) => s.id);
  assert.ok(listed.includes('fantasy-color'));
  assert.equal(run('set-style', root, 'fantasy-color').code, 0);
  assert.equal(json(run('styles', root)).current.id, 'fantasy-color');
  assert.equal(run('set-style', root, 'no-such-style').code, 1);
  assert.equal(run('set-style', root, 'auto').code, 0);
});

test('usage errors exit 2', () => {
  const root = standardCampaign();
  for (const args of [
    ['frobnicate', root],
    ['status'],
    ['status', root, 'extra'],
    ['status', root, '--nope'],
    ['grid', root],
    ['lock', root],
    ['lock', root, 'sky'],
    ['init', root],
  ]) {
    const result = run(...args);
    assert.equal(result.code, 2, `${args.join(' ')} -> ${result.code}`);
    assert.equal(lastLine(result), 'exit: 2');
    assert.match(result.stderr, /usage: node atlas\.mjs/);
  }
});

const LAKE_RGB = [110, 130, 170];
/** The scene with a grey-blue lake of 20x20 inside the land block. */
function sceneWithLake() {
  const image = scene();
  paint(image, 60, 50, 80, 70, LAKE_RGB);
  return image;
}
/** Whether the pixel of land.png at (x, y) is land. */
function landAt(root, x, y) {
  const land = decodePng(fs.readFileSync(path.join(root, 'Atlas', 'land.png')));
  return land.data[(y * land.width + x) * 4] >= 128;
}

test('init with --water-at keeps the lake out of the land and stores its colour', () => {
  const root = standardCampaign();
  const picture = basePicture(sceneWithLake());
  const result = run('init', root, scopeFile(), '--base', picture, '--sea-color', SEA_HEX, '--water-at', '70,60');
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(json(result).land.waters, [{ color: '#6e82aa', tolerance: 30 }]);
  assert.equal(landAt(root, 70, 60), false, 'the lake is water');
  assert.equal(landAt(root, 50, 40), true, 'the land around it stays land');
  const sea = JSON.parse(fs.readFileSync(path.join(root, 'Atlas', 'atlas.json'), 'utf8')).land.sea;
  assert.deepEqual(sea.waters, [{ color: '#6e82aa', tolerance: 30 }]);
});

test('land --water-at adds a lake, a second run keeps it, and --clear-waters empties it', () => {
  const root = standardCampaign();
  initWithBase(root);
  assert.equal(landAt(root, 70, 60), true, 'without water the grey-blue lake is land');

  const withLake = run('base-set', root, basePicture(sceneWithLake()), '--water-at', '70,60');
  assert.equal(withLake.code, 0, withLake.stdout);
  assert.equal(json(withLake).land.waters.length, 1);
  assert.equal(landAt(root, 70, 60), false, 'the lake is water');

  const kept = run('land', root);
  assert.equal(kept.code, 0, kept.stdout);
  assert.equal(json(kept).waters.length, 1, 'the stored waters are kept');
  assert.equal(landAt(root, 70, 60), false);

  const cleared = run('land', root, '--clear-waters');
  assert.equal(cleared.code, 0, cleared.stdout);
  assert.deepEqual(json(cleared).waters, []);
  assert.equal(landAt(root, 70, 60), true, 'the lake is land again');
});

test('init --water-at without --base is refused and changes nothing', () => {
  const root = standardCampaign();
  const result = run('init', root, scopeFile(), '--water-at', '70,60');
  assert.equal(result.code, 1);
  assert.match(result.stdout, /no-base/);
  assert.equal(fs.existsSync(path.join(root, 'Atlas', 'atlas.json')), false);
});

test('a water point outside the picture is refused; a malformed --water-at is a usage error', () => {
  const root = standardCampaign();
  initWithBase(root);
  const outside = run('land', root, '--water-at', '900,5');
  assert.equal(outside.code, 1);
  assert.equal(json(outside).code, 'bad-water-point');
  assert.equal(run('land', root, '--water-at', '70').code, 2);
  assert.equal(run('land', root, '--water-at', 'a,b').code, 2);
});
