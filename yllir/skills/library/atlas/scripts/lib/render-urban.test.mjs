import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderUrbanSvg, urbanLayerGroups } from './render-urban.mjs';
import { loadStyle } from './styles.mjs';
import { generateGround } from './urban/ground.mjs';
import { generateGreen } from './urban/green.mjs';
import { generateWalls } from './urban/walls.mjs';
import { generateStreets } from './urban/streets.mjs';
import { generateBlocks } from './urban/blocks.mjs';
import { generateDistricts } from './urban/districts.mjs';
import { lotSvg } from './urban-assets.mjs';

const ASSET_BASE = 'assets/';
const STYLE = loadStyle('fantasy-color');
const U = STYLE.style.urban;

// Lot colours: each kind has its own roof colour, so a lot is recognisable in the SVG.
const LOT_OVERLAPPED = 'smithy'; // inside the tavern: must be skipped
const LOT_FREE = 'barn'; // on its own: must be drawn

function fixture({ withMaster = true } = {}) {
  const buildings = [
    { id: 'hall', place: 'hall', at: [300, 300], kind: 'tavern', provenance: 'master', visibility: 'public', sources: [] },
    { id: 'nameless', place: 'nameless', at: [700, 700], kind: 'house', provenance: 'agent-choice', visibility: 'public', sources: [] },
  ];
  if (withMaster) {
    buildings.push({ id: 'cellar', place: 'cellar', at: [500, 150], kind: 'keep', provenance: 'master', visibility: 'master', sources: [] });
  }
  return {
    manifest: { canvas: { width: 1000, height: 800 }, seed: 3 },
    layers: {
      ground: { layer: 'ground', features: [
        { id: 'harbour', type: 'water', kind: 'coast', polygon: [[0, 700], [1000, 700], [1000, 800], [0, 800]], provenance: 'agent-choice', sources: [] },
      ] },
      green: { layer: 'green', features: [
        { id: 'green-park', type: 'park', polygon: [[60, 60], [200, 60], [200, 160], [60, 160]], provenance: 'agent-choice', sources: [] },
      ] },
      walls: { layer: 'walls', features: [
        { id: 'town-wall', type: 'wall', path: [[40, 40], [960, 40], [960, 640], [40, 640]], closed: true, thickness: 3, provenance: 'agent-choice', sources: [] },
        { id: 'town-wall-tower-1', type: 'tower', at: [40, 40], radius: 5, provenance: 'agent-choice', sources: [] },
        { id: 'town-wall-gate-1', type: 'gate', at: [500, 40], angle: 0, width: 8, provenance: 'agent-choice', sources: [] },
      ] },
      streets: { layer: 'streets', features: [
        { id: 'high-street', type: 'street', rank: 'main', width: 14, path: [[100, 300], [900, 320]], provenance: 'agent-choice', sources: [] },
        { id: 'back-lane', type: 'street', rank: 'lane', width: 5, path: [[500, 200], [520, 600]], provenance: 'agent-choice', sources: [] },
        { id: 'bridge-1', type: 'bridge', width: 10, path: [[600, 600], [700, 600]], provenance: 'agent-choice', sources: [] },
        { id: 'market-square', type: 'square', polygon: [[600, 250], [700, 250], [700, 350], [600, 350]], provenance: 'agent-choice', sources: [] },
      ] },
      blocks: { layer: 'blocks', features: [
        {
          id: 'block-1', type: 'block', character: 'common', provenance: 'agent-choice', sources: [],
          polygon: [[100, 100], [450, 100], [450, 280], [100, 280]],
          lots: [
            { kind: LOT_OVERLAPPED, at: [300, 300], size: [10, 8], angle: 0 },
            { kind: LOT_FREE, at: [150, 200], size: [16, 12], angle: 0 },
          ],
        },
      ] },
      buildings: { layer: 'buildings', features: buildings },
      districts: { layer: 'districts', features: [
        {
          id: 'docks', type: 'district', place: 'docks', color: '#8844aa', seeds: [[800, 740]],
          polygons: [[[600, 500], [900, 500], [900, 680], [600, 680]]], provenance: 'agent-choice', sources: [],
        },
      ] },
      labels: { layer: 'labels', features: [] },
    },
    names: { hall: 'The Gilded Hall', nameless: undefined, cellar: 'Ash & Cellar', docks: 'Saltwharf' },
  };
}

