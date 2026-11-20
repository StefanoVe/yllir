// Tests of export.mjs. Run: node --test yllir/skills/library/atlas/scripts/lib/export.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exportAtlas, buildOverlaySvg, summaryOf, escapeXml } from './export.mjs';
import { newImage, writePngFile, imageFromFile } from './image.mjs';
import { imageToMask } from './mask.mjs';
import { computeTerritories } from './territory.mjs';
import {
  cleanupCampaigns, makeCampaign, writeAtlas, baseManifest, emptyLabels, MASTER, square, placeSheet,
} from './test-support.mjs';

after(cleanupCampaigns);

const W = 120;
const H = 90;
// Land: one rectangle split in two by a sea column (x 58..62), so the two territories have one seed each.
const LAND = { x0: 10, y0: 10, x1: 110, y1: 80 };
const SEA_COLUMN = square(58, 0, 62, 90);
const TERRITORIES = [
  { id: 't1', color: '#b03a2e', seeds: [[30, 40]], separate: [SEA_COLUMN] },
  { id: 't2', color: '#2e5eb0', seeds: [[90, 40]], separate: [SEA_COLUMN] },
];
const RESERVED = 'The gate hides a secret cult.';

function landImage() {
  const img = newImage(W, H, [0, 0, 0, 255]);
  for (let y = LAND.y0; y < LAND.y1; y++) {
    for (let x = LAND.x0; x < LAND.x1; x++) img.data[(y * W + x) * 4] = 255;
  }
  return img;
}

/** A campaign with an atlas: a public place, a master-only place whose sheet is public, and a place whose sheet has a reserved block. */
function atlasCampaign({ labels, extraFiles = {} } = {}) {
  const root = makeCampaign({
    'World/North.md': `${placeSheet({ id: 'north', title: 'North', body: 'A northern city of stone walls and cold rivers.' })}\n<!-- master -->\n${RESERVED}\n`,
    'World/Hidden.md': placeSheet({ id: 'hidden', title: 'Hidden Vault', body: 'Nobody knows the way in.' }),
    ...extraFiles,
  });
  writeAtlas(root, {
    manifest: baseManifest({ canvas: { width: W, height: H } }),
    labels: labels ?? defaultLabels(),
    pictures: [],
  });
  const dir = path.join(root, 'Atlas');
  writePngFile(path.join(dir, 'base.png'), newImage(W, H, [200, 190, 160, 255]));
  writePngFile(path.join(dir, 'land.png'), landImage());
  return root;
}

function defaultLabels() {
  return emptyLabels({
    lands: [{ id: 'l1', text: 'Mare & <Nord>', x: 30, y: 20, size: 30, ...MASTER }],
    regions: [{ id: 'r1', text: 'Regno Nord', size: 20, territory: 't1', ...MASTER }],
    nature: [{ id: 'n1', text: 'Lago Grigio', x: 90, y: 70, size: 14, ...MASTER }],
    places: [
      { id: 'p-north', place: 'north', x: 35, y: 30, kind: 'city', ...MASTER },
      { id: 'p-hidden', place: 'hidden', x: 100, y: 60, kind: 'ruin', provenance: 'master', visibility: 'master', sources: [] },
    ],
    territories: TERRITORIES.map((t) => ({ ...t, add: [], remove: [], subtract: [], ...MASTER })),
  });
}

function dataOf(dir) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const match = /<script type="application\/json" id="atlas-data">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(match[1]);
}

/** Every text file of a folder, concatenated. */
function allText(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|json|js|css|svg)$/.test(entry.name)) out.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(dir);
  return out.join('\n');
}

test('master build holds both places; players build holds only the public one', () => {
  const root = atlasCampaign();

  const master = exportAtlas(root, { audience: 'master' });
  assert.equal(master.ok, true, JSON.stringify(master.problems));
  assert.equal(master.dir, '.campaign/cache/atlas/master');
  assert.deepEqual(dataOf(path.join(root, master.dir)).places.map((p) => p.id), ['p-north', 'p-hidden']);

  const players = exportAtlas(root, { audience: 'players' });
  assert.equal(players.ok, true, JSON.stringify(players.problems));
  const playerDir = path.join(root, players.dir);
  const data = dataOf(playerDir);
  assert.deepEqual(data.places.map((p) => p.id), ['p-north']);
  assert.equal(data.places[0].name, 'North');
  assert.equal(data.places[0].url, null);
  assert.deepEqual(data.places[0].sources, []);
  assert.equal(data.audience, 'players');
  assert.equal(fs.existsSync(path.join(playerDir, 'assets', 'base.png')), true);
  assert.equal(fs.existsSync(path.join(playerDir, 'assets', 'fonts', 'Cinzel.ttf')), true);
});

