import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fitArcLabel, renderAtlasSvg } from './render.mjs';
import { pointInPolygon } from './geometry.mjs';
import { loadStyle } from './styles.mjs';

const ASSETS = fileURLToPath(new URL('../../assets/', import.meta.url));
const ASSET_BASE = 'assets/';
const STYLE = loadStyle('fantasy-color');
const CELL = 1000 / 512;

const LAND = [[100, 100], [900, 100], [900, 900], [100, 900]];
const LAKE = [[400, 400], [500, 400], [500, 500], [400, 500]];
const MOUNTAINS = [[200, 200], [400, 200], [400, 300], [200, 300]];
const FOREST = [[500, 600], [800, 600], [800, 850], [500, 850]];
const NORTH = [300, 700];
const HOLD = [620, 700];

function fixture({ seed = 7, withMaster = true } = {}) {
  const places = [{ id: 'north', place: 'north', at: NORTH, icon: 'town', visibility: 'public', provenance: 'master', sources: [] }];
  if (withMaster) {
    places.push({ id: 'hold', place: 'hold', at: HOLD, icon: 'fort', visibility: 'master', provenance: 'master', sources: [] });
  }
  return {
    manifest: { canvas: { width: 1000, height: 1000 }, seed },
    layers: {
      terrain: { layer: 'terrain', features: [
        { id: 'main', type: 'land', polygon: LAND, provenance: 'agent-choice', sources: [] },
        { id: 'mere', type: 'lake', polygon: LAKE, provenance: 'agent-choice', sources: [] },
      ] },
      relief: { layer: 'relief', features: [
        { id: 'spine', type: 'mountains', polygon: MOUNTAINS, provenance: 'agent-choice', sources: [] },
      ] },
      biomes: { layer: 'biomes', features: [
        { id: 'wood', type: 'forest', polygon: FOREST, provenance: 'agent-choice', sources: [] },
        { id: 'heath', type: 'grassland', polygon: [[600, 100], [800, 100], [800, 300], [600, 300]], provenance: 'agent-choice', sources: [] },
      ] },
      water: { layer: 'water', features: [
        { id: 'silver', type: 'river', path: [[120, 150], [300, 500], [120, 850]], provenance: 'agent-choice', sources: [] },
      ] },
      political: { layer: 'political', features: [
        { id: 'ash', type: 'realm', name: 'Ash & <Reach>', color: '#aa3322', seeds: [[300, 150]],
          polygons: [[[120, 120], [480, 120], [480, 380], [120, 380]]], provenance: 'agent-choice', sources: [] },
      ] },
      places: { layer: 'places', features: places },
      routes: { layer: 'routes', features: [
        { id: 'road', type: 'road', path: [[NORTH[0], NORTH[1]], [450, 800]], connects: ['north'], provenance: 'agent-choice', sources: [] },
      ] },
    },
    names: { north: 'Northwatch', hold: 'Secret Hold' },
  };
}

const render = (options = {}, extra = {}) => {
  const f = fixture(options);
  return renderAtlasSvg({ manifest: f.manifest, layers: f.layers, style: STYLE, names: f.names, assetBase: ASSET_BASE, ...extra });
};

const anchorsOf = (svg) => [...svg.matchAll(/data-layer="(relief|biomes)" data-anchor="([-\d.]+),([-\d.]+)"/g)]
  .map((m) => ({ layer: m[1], x: Number(m[2]), y: Number(m[3]) }));

test('determinism: the same inputs give the same SVG, another seed moves the stamps', () => {
  const a = render();
  const b = render();
  assert.equal(a.svg, b.svg);
  assert.deepEqual(a.stats, b.stats);
  const c = render({ seed: 8 });
  const pa = anchorsOf(a.svg).map((s) => `${s.x},${s.y}`);
  const pc = anchorsOf(c.svg).map((s) => `${s.x},${s.y}`);
  assert.notDeepEqual(pa, pc);
  assert.ok(a.stats.stamps > 0);
});