const render = (options = {}, extra = {}) => {
  const f = fixture(options);
  return renderUrbanSvg({
    manifest: f.manifest, layers: f.layers, names: f.names, style: STYLE, assetBase: ASSET_BASE, ...extra,
  });
};

const GROUPS = ['ground', 'green', 'walls', 'streets', 'blocks', 'buildings', 'districts', 'labels'];

test('the outer structure: an XML document with the canvas size, the fonts and the textures', () => {
  const { svg } = render();
  assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1000 800" width="1000" height="800">/);
  assert.match(svg, /<defs>/);
  assert.match(svg, /@font-face \{ font-family: 'IM Fell English'; src: url\('assets\/fonts\/IMFellEnglish-Regular\.ttf'\); \}/);
  assert.match(svg, /@font-face \{ font-family: 'Cinzel'; src: url\('assets\/fonts\/Cinzel\.ttf'\); \}/);
  assert.match(svg, /<pattern id="tex-land"/);
  assert.match(svg, /<pattern id="tex-sea"/);
  assert.doesNotMatch(svg, /vignette/);
});

test('each layer is drawn in its own group, in the order of the urban layers', () => {
  const { svg } = render();
  let last = -1;
  for (const name of GROUPS) {
    const at = svg.indexOf(`<g id="layer-${name}" data-layer="${name}">`);
    assert.ok(at > last, `group ${name} is missing or out of order`);
    last = at;
  }
});

test('an empty layer set still gives every layer group', () => {
  const { svg } = renderUrbanSvg({ manifest: { canvas: { width: 600, height: 400 }, seed: 1 }, style: STYLE, assetBase: ASSET_BASE });
  for (const name of GROUPS) assert.ok(svg.includes(`data-layer="${name}"`), name);
});

test('colours come from the style', () => {
  const { svg } = render();
  for (const colour of [U.ground, U.water, U.waterEdge, U.block, U.street.casing, U.street.main, U.street.lane, U.wall.stone, U.wall.outline, U.green.park, U.roof.tavern, U.roof[LOT_FREE]]) {
    assert.ok(svg.includes(colour), `missing ${colour}`);
  }
  assert.ok(svg.includes(`fill-opacity="${U.district.fillOpacity}"`));
  assert.ok(svg.includes('stroke-width="0.8"'));
});

test('a lot under a building the audience sees is skipped, a free lot is drawn', () => {
  const { svg, stats } = render();
  assert.equal(svg.includes(U.roof[LOT_OVERLAPPED]), false);
  assert.equal(svg.includes(U.roof[LOT_FREE]), true);
  assert.equal(stats.lots, 1);
});

test('master-only features are hidden from the players, with their names', () => {
  const master = render({ withMaster: true }).svg;
  assert.ok(master.includes('data-place="cellar"'));
  assert.ok(master.includes('Ash &amp; Cellar'));
  const players = render({ withMaster: true }, { audience: 'players' }).svg;
  assert.equal(players.includes('cellar'), false);
  assert.equal(players.includes('Ash'), false);
  assert.ok(players.includes('data-place="hall"'));
});

test('no name is printed unless it is given: a building without a name has no label', () => {
  const { svg } = render();
  assert.ok(svg.includes('data-place="nameless"'));
  assert.equal(svg.includes('data-target="buildings/nameless"'), false);
  assert.ok(svg.includes('The Gilded Hall'));
  assert.ok(svg.includes('SALTWHARF'));
});

test('a named building and a named district are clickable places with their labels', () => {
  const { svg } = render();
  assert.match(svg, /<g class="place" data-place="hall">/);
  assert.match(svg, /<g class="place" data-place="docks" pointer-events="none">/);
  assert.match(svg, /<text data-target="districts\/docks" class="place" data-place="docks"/);
});