test('players build never shows the reserved block, the master-only place, or its name', () => {
  const root = atlasCampaign();
  const players = exportAtlas(root, { audience: 'players' });
  assert.equal(players.ok, true, JSON.stringify(players.problems));
  const text = allText(path.join(root, players.dir));
  assert.equal(text.includes('secret cult'), false);
  assert.equal(text.includes('Hidden Vault'), false);
  assert.equal(text.includes('p-hidden'), false);
  assert.ok(text.includes('A northern city'), 'the public summary is there');

  const master = exportAtlas(root, { audience: 'master' });
  assert.equal(master.ok, true);
  assert.equal(allText(path.join(root, master.dir)).includes('Hidden Vault'), true);
});

test('a failing players check keeps the previous players folder untouched', () => {
  const root = atlasCampaign();
  const first = exportAtlas(root, { audience: 'players' });
  assert.equal(first.ok, true, JSON.stringify(first.problems));
  const dir = path.join(root, first.dir);
  const before = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

  const failing = exportAtlas(root, {
    audience: 'players',
    runChecks: () => [{ id: 'no-reserved-text', status: 'fail', message: 'reserved text found' }],
  });
  assert.equal(failing.ok, false);
  assert.equal(failing.dir, null);
  assert.equal(failing.problems[0].code, 'no-reserved-text');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, '.campaign', 'cache', 'atlas', '.players-tmp')), false);
});

test('two master exports give byte-identical index.html', () => {
  const root = atlasCampaign();
  const a = exportAtlas(root, { audience: 'master' });
  const first = fs.readFileSync(path.join(root, a.dir, 'index.html'));
  const b = exportAtlas(root, { audience: 'master' });
  const second = fs.readFileSync(path.join(root, b.dir, 'index.html'));
  assert.equal(a.ok && b.ok, true);
  assert.equal(first.equals(second), true);
});

test('a region without x and y is placed at a point inside its territory', () => {
  const root = atlasCampaign();
  const result = exportAtlas(root, { audience: 'master' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const html = fs.readFileSync(path.join(root, result.dir, 'index.html'), 'utf8');
  const match = /<text ([^>]*)>Regno Nord<\/text>/.exec(html);
  assert.ok(match, 'the region label is drawn');
  const x = Number(/(?:^|\s)x="([^"]+)"/.exec(match[1])[1]);
  const y = Number(/(?:^|\s)y="([^"]+)"/.exec(match[1])[1]);

  const mask = computeTerritories(imageToMask(imageFromFile(path.join(root, 'Atlas', 'land.png'))), TERRITORIES).get('t1');
  assert.equal(mask.data[y * W + x], 1, `(${x}, ${y}) is inside t1`);
});