test('every image href and font url points to a file under the assets folder', () => {
  const { svg } = render();
  const refs = [...svg.matchAll(/href="([^"]+)"/g), ...svg.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(refs.length > 10);
  for (const ref of refs) {
    if (ref.startsWith('#')) continue;
    assert.ok(ref.startsWith(ASSET_BASE), `${ref} does not start with the asset base`);
    const file = path.join(ASSETS, ref.slice(ASSET_BASE.length));
    assert.ok(fs.existsSync(file), `missing asset ${file}`);
  }
});

test('players audience drops the master-only place and its label', () => {
  const master = render({}).svg;
  const players = render({}, { audience: 'players' }).svg;
  assert.ok(master.includes('Secret Hold'));
  assert.ok(master.includes('data-place="hold"'));
  assert.ok(!players.includes('Secret Hold'));
  assert.ok(!players.includes('data-place="hold"'));
  assert.ok(players.includes('Northwatch'));
});

test('no stamp lies in the sea, in a lake, or closer than six cells to a place', () => {
  const { svg } = render();
  const anchors = anchorsOf(svg);
  assert.ok(anchors.length > 0);
  for (const a of anchors) {
    const p = [a.x, a.y];
    assert.ok(pointInPolygon(p, LAND), `anchor ${p} is in the sea`);
    assert.ok(!pointInPolygon(p, LAKE), `anchor ${p} is in a lake`);
    for (const at of [NORTH, HOLD]) {
      assert.ok(Math.hypot(a.x - at[0], a.y - at[1]) >= CELL * 6 - 1e-6, `anchor ${p} is too close to a place`);
    }
  }
});

test('stamps are in document order sorted by anchor y, then x', () => {
  const anchors = anchorsOf(render().svg);
  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const cur = anchors[i];
    // The attribute is rounded to two decimals, so allow that much slack on y.
    assert.ok(prev.y <= cur.y + 0.011, `stamp ${i} is out of order`);
  }
});

test('label overrides: hidden removes a place label, a new label on relief appears', () => {
  const f = fixture();
  f.layers.labels = { layer: 'labels', features: [
    { id: 'hide-north', target: 'places/north', hidden: true, provenance: 'master', sources: [] },
    { id: 'spine-name', target: 'relief/spine', text: 'Iron Spine', at: [300, 250], provenance: 'master', sources: [] },
  ] };
  const { svg } = renderAtlasSvg({ manifest: f.manifest, layers: f.layers, style: STYLE, names: f.names, assetBase: ASSET_BASE });
  assert.ok(!svg.includes('Northwatch'));
  assert.ok(svg.includes('>Iron Spine<'));
  assert.ok(svg.includes('data-target="relief/spine"'));
});

