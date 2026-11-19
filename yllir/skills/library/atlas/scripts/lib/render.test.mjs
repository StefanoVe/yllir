import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