test('text is XML-escaped in the overlay and the page data keeps the characters', () => {
  const root = atlasCampaign();
  const result = exportAtlas(root, { audience: 'master' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const html = fs.readFileSync(path.join(root, result.dir, 'index.html'), 'utf8');
  assert.ok(html.includes('MARE &amp; &lt;NORD&gt;'), 'the land label is escaped');
  assert.equal(html.includes('MARE & <NORD>'), false);
  assert.equal(escapeXml('a & <b> "c"'), 'a &amp; &lt;b&gt; &quot;c&quot;');
  assert.equal(html.includes('<NORD>'), false);
});

test('an invalid atlas is refused with problems and nothing is written', () => {
  const labels = defaultLabels();
  labels.places.push({ id: 'p-bad', place: 'no-such-place', x: 10, y: 10, kind: 'town', ...MASTER });
  const root = atlasCampaign({ labels });
  const result = exportAtlas(root, { audience: 'master' });
  assert.equal(result.ok, false);
  assert.equal(result.dir, null);
  assert.ok(result.problems.some((p) => p.code === 'bad-reference'));
  assert.equal(fs.existsSync(path.join(root, '.campaign', 'cache', 'atlas', 'master')), false);
});

test('buildOverlaySvg returns the overlay with the base reference and the place records', () => {
  const root = atlasCampaign();
  const { svg, places } = buildOverlaySvg(root, { audience: 'master' });
  assert.ok(svg.includes('<image href="assets/base.png"'));
  assert.ok(svg.includes('<g data-layer="borders">'));
  assert.ok(svg.includes('<g data-layer="labels">'));
  assert.deepEqual(places.map((p) => p.id), ['p-north', 'p-hidden']);
});

test('summaryOf keeps the first paragraph, drops emphasis and cuts long text at 400 characters', () => {
  assert.equal(summaryOf('# Title\n\n*A small *town* by the sea.*\n\nSecond.'), 'A small town by the sea.');
  const long = summaryOf(`# T\n\n${'word '.repeat(200)}`);
  assert.ok(Array.from(long).length <= 400);
  assert.ok(long.endsWith('…'));
});

/** A campaign whose atlas has no labels: only the base (flat colour) and the land mask, given by `isLand(x, y)`. */
function seaCampaign(isLand) {
  const root = makeCampaign({});
  writeAtlas(root, { manifest: baseManifest({ canvas: { width: W, height: H } }), labels: emptyLabels(), pictures: [] });
  const dir = path.join(root, 'Atlas');
  writePngFile(path.join(dir, 'base.png'), newImage(W, H, [200, 190, 160, 255]));
  const land = newImage(W, H, [0, 0, 0, 255]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (isLand(x, y)) land.data[(y * W + x) * 4] = 255;
  }
  writePngFile(path.join(dir, 'land.png'), land);
  return root;
}

test('a sea.png in the atlas folder is copied to the site and sized to a third of the map width', () => {
  const root = seaCampaign((x) => x < 40);
  writePngFile(path.join(root, 'Atlas', 'sea.png'), newImage(256, 256, [30, 70, 110, 255]));
  for (const audience of ['master', 'players']) {
    const result = exportAtlas(root, { audience });
    assert.equal(result.ok, true, JSON.stringify(result.problems));
    const dir = path.join(root, result.dir);
    assert.equal(fs.existsSync(path.join(dir, 'assets', 'sea.png')), true, `${audience}: sea.png is copied`);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'assets', 'sea.png')), fs.readFileSync(path.join(root, 'Atlas', 'sea.png')));
    const data = dataOf(dir);
    assert.equal(data.sea.file, 'assets/sea.png');
    assert.equal(data.sea.width, Math.round(W / 3));
    assert.equal(data.sea.height, Math.round(W / 3));
  }
});

test('no sea.png in the atlas folder gives sea: null and no assets/sea.png', () => {
  const root = seaCampaign((x) => x < 40);
  const result = exportAtlas(root, { audience: 'master' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const dir = path.join(root, result.dir);
  assert.equal(dataOf(dir).sea, null);
  assert.equal(fs.existsSync(path.join(dir, 'assets', 'sea.png')), false);
});

test('a sea.png that is not a PNG refuses the export with bad-picture', () => {
  const root = seaCampaign((x) => x < 40);
  fs.writeFileSync(path.join(root, 'Atlas', 'sea.png'), 'not a picture');
  const result = exportAtlas(root, { audience: 'master' });
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].code, 'bad-picture');
});

test('the sea texture is the same bytes on two exports', () => {
  const root = seaCampaign((x) => x < 40);
  writePngFile(path.join(root, 'Atlas', 'sea.png'), newImage(64, 64, [30, 70, 110, 255]));
  const a = exportAtlas(root, { audience: 'master' });
  const first = fs.readFileSync(path.join(root, a.dir, 'assets', 'sea.png'));
  const b = exportAtlas(root, { audience: 'master' });
  const second = fs.readFileSync(path.join(root, b.dir, 'assets', 'sea.png'));
  assert.equal(first.equals(second), true);
});