test('the labels layer can hide or move a label', () => {
  const f = fixture();
  f.layers.labels = { layer: 'labels', features: [
    { id: 'hide-hall', target: 'buildings/hall', hidden: true },
    { id: 'move-docks', target: 'districts/docks', at: [10, 20] },
  ] };
  const { svg } = renderUrbanSvg({ manifest: f.manifest, layers: f.layers, names: f.names, style: STYLE, assetBase: ASSET_BASE });
  assert.equal(svg.includes('The Gilded Hall'), false);
  assert.match(svg, /x="10" y="20"[^>]*>SALTWHARF</);
});

test('a gate is cut into the wall: a ground-coloured gap, then the gate', () => {
  const { svg } = render();
  assert.match(svg, /<line x1="-4" y1="0" x2="4" y2="0" stroke="#e6d6a0"/);
  assert.match(svg, /<rect x="-5" y="-1" width="2" height="2"/);
  assert.match(svg, /<rect x="3" y="-1" width="2" height="2"/);
});

test('the wall of a closed ring is drawn with its outline underneath', () => {
  const { svg } = render();
  assert.match(svg, /stroke="#4a3b2a" stroke-width="4\.6"/);
  assert.match(svg, /stroke="#b8a88c" stroke-width="3"/);
});

test('the rendering is deterministic', () => {
  assert.deepEqual(render(), render());
});

test('the vignette option is accepted and ignored', () => {
  assert.equal(render({}, { vignette: false }).svg, render().svg);
});

test('the stats count the lots, buildings, districts and labels drawn', () => {
  const { stats } = render();
  assert.deepEqual(stats, { lots: 1, buildings: 3, districts: 1, labels: 3 });
});

test('an unknown audience is refused', () => {
  assert.throws(() => renderUrbanSvg({ manifest: { canvas: { width: 10, height: 10 } }, audience: 'staff', style: STYLE }), /audience must be one of/);
});

/** Drawn footprint [w, h] of the building with the given place, from its own rectangle in the SVG. */
function footprintOf(svg, place) {
  const m = new RegExp(`data-place="${place}">[\\s\\S]*?<rect x="[-\\d.]+" y="[-\\d.]+" width="([\\d.]+)" height="([\\d.]+)"`).exec(svg);
  assert.ok(m, `no footprint for ${place}`);
  return [Number(m[1]), Number(m[2])];
}