test('XML escaping: names with & and < are escaped and the output is valid XML', () => {
  const { svg } = render();
  assert.ok(svg.includes('ASH &amp; &lt;REACH&gt;'));
  assert.ok(!svg.includes('<REACH>'));
  const xmllint = spawnSync('xmllint', ['--noout', '-'], { input: svg, encoding: 'utf8' });
  if (xmllint.error && xmllint.error.code === 'ENOENT') {
    // No xmllint here: check that every element tag is balanced.
    const stack = [];
    for (const m of svg.matchAll(/<\/?([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
      if (m[0].startsWith('</')) assert.equal(stack.pop(), m[1], `unbalanced </${m[1]}>`);
      else if (m[2] !== '/') stack.push(m[1]);
    }
    assert.equal(stack.length, 0);
  } else {
    assert.equal(xmllint.status, 0, xmllint.stderr);
  }
});

test('stats count the stamps, the places and the drawn labels', () => {
  const { svg, stats } = render();
  assert.equal(stats.stamps, anchorsOf(svg).length);
  assert.equal(stats.places, 2);
  // A place label has a halo and a fill copy, both with the same data-target: count the targets once.
  const targets = new Set((svg.match(/data-target="[^"]+"/g) ?? []));
  assert.equal(stats.labels, targets.size);
  assert.ok(stats.labels >= 3);
});

test('the style colours and sizes come from the style object, not from the code', () => {
  const changed = structuredClone(STYLE);
  changed.style.coast.color = '#123456';
  changed.style.icons.other = 40;
  const { svg } = renderAtlasSvg({ manifest: fixture().manifest, layers: fixture().layers, style: changed, names: fixture().names, assetBase: ASSET_BASE });
  assert.ok(svg.includes('stroke="#123456"'));
  assert.ok(!svg.includes('#3b2f22'));
  // The town icon (other) is 40 cells wide: 40 * 1000 / 512 = 78.125 units.
  assert.ok(svg.includes('width="78.13"'));
});

test('hrefs are under styles/<id>/ and the font files are under fonts/', () => {
  const { svg } = render();
  assert.ok(svg.includes(`href="${ASSET_BASE}styles/fantasy-color/textures/land.webp"`));
  assert.ok(svg.includes(`url('${ASSET_BASE}fonts/Cinzel.ttf')`));
  assert.ok(svg.includes(`href="${ASSET_BASE}styles/fantasy-color/stamps/icons/town.webp"`), 'the place icon comes from the manifest');
});

test('realm names fit their arc: the computed advance never exceeds the arc length', () => {
  const f = fixture();
  f.names = { ...f.names };
  f.layers.political.features[0].name = 'The Unbelievably Long Realm Name Of The Far Reaches';
  const { svg } = renderAtlasSvg({ manifest: f.manifest, layers: f.layers, style: STYLE, names: f.names, assetBase: ASSET_BASE });
  const match = /class="realm-label" data-target="political\/ash" data-arc="([\d.]+)" data-advance="([\d.]+)"/.exec(svg);
  assert.ok(match, 'realm label with its fit data');
  assert.ok(Number(match[2]) <= Number(match[1]), `advance ${match[2]} exceeds arc ${match[1]}`);
});

test('fitArcLabel: a short name keeps the size, a long name on a short arc shrinks it, never past the arc', () => {
  const plain = fitArcLabel({ chars: 4, size: 20, ratio: 0.35, minRatio: 0.12, extent: 400, floor: 6 });
  assert.equal(plain.size, 20);
  assert.ok(plain.advance <= plain.arc);
  const long = fitArcLabel({ chars: 60, size: 20, ratio: 0.35, minRatio: 0.12, extent: 200, floor: 6 });
  assert.ok(long.advance <= long.arc + 1e-9, `advance ${long.advance} exceeds arc ${long.arc}`);
  assert.ok(long.arc <= 0.9 * 200 + 1e-9);
  assert.ok(long.size < 20);
});

test('realm borders are masked where they run along a coast; the fill is not masked', () => {
  const { svg } = render();
  assert.ok(svg.includes('<mask id="border-mask"'));
  assert.ok(svg.includes('<g mask="url(#border-mask)">'));
  const fill = /<path d="[^"]+" fill="#aa3322" fill-opacity="0\.1"\/>/.exec(svg);
  assert.ok(fill, 'realm fill is drawn without a mask');
});

test('vignette: off leaves no vignette in the SVG; the sea group is faded at the canvas edges by two nested masks', () => {
  const { svg } = render({}, { vignette: false });
  assert.ok(!svg.includes('layer-vignette'));
  assert.ok(!svg.includes('url(#vignette)'));
  assert.ok(svg.includes('<mask id="sea-fade-x"'));
  assert.ok(svg.includes('<mask id="sea-fade-y"'));
  assert.ok(svg.includes('<g id="layer-sea"><g mask="url(#sea-fade-x)"><g mask="url(#sea-fade-y)">'));
  const withVignette = render().svg;
  assert.ok(withVignette.includes('layer-vignette'));
});

test('labels: every place name sits in the labels group, never inside a place icon', () => {
  const { svg } = render();
  const labels = /<g id="layer-labels" data-layer="labels">([\s\S]*?)<\/g>/.exec(svg);
  assert.ok(labels, 'labels group with data-layer="labels"');
  assert.ok(labels[1].includes('>Northwatch<'));
  for (const place of svg.matchAll(/<g class="place"[^>]*>([\s\S]*?)<\/g>/g)) {
    assert.ok(!place[1].includes('<text'), 'a place icon holds no text');
  }
});

// Snapshots taken from the renderer before the urban layers were added to it: a geographic atlas must still render
// byte for byte the same (master and players audiences).
const GEOGRAPHIC_SNAPSHOT = 'c96f5546d752037d7aaef55dec542631bdaa7d6a0c51b7a397d5d939a2664d10';
const GEOGRAPHIC_PLAYERS_SNAPSHOT = '359573e1b1239d36991261a7405e6f27da9c91653e8de1348bd70e656ad5f2c2';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

test('a geographic atlas renders byte for byte as before the urban layers (snapshot)', () => {
  assert.equal(sha256(render().svg), GEOGRAPHIC_SNAPSHOT);
  assert.equal(sha256(render({}, { audience: 'players' }).svg), GEOGRAPHIC_PLAYERS_SNAPSHOT);
  assert.deepEqual(render().stats, { stamps: 644, places: 2, labels: 3, lots: 0, buildings: 0, districts: 0 });
});

// A mixed atlas: terrain land with relief and a forest that covers the city, and a walled city inside them.
const CITY_WALL = [[560, 140], [840, 140], [840, 420], [560, 420]];
const CITY_BLOCKS = [
  [[580, 160], [820, 160], [820, 260], [580, 260]],
  [[580, 280], [820, 280], [820, 400], [580, 400]],
];
const PARK = [[580, 262], [820, 262], [820, 278], [580, 278]];

function mixed() {
  return {
    manifest: { canvas: { width: 1000, height: 1000 }, seed: 11 },
    layers: {
      terrain: { features: [{ id: 'main', type: 'land', polygon: LAND }] },
      relief: { features: [{ id: 'ridge', type: 'mountains', polygon: [[120, 600], [380, 600], [380, 860], [120, 860]] }] },
      biomes: { features: [{ id: 'wood', type: 'forest', polygon: [[450, 100], [950, 100], [950, 880], [450, 880]] }] },
      places: { features: [
        { id: 'north', place: 'north', at: [300, 700], icon: 'town', visibility: 'public' },
        { id: 'hall', place: 'hall', at: [700, 200], icon: 'town', visibility: 'public' },
      ] },
      ground: { features: [
        { id: 'mill-canal', type: 'water', kind: 'canal', polygon: [[560, 405], [840, 405], [840, 415], [560, 415]] },
        { id: 'sea-piece', type: 'water', kind: 'sea', polygon: [[0, 0], [50, 0], [50, 50]] },
      ] },
      green: { features: [{ id: 'orchard', type: 'park', polygon: PARK }] },
      walls: { features: [
        { id: 'city-wall', type: 'wall', path: CITY_WALL, closed: true, thickness: 4 },
        { id: 'city-wall-tower-1', type: 'tower', at: [560, 140], radius: 6 },
        { id: 'city-wall-gate-1', type: 'gate', at: [700, 140], angle: 0, width: 8 },
      ] },
      streets: { features: [{ id: 'high', type: 'street', rank: 'main', width: 12, path: [[700, 140], [700, 420]] }] },
      blocks: { features: [
        { id: 'block-1', type: 'block', character: 'common', polygon: CITY_BLOCKS[0], lots: [{ kind: 'house', at: [600, 180], size: [12, 9], angle: 0 }] },
        { id: 'block-2', type: 'block', character: 'common', polygon: CITY_BLOCKS[1], lots: [{ kind: 'shop', at: [600, 300], size: [12, 9], angle: 0 }] },
      ] },
      buildings: { features: [{ id: 'hall', place: 'hall', at: [700, 200], kind: 'tavern', provenance: 'master', visibility: 'public' }] },
    },
    names: { north: 'Northwatch', hall: 'The Gilded Hall' },
  };
}

const renderMixed = (extra = {}) => {
  const f = mixed();
  return renderAtlasSvg({ manifest: f.manifest, layers: f.layers, style: STYLE, names: f.names, assetBase: ASSET_BASE, ...extra });
};

// The SVG of one layer group: from its opening tag to the next group.
const groupOf = (svg, name) => {
  const start = svg.indexOf(`<g id="layer-${name}"`);
  const end = svg.indexOf('\n<g id="layer-', start + 1);
  return svg.slice(start, end === -1 ? undefined : end);
};

test('a mixed atlas has the geographic and the urban groups in one canvas, every id once', () => {
  const { svg, stats } = renderMixed();
  for (const name of ['terrain', 'biomes', 'places', 'ground', 'green', 'walls', 'streets', 'blocks', 'buildings']) {
    assert.ok(svg.includes(`data-layer="${name}"`), `missing ${name}`);
  }
  const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.equal(ids.filter((id) => id === 'layer-labels').length, 1);
  assert.equal(stats.lots, 2);
  assert.equal(stats.buildings, 1);
  assert.equal(stats.districts, 0);
});

test('the urban groups come after the places and before the labels, in the urban order', () => {
  const { svg } = renderMixed();
  const at = (s) => svg.indexOf(s);
  const order = ['data-layer="places"', 'data-layer="ground"', 'data-layer="green"', 'data-layer="walls"', 'data-layer="streets"',
    'data-layer="blocks"', 'data-layer="buildings"', 'id="layer-labels"'];
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) < at(order[i]), `${order[i - 1]} before ${order[i]}`);
});

test('the ground of a mixed map is water only: no canvas fill, no sea piece, the canal is drawn', () => {
  const ground = groupOf(renderMixed().svg, 'ground');
  assert.ok(!ground.includes('<rect'), 'the canvas is not filled');
  assert.ok(!ground.includes('M0 0 L50 0'), 'the sea piece is left out');
  assert.ok(ground.includes('M560 405'), 'the canal is drawn');
});

test('stamps keep off the city: no stamp anchor lies in a block, the park or the walled ring, and stamps still cover the land outside', () => {
  const { svg, stats } = renderMixed();
  const anchors = [...svg.matchAll(/data-layer="(relief|biomes)" data-anchor="([-\d.]+),([-\d.]+)"/g)]
    .map((m) => [Number(m[2]), Number(m[3])]);
  assert.ok(anchors.length > 0);
  assert.equal(stats.stamps, anchors.length);
  for (const p of anchors) {
    for (const block of [...CITY_BLOCKS, PARK]) assert.ok(!pointInPolygon(p, block), `stamp ${p} is in a block`);
    assert.ok(!pointInPolygon(p, CITY_WALL), `stamp ${p} is inside the walls`);
  }
  assert.ok(anchors.some(([x, y]) => x > 450 && y > 430 && !pointInPolygon([x, y], CITY_WALL)), 'the forest outside the city has stamps');
});

test('a place inside a block has no icon, a place outside keeps it, and its building name is drawn once', () => {
  const { svg } = renderMixed();
  assert.ok(!svg.includes('data-place="hall" data-layer="places"'));
  assert.ok(svg.includes('data-place="north" data-layer="places"'));
  assert.ok(!svg.includes('data-target="places/hall"'), 'the place name is not drawn twice');
  assert.equal(svg.split('>The Gilded Hall<').length - 1, 2, 'one label: its halo and its fill');
  assert.ok(svg.includes('data-target="buildings/hall"'));
});

test('a labels-layer override can hide an urban label in a mixed atlas', () => {
  const f = mixed();
  f.layers.labels = { features: [{ id: 'hide-hall', target: 'buildings/hall', hidden: true }] };
  const { svg } = renderAtlasSvg({ manifest: f.manifest, layers: f.layers, style: STYLE, names: f.names, assetBase: ASSET_BASE });
  assert.ok(!svg.includes('The Gilded Hall'));
  assert.ok(svg.includes('>Northwatch<'));
});

test('an urban atlas with a forest layer and no terrain renders stamps on the urban ground, none in the blocks', () => {
  const { svg, stats } = renderAtlasSvg({
    manifest: { canvas: { width: 1000, height: 1000 }, seed: 5 },
    layers: {
      ground: { features: [{ id: 'isle', type: 'land', kind: 'island', polygon: LAND }] },
      biomes: { features: [{ id: 'wood', type: 'forest', polygon: [[450, 100], [950, 100], [950, 880], [450, 880]] }] },
      blocks: { features: [{ id: 'block-1', type: 'block', polygon: CITY_BLOCKS[0], lots: [] }] },
    },
    names: {},
    style: STYLE,
    assetBase: ASSET_BASE,
  });
  assert.ok(stats.stamps > 0);
  const anchors = [...svg.matchAll(/data-layer="(relief|biomes)" data-anchor="([-\d.]+),([-\d.]+)"/g)]
    .map((m) => [Number(m[2]), Number(m[3])]);
  assert.equal(anchors.length, stats.stamps);
  for (const p of anchors) {
    assert.ok(pointInPolygon(p, LAND), `stamp ${p} is off the island`);
    assert.ok(!pointInPolygon(p, CITY_BLOCKS[0]), `stamp ${p} is in the block`);
  }
  assert.ok(svg.indexOf('id="layer-ground"') < svg.indexOf('id="layer-biomes"'), 'the urban ground is the base under the biomes');
  assert.ok(svg.indexOf('id="layer-biomes"') < svg.indexOf('id="layer-stamps"'));
});

// The bake: overlays false draws only the map; a bake replaces the drawn map with one image and keeps the labels
// and an invisible hit target per place with a point.
test('overlays false: the drawn map only, no labels group, no place icons, no label text', () => {
  const { svg } = render({}, { overlays: false });
  assert.ok(svg.includes('id="layer-terrain"'), 'the map is drawn');
  assert.ok(svg.includes('id="layer-stamps"'), 'the stamps are drawn');
  assert.ok(!svg.includes('id="layer-labels"'), 'no labels group');
  assert.ok(!svg.includes('id="layer-places"'), 'no place icons');
  assert.ok(!svg.includes('class="place"'));
  assert.ok(!svg.includes('<text'), 'no text at all');
  assert.ok(!svg.includes('Northwatch'));
});

test('a bake replaces the drawn layers with one image, keeps the labels and adds a hit target per place', () => {
  const { svg, stats } = render({}, { bake: { href: 'assets/bake.png' } });
  assert.ok(svg.includes('<g data-layer="bake"><image href="assets/bake.png" x="0" y="0" width="1000" height="1000" preserveAspectRatio="none"/></g>'));
  for (const id of ['layer-sea', 'layer-terrain', 'layer-biomes', 'layer-water', 'layer-political', 'layer-routes', 'layer-stamps', 'layer-places']) {
    assert.ok(!svg.includes(`id="${id}"`), `${id} is replaced by the bake`);
  }
  assert.ok(svg.indexOf('data-layer="bake"') < svg.indexOf('id="layer-labels"'), 'the labels are drawn over the bake');
  assert.ok(svg.includes('>Northwatch<'), 'the labels stay as text');
  assert.ok(svg.includes('>Secret Hold<'), 'the master label is in the master render');
  const r = (8 * 1000 / 512).toFixed(2);
  assert.ok(svg.includes(`<g class="place" data-place="north"><circle cx="300" cy="700" r="${r}" fill="#000000" fill-opacity="0"/></g>`));
  assert.ok(svg.includes('<g class="place" data-place="hold">'), 'the master-visibility place has its target in the master render');
  assert.ok(svg.indexOf('id="layer-labels"') < svg.indexOf('data-layer="places"'), 'the hit targets come after the labels');
  assert.ok(stats.stamps > 0, 'the stats still count the stamps of the drawn map');
});

test('a bake for the players: no target and no label of a master-visibility place', () => {
  const { svg } = render({}, { audience: 'players', bake: { href: 'assets/bake.png' } });
  assert.ok(svg.includes('data-layer="bake"'));
  assert.ok(svg.includes('data-place="north"'));
  assert.ok(!svg.includes('data-place="hold"'));
  assert.ok(!svg.includes('Secret Hold'));
});

test('a bake with overlays false: the image and the hit targets, and no labels', () => {
  const { svg } = render({}, { overlays: false, bake: { href: 'assets/bake.png' } });
  assert.ok(svg.includes('data-layer="bake"'));
  assert.ok(!svg.includes('id="layer-labels"'));
  assert.ok(!svg.includes('<text'));
  assert.ok(svg.includes('data-place="north"'));
});

test('a bake needs an href, and the default options give the same SVG as no options', () => {
  assert.throws(() => render({}, { bake: { file: 'x.png' } }), /bake must be/);
  assert.equal(render({}, { overlays: true, bake: null }).svg, render().svg);
});