/** The visible labels of the labels layer: text, position, size, opacity and the estimated box (not the halos). */
function labelsOf(svg) {
  const layer = svg.slice(svg.indexOf('<g id="layer-labels"'));
  return [...layer.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)]
    .filter(([, attrs]) => !attrs.includes('stroke='))
    .map(([, attrs, text]) => {
      const get = (name) => (new RegExp(` ${name}="([^"]*)"`).exec(` ${attrs}`) ?? [])[1];
      const size = Number(get('font-size'));
      const x = Number(get('x'));
      const y = Number(get('y'));
      const w = [...text].length * size * 0.6;
      return { target: get('data-target'), text, size, opacity: get('opacity'), y, box: { x0: x - w / 2, x1: x + w / 2, y0: y - size, y1: y + size * 0.25 } };
    });
}

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The demo setup of the urban atlas (ground, green, walls, streets, blocks, districts and two named buildings). */
function demoLayers() {
  const canvas = { width: 1200, height: 900 };
  const seed = 42;
  const P = (kind, o) => ({ provenance: 'agent-choice', ...o, kind });
  const layers = {};
  const run = (name, gen, constraints) => {
    layers[name] = { layer: name, constraints, features: gen({ canvas, seed, constraints, layers }).features };
  };
  run('ground', generateGround, [P('river', { id: 'river', source: [0, 560], mouth: [1200, 640], via: [[500, 520], [800, 680]], width: 40 }), P('coast', { id: 'sea', side: 'south', depth: 90, roughness: 0.5 })]);
  run('green', generateGreen, [P('park', { id: 'park', type: 'park', at: [300, 300], radius: 70 }), P('park', { id: 'fields', type: 'field', at: [1050, 150], radius: 110 })]);
  run('walls', generateWalls, [P('wall', { id: 'wall', ring: [[150, 120], [900, 100], [980, 450], [860, 780], [200, 760], [100, 420]], thickness: 7, towers: 'corners', gates: [{ at: [540, 110] }, { at: [900, 600] }] })]);
  run('streets', generateStreets, [P('street', { id: 'high', rank: 'main', path: [[140, 430], [540, 440], [980, 430]] }), P('street', { id: 'north', rank: 'main', path: [[540, 105], [540, 440], [520, 770]] }), P('square', { id: 'sq', at: [540, 440], size: [90, 70] }), P('grid', { id: 'g1', area: [[160, 130], [520, 130], [520, 420], [160, 420]], spacing: 60, rank: 'lane' }), P('grid', { id: 'g2', area: [[560, 130], [900, 130], [940, 420], [560, 420]], spacing: 55, angle: 0.3, rank: 'lane' })]);
  run('blocks', generateBlocks, [P('fill', { id: 'f', character: 'common' })]);
  run('districts', generateDistricts, [P('district', { id: 'old', color: '#c0504d', seeds: [[300, 300]], name: 'Città Vecchia' }), P('district', { id: 'port', color: '#4f81bd', seeds: [[700, 650]], name: 'Porto' })]);
  layers.buildings = { layer: 'buildings', constraints: [], features: [
    { id: 'tempio', place: 'tempio', at: [540, 350], kind: 'temple', provenance: 'master', visibility: 'public', sources: [] },
    { id: 'taverna', place: 'taverna', at: [420, 500], kind: 'tavern', provenance: 'master', visibility: 'public', sources: [] }] };
  return { canvas, layers, names: { tempio: 'Tempio del Sole', taverna: 'Taverna del Gatto' } };
}

test('a named building is drawn at least 1.6 times its default size', () => {
  const { svg } = render();
  const [w, h] = footprintOf(svg, 'hall'); // a tavern: default 16 x 12
  assert.ok(w >= 16 * 1.6 - 0.05, `width ${w}`);
  assert.ok(h >= 12 * 1.6 - 0.05, `height ${h}`);
});

test('a named building given a small size is never drawn below 14 x 14', () => {
  const f = fixture();
  f.layers.buildings = { layer: 'buildings', features: [
    { id: 'chapel', place: 'chapel', at: [600, 600], kind: 'shrine', size: [5, 5], provenance: 'master', visibility: 'public', sources: [] },
  ] };
  const { svg } = renderUrbanSvg({ manifest: f.manifest, layers: f.layers, names: { chapel: 'Little Chapel' }, style: STYLE, assetBase: ASSET_BASE });
  assert.deepEqual(footprintOf(svg, 'chapel'), [14, 14]);
});

test('an unnamed building keeps its own size, and a lot is skipped when only the enlarged building covers it', () => {
  const f = fixture();
  // The tavern is drawn 25.6 wide, so a lot 13 units from its centre (8 wide) is under it: skipped.
  f.layers.blocks = { layer: 'blocks', features: [
    { id: 'block-x', type: 'block', character: 'common', provenance: 'agent-choice', sources: [],
      polygon: [[100, 100], [450, 100], [450, 280], [100, 280]], lots: [{ kind: LOT_FREE, at: [313, 200], size: [8, 8], angle: 0 }] },
  ] };
  const { svg, stats } = renderUrbanSvg({ manifest: f.manifest, layers: f.layers, names: f.names, style: STYLE, assetBase: ASSET_BASE });
  assert.equal(stats.lots, 1, 'the lot at y 200 is above the tavern and kept');
  const f2 = fixture();
  f2.layers.blocks = { layer: 'blocks', features: [
    { id: 'block-x', type: 'block', character: 'common', provenance: 'agent-choice', sources: [],
      polygon: [[100, 100], [450, 100], [450, 280], [100, 280]], lots: [{ kind: LOT_FREE, at: [313, 300], size: [8, 8], angle: 0 }] },
  ] };
  const skipped = renderUrbanSvg({ manifest: f2.manifest, layers: f2.layers, names: f2.names, style: STYLE, assetBase: ASSET_BASE });
  assert.equal(skipped.stats.lots, 0, 'the lot inside the enlarged tavern is skipped');
  assert.equal(svg.includes(U.roof[LOT_FREE]), true);
});

test('district names are drawn first, beneath the building names, at a lower opacity', () => {
  const { svg } = render();
  const labels = labelsOf(svg);
  const firstDistrict = labels.findIndex((l) => l.target.startsWith('districts/'));
  const firstBuilding = labels.findIndex((l) => l.target.startsWith('buildings/'));
  assert.ok(firstDistrict === 0 && firstBuilding > firstDistrict, 'district labels come first');
  assert.ok(Number(labels[firstDistrict].opacity) < U.district.labelOpacity, 'fainter than the style opacity');
});

test('a district name that overlaps a building name moves up by one font size, at most three times', () => {
  const f = fixture();
  f.layers.districts = { layer: 'districts', features: [
    { id: 'old', type: 'district', place: 'old', color: '#c0504d', name: 'Old Town', polygons: [[[100, 100], [500, 100], [500, 400], [100, 400]]], provenance: 'agent-choice', sources: [] },
  ] };
  // The building name sits where the centred district name would be.
  f.layers.buildings = { layer: 'buildings', features: [
    { id: 'well', place: 'well', at: [300, 240], kind: 'house', provenance: 'master', visibility: 'public', sources: [] },
  ] };
  const { svg } = renderUrbanSvg({ manifest: f.manifest, layers: f.layers, names: { well: 'Well' }, style: STYLE, assetBase: ASSET_BASE });
  const labels = labelsOf(svg);
  const district = labels.find((l) => l.target === 'districts/old');
  const building = labels.find((l) => l.target === 'buildings/well');
  assert.equal(overlaps(district.box, building.box), false, 'the labels do not overlap');
  const shift = 250 - district.y;
  assert.ok(shift > 0 && shift <= 3 * district.size + 1e-6, `shift ${shift}`);
  assert.ok(Math.abs(shift / district.size - Math.round(shift / district.size)) < 0.05, 'moved by whole font sizes');
});

test('in the demo setup no two labels overlap', () => {
  const { canvas, layers, names } = demoLayers();
  const { svg } = renderUrbanSvg({ manifest: { canvas, scope: { kind: 'settlement' } }, layers, names, style: STYLE, assetBase: ASSET_BASE });
  const labels = labelsOf(svg);
  assert.ok(labels.length >= 4, 'the two districts and the two buildings are labelled');
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      assert.equal(overlaps(labels[i].box, labels[j].box), false, `${labels[i].text} overlaps ${labels[j].text}`);
    }
  }
});

// Island: a land feature of the ground layer over a water canvas. The sea pieces have no edge stroke.
const ISLAND_POLYGON = [[200, 150], [800, 150], [800, 650], [200, 650]];
const ringPath = (polygon) => `M${polygon.map(([x, y]) => `${x} ${y}`).join(' L')} Z`;
const groundOf = (svg) => svg.slice(svg.indexOf('data-layer="ground"'), svg.indexOf('data-layer="green"'));
const withIsland = (ground = []) => renderUrbanSvg({
  manifest: { canvas: { width: 1000, height: 800 }, seed: 3 },
  style: STYLE,
  assetBase: ASSET_BASE,
  layers: {
    ground: { layer: 'ground', features: [
      { id: 'home-isle', type: 'land', kind: 'island', polygon: ISLAND_POLYGON, provenance: 'master', visibility: 'public', sources: [] },
      { id: 'home-isle-sea-ne', type: 'water', kind: 'sea', polygon: [[500, 0], [1000, 0], [1000, 400], [800, 400]], provenance: 'master', visibility: 'public', sources: [] },
      { id: 'home-isle-sea-sw', type: 'water', kind: 'sea', polygon: [[0, 400], [200, 400], [200, 800], [0, 800]], provenance: 'master', visibility: 'public', sources: [] },
      ...ground,
    ] },
  },
}).svg;

test('an island: its outline is stroked with the water edge, over a soft shore; sea pieces have no stroke', () => {
  const svg = withIsland();
  const ground = groundOf(svg);
  const outline = `<path d="${ringPath(ISLAND_POLYGON)}" fill="none" stroke="${U.waterEdge}" stroke-width="0.8" stroke-linejoin="round"/>`;
  assert.ok(ground.includes(outline), 'the island outline is stroked with waterEdge at 0.8');
  assert.ok(ground.includes(`<path d="${ringPath(ISLAND_POLYGON)}" fill="none" stroke="${U.water}" stroke-width="6"`), 'a wide water shore under it');
  assert.ok(ground.includes(`stroke-width="6" stroke-linejoin="round" opacity="0.35"`), 'the shore is at opacity 0.35');
  const strokes = ground.match(/stroke="[^"]+"/g) ?? [];
  assert.equal(strokes.filter((x) => x === `stroke="${U.waterEdge}"`).length, 1, 'only the island outline has the water edge');
});

test('an island: the canvas is water and the island is the land (no ground colour over the whole canvas)', () => {
  const ground = groundOf(withIsland());
  assert.ok(ground.includes(`<rect x="0" y="0" width="1000" height="800" fill="${U.water}"/>`));
  const rects = ground.match(/<rect [^>]*>/g) ?? [];
  assert.equal(rects.some((r) => r.includes(`fill="${U.ground}"`)), false, 'no canvas-wide ground colour');
  assert.ok(ground.includes(`<path d="${ringPath(ISLAND_POLYGON)}" fill="${U.ground}"/>`), 'the island is filled with the ground colour');
});

test('without an island the ground is the whole canvas, as before', () => {
  const svg = renderUrbanSvg({
    manifest: { canvas: { width: 1000, height: 800 }, seed: 3 },
    style: STYLE,
    assetBase: ASSET_BASE,
    layers: { ground: { layer: 'ground', features: [
      { id: 'mill-pond', type: 'water', kind: 'pond', polygon: [[400, 300], [600, 300], [600, 500], [400, 500]], provenance: 'master', visibility: 'public', sources: [] },
    ] } },
  }).svg;
  const ground = groundOf(svg);
  assert.ok(ground.includes(`<rect x="0" y="0" width="1000" height="800" fill="${U.ground}"/>`), 'the canvas is the ground colour');
  assert.ok(ground.includes(`<path d="${ringPath([[400, 300], [600, 300], [600, 500], [400, 500]])}" fill="none" stroke="${U.waterEdge}" stroke-width="0.8" stroke-linejoin="round"/>`), 'water keeps its edge');
  assert.equal(ground.includes('stroke-width="6"'), false, 'no shore without an island');
});

test('an island: the sea pieces are drawn with fill only, and the ground group stays data-layer ground', () => {
  const svg = withIsland();
  assert.ok(svg.includes('<g id="layer-ground" data-layer="ground">'));
  assert.ok(groundOf(svg).includes(`<path d="${ringPath([[500, 0], [1000, 0], [1000, 400], [800, 400]])}" fill="${U.water}"/>`));
});

test('the lots of a block are grouped by kind: at most 10 paths for 300 lots of 3 kinds, and a smaller string', () => {
  const KINDS = ['house', 'rowhouse', 'shop'];
  const lots = [];
  for (let n = 0; n < 300; n++) {
    const col = n % 20;
    const row = Math.floor(n / 20);
    lots.push({ kind: KINDS[n % 3], at: [100 + col * 20, 100 + row * 16], size: [10, 8], angle: (n % 4) * 0.2 });
  }
  const layers = { blocks: { layer: 'blocks', features: [
    { id: 'block-big', type: 'block', character: 'common', provenance: 'agent-choice', sources: [],
      polygon: [[60, 60], [720, 60], [720, 620], [60, 620]], lots },
  ] } };
  const { svg, stats } = renderUrbanSvg({ manifest: { canvas: { width: 800, height: 700 }, seed: 1 }, layers, style: STYLE, assetBase: ASSET_BASE });
  assert.equal(stats.lots, 300);
  const start = svg.indexOf('<g id="layer-blocks"');
  const end = svg.indexOf('<g id="layer-buildings"');
  const group = svg.slice(start, end);
  // One path for the block outline, then the lots: at most 10 paths in all (6 for the lots here).
  assert.ok((group.match(/<path /g) ?? []).length <= 10);
  assert.equal((group.match(/<path /g) ?? []).length, 1 + 2 * KINDS.length);
  // The former output was one lotSvg fragment per lot: the whole group is now smaller than those fragments alone.
  const before = lots.reduce((sum, lot) => sum + lotSvg({ ...lot, urban: U }).length, 0);
  assert.ok(group.length < before, `grouped ${group.length} is not smaller than ${before}`);
});

test('urbanLayerGroups: one group string per urban layer, the labels as a list, the piece counts and the defs', () => {
  const f = fixture();
  const out = urbanLayerGroups({ layers: f.layers, style: STYLE, names: f.names, canvas: f.manifest.canvas, assetBase: ASSET_BASE });
  for (const name of GROUPS.slice(0, -1)) {
    assert.ok(out.groups[name].startsWith(`<g id="layer-${name}" data-layer="${name}">`), name);
    assert.ok(out.groups[name].endsWith('</g>'), name);
    assert.ok(out.stats.counts[name] > 0, `${name} has pieces`);
  }
  assert.equal(out.labels.length, out.stats.labels);
  assert.ok(out.defs.includes('<style>'));
  const { svg } = renderUrbanSvg({ manifest: f.manifest, layers: f.layers, names: f.names, style: STYLE, assetBase: ASSET_BASE });
  for (const name of GROUPS.slice(0, -1)) assert.ok(svg.includes(out.groups[name]), `${name} is in the urban svg as it is`);
  assert.ok(svg.includes(out.labels[0]));
});

test('urbanLayerGroups with terrain land: the ground is water only (no canvas fill, no island, no sea piece)', () => {
  const layers = {
    terrain: { features: [{ id: 'main', type: 'land', polygon: [[0, 0], [1000, 0], [1000, 800], [0, 800]] }] },
    ground: { features: [
      { id: 'sea-1', type: 'water', kind: 'sea', polygon: [[0, 0], [50, 0], [50, 50]] },
      { id: 'canal-1', type: 'water', kind: 'canal', polygon: [[300, 300], [600, 300], [600, 320]] },
      { id: 'isle', type: 'land', kind: 'island', polygon: [[100, 100], [200, 100], [200, 200]] },
    ] },
  };
  const { groups, stats } = urbanLayerGroups({ layers, style: STYLE, canvas: { width: 1000, height: 800 }, assetBase: ASSET_BASE });
  assert.ok(!groups.ground.includes('<rect'));
  assert.ok(groups.ground.includes('M300 300'), 'the canal is drawn');
  assert.ok(!groups.ground.includes('M0 0 L50 0'), 'the sea piece is left out');
  assert.ok(!groups.ground.includes('M100 100'), 'the island is left out');
  assert.ok(stats.counts.ground > 0, 'the canal is counted as a drawn piece');
});

test('urbanLayerGroups without terrain land: the ground fills the canvas and the island is drawn over the sea', () => {
  const layers = { ground: { features: [
    { id: 'sea-1', type: 'water', kind: 'sea', polygon: [[0, 0], [50, 0], [50, 50]] },
    { id: 'isle', type: 'land', kind: 'island', polygon: [[100, 100], [200, 100], [200, 200]] },
  ] } };
  const { groups } = urbanLayerGroups({ layers, style: STYLE, canvas: { width: 1000, height: 800 }, assetBase: ASSET_BASE });
  assert.ok(groups.ground.includes('<rect x="0" y="0" width="1000" height="800"'));
  assert.ok(groups.ground.includes('M100 100'), 'the island is drawn');
});

// The bake of an urban map: the drawn layers become one image, the labels stay, and each place with a point has a target.
const URBAN_BAKE_MANIFEST = { canvas: { width: 1000, height: 800 }, seed: 3 };
const URBAN_BAKE_LAYERS = {
  ground: { layer: 'ground', features: [{ id: 'ground-main', type: 'land', polygon: [[0, 0], [1000, 0], [1000, 800], [0, 800]], provenance: 'agent-choice', sources: [] }] },
  buildings: { layer: 'buildings', features: [
    { id: 'hall', place: 'hall', at: [300, 300], kind: 'tavern', provenance: 'master', visibility: 'public', sources: [] },
    { id: 'cellar', place: 'cellar', at: [500, 150], kind: 'keep', provenance: 'master', visibility: 'master', sources: [] },
  ] },
  districts: { layer: 'districts', features: [
    { id: 'old', type: 'district', place: 'old', seeds: [[700, 500]], polygon: [[600, 400], [900, 400], [900, 700], [600, 700]], color: '#aa3322', provenance: 'master', visibility: 'public', sources: [] },
  ] },
};
const URBAN_BAKE_NAMES = { hall: 'The Hall', old: 'Old Ward' };

test('urban overlays false: the drawn buildings and districts, no labels at all', () => {
  const { svg } = renderUrbanSvg({ manifest: URBAN_BAKE_MANIFEST, layers: URBAN_BAKE_LAYERS, names: URBAN_BAKE_NAMES, style: STYLE, assetBase: ASSET_BASE, overlays: false });
  assert.ok(svg.includes('id="layer-buildings"'));
  assert.ok(svg.includes('id="layer-districts"'));
  assert.ok(!svg.includes('id="layer-labels"'));
  assert.ok(!svg.includes('<text'));
});

test('urban bake: one image replaces the layers, the labels stay, and each place with a point has a hit target', () => {
  const { svg, stats } = renderUrbanSvg({
    manifest: URBAN_BAKE_MANIFEST, layers: URBAN_BAKE_LAYERS, names: URBAN_BAKE_NAMES, style: STYLE, assetBase: ASSET_BASE,
    bake: { href: 'assets/bake.webp' },
  });
  assert.ok(svg.includes('<g data-layer="bake"><image href="assets/bake.webp" x="0" y="0" width="1000" height="800" preserveAspectRatio="none"/></g>'));
  for (const name of ['ground', 'buildings', 'districts']) assert.ok(!svg.includes(`id="layer-${name}"`), `${name} is baked`);
  assert.ok(svg.includes('>The Hall<'), 'the building name stays as text');
  assert.ok(svg.includes('>OLD WARD<') || svg.includes('>Old Ward<'), 'the district name stays as text');
  const r = (8 * 1000 / 512).toFixed(2);
  assert.ok(svg.includes(`<g class="place" data-place="hall"><circle cx="300" cy="300" r="${r}" fill="#000000" fill-opacity="0"/></g>`));
  assert.ok(svg.includes('<g class="place" data-place="old"><circle cx="700" cy="500"'), 'a district is hit at its first seed');
  assert.ok(svg.includes('data-place="cellar"'), 'the master-visibility building is in the master render');
  assert.ok(stats.labels > 0, 'the labels are counted');
});

test('urban bake for the players: the master-visibility building has no target', () => {
  const { svg } = renderUrbanSvg({
    manifest: URBAN_BAKE_MANIFEST, layers: URBAN_BAKE_LAYERS, names: URBAN_BAKE_NAMES, style: STYLE, assetBase: ASSET_BASE,
    audience: 'players', bake: { href: 'assets/bake.webp' },
  });
  assert.ok(svg.includes('data-place="hall"'));
  assert.ok(!svg.includes('data-place="cellar"'));
});

test('urban default options give the same SVG as explicit overlays true and bake null', () => {
  const base = { manifest: URBAN_BAKE_MANIFEST, layers: URBAN_BAKE_LAYERS, names: URBAN_BAKE_NAMES, style: STYLE, assetBase: ASSET_BASE };
  assert.equal(renderUrbanSvg({ ...base, overlays: true, bake: null }).svg, renderUrbanSvg(base).svg);
  assert.throws(() => renderUrbanSvg({ ...base, bake: { href: '' } }), /bake must be/);
});
