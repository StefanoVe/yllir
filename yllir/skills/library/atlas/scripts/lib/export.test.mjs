import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exportAtlas, summaryOf, layersHash } from './export.mjs';
import { readAtlas } from './model.mjs';
import { encodePng } from '../../../../../scripts/lib/png.mjs';
import {
  cleanupCampaigns, makeCampaign, campaignYaml, baseManifest, terrainLayer, placesLayer, writeAtlas,
  urbanManifest, groundLayer, buildingsLayer, blocksLayer, square,
} from './test-support.mjs';

after(cleanupCampaigns);

const SECRET = 'the duke is the cult leader hiding in the cellar';
const SITE = '.campaign/cache/atlas';

/** A place sheet with a public description and, optionally, a master-only block after the marker. */
function sheet({ id, title, body, master = '' }) {
  return [
    '<!-- yllir', `id: ${id}`, 'kind: place', 'provenance: master', '-->',
    `# ${title}`, '', '## Description', '', body, '',
    ...(master ? ['<!-- master -->', master, ''] : []),
  ].join('\n');
}

/**
 * A campaign with two places (north with a master block, south), the terrain, and a places layer.
 * `places` lists the features; `yaml` replaces campaign.yaml.
 */
function campaign({
  yaml,
  places = [['north', [500, 500]], ['south', [600, 600]]],
  northBody = 'The northern town keeps the old market.',
  extraFeatures = [],
} = {}) {
  const root = makeCampaign({
    'World/North/North.md': sheet({ id: 'north', title: 'North', body: northBody, master: `Secret: ${SECRET}.` }),
    'World/South.md': sheet({ id: 'south', title: 'South', body: 'A quiet fishing village.' }),
    'People/Mara.md': sheet({ id: 'mara', title: 'Mara', body: 'A courier.' }),
  }, yaml ? { yaml } : {});
  const layer = placesLayer(places);
  layer.features.push(...extraFeatures);
  writeAtlas(root, {
    manifest: baseManifest({ style: 'fantasy-color' }),
    layers: { terrain: terrainLayer(), places: layer },
  });
  return root;
}

const readHtml = (root, audience) => fs.readFileSync(path.join(root, SITE, audience, 'index.html'), 'utf8');
const dataOf = (html) => {
  const match = /<script type="application\/json" id="atlas-data">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(match[1]);
};
const listFiles = (dir) => {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
};

const ENCYCLOPEDIA_YAML = `${campaignYaml()}modules:\n  encyclopedia: true\nencyclopedia:\n  base_url: "https://example.org/calvane"\n`;

test('the master export writes the page, the viewer and only the assets the page references', () => {
  const root = campaign();
  const result = exportAtlas(root, { audience: 'master' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.dir, `${SITE}/master`);
  const dir = path.join(root, SITE, 'master');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(fs.existsSync(path.join(dir, 'assets', 'viewer.js')));
  assert.ok(fs.existsSync(path.join(dir, 'assets', 'viewer.css')));
  assert.ok(fs.existsSync(path.join(dir, 'assets', 'fonts', 'IMFellEnglish-Regular.ttf')));
  // Every asset the page names is there; every stamp that was copied is named by the page.
  for (const match of html.matchAll(/assets\/([A-Za-z0-9_./-]+)/g)) {
    assert.ok(fs.existsSync(path.join(dir, 'assets', match[1])), `missing ${match[1]}`);
  }
  const stamps = listFiles(path.join(dir, 'assets')).filter((f) => f.includes('/stamps/'));
  for (const file of stamps) assert.ok(html.includes(`assets/${file}`), `unreferenced ${file}`);
  assert.ok(stamps.length > 0, 'the place icon is a stamp');
  const installed = JSON.parse(fs.readFileSync(new URL('../../assets/styles/fantasy-color/manifest.json', import.meta.url), 'utf8'));
  assert.ok(stamps.length < installed.stamps.length, 'not every stamp of the style is copied');
  assert.equal(result.stats.places, 2);
  assert.ok(result.stats.bytes > 0);
});

test('the players export drops a master-visibility place from the page and from the data', () => {
  // South is a public sheet, but its place feature is master-only (the feature id equals the place id).
  const root = campaign({
    places: [['north', [500, 500]]],
    extraFeatures: [{ id: 'south', place: 'south', at: [700, 500], icon: 'fort', provenance: 'master', visibility: 'master', sources: [] }],
  });
  const master = exportAtlas(root, { audience: 'master' });
  assert.equal(master.ok, true, JSON.stringify(master.problems));
  assert.equal(master.stats.places, 2);
  assert.ok(readHtml(root, 'master').includes('data-place="south"'));
  const players = exportAtlas(root, { audience: 'players' });
  assert.equal(players.ok, true, JSON.stringify(players.problems));
  const html = readHtml(root, 'players');
  assert.ok(!html.includes('data-place="south"'));
  assert.ok(!dataOf(html).places.some((p) => p.id === 'south'));
  assert.equal(players.stats.places, 1);
});

test('the players export omits the master block of a sheet, which stays in the sheet; the check passes', () => {
  const root = campaign();
  assert.ok(fs.readFileSync(path.join(root, 'World/North/North.md'), 'utf8').includes(SECRET));
  const result = exportAtlas(root, { audience: 'players' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.ok(result.checks.every((c) => c.status === 'pass'));
  assert.deepEqual(result.checks.map((c) => c.id), ['no-master-marker', 'no-reserved-text', 'no-master-features']);
  const html = readHtml(root, 'players');
  assert.ok(!html.includes(SECRET));
  assert.ok(html.includes('The northern town keeps the old market.'));
  assert.ok(fs.readFileSync(path.join(root, 'World/North/North.md'), 'utf8').includes(SECRET));
});

test('a failing check keeps the previous folder and writes no new one; the injected check replaces nothing', () => {
  const root = campaign();
  const first = exportAtlas(root, { audience: 'players' });
  assert.equal(first.ok, true);
  const before = readHtml(root, 'players');
  // The sheet changes, so a new build would differ from the old one.
  fs.writeFileSync(path.join(root, 'World/South.md'), sheet({ id: 'south', title: 'South', body: 'A changed village text.' }));
  const failing = exportAtlas(root, {
    audience: 'players',
    runChecks: () => [{ id: 'no-reserved-text', status: 'fail', message: 'injected leak' }],
  });
  assert.equal(failing.ok, false);
  assert.equal(failing.dir, null);
  assert.equal(failing.problems[0].code, 'no-reserved-text');
  assert.equal(readHtml(root, 'players'), before);
  assert.ok(!fs.existsSync(path.join(root, SITE, '.players-tmp')));
  // The next good build replaces it.
  assert.equal(exportAtlas(root, { audience: 'players' }).ok, true);
  assert.ok(readHtml(root, 'players').includes('A changed village text.'));
});

test('the inline page data escapes every < so no markup can end the data element', () => {
  const root = campaign({ northBody: 'Beware the </script> tag, a < b, and <!-- nothing -->.' });
  exportAtlas(root, { audience: 'master' });
  const html = readHtml(root, 'master');
  const match = /<script type="application\/json" id="atlas-data">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, 'the data element is there');
  assert.ok(!match[1].includes('<'));
  const data = JSON.parse(match[1]);
  assert.ok(data.places.find((p) => p.id === 'north').summary.includes('</script>'));
  assert.equal(html.split('<script type="application/json" id="atlas-data">').length, 2);
});

test('the players link points to the encyclopedia entry when the module is on, and is null when it is off', () => {
  const on = campaign({ yaml: ENCYCLOPEDIA_YAML });
  assert.equal(exportAtlas(on, { audience: 'players' }).ok, true);
  const places = dataOf(readHtml(on, 'players')).places;
  assert.deepEqual(places.find((p) => p.id === 'north').link, { kind: 'url', href: 'https://example.org/calvane/e/north/' });

  const off = campaign();
  assert.equal(exportAtlas(off, { audience: 'players' }).ok, true);
  assert.deepEqual(dataOf(readHtml(off, 'players')).places.find((p) => p.id === 'north').link, null);
});

test('the master link is the sheet path, and the default base URL is localhost when none is set', () => {
  const root = campaign();
  assert.equal(exportAtlas(root, { audience: 'master' }).ok, true);
  assert.deepEqual(dataOf(readHtml(root, 'master')).places.find((p) => p.id === 'north').link, {
    kind: 'document', path: 'World/North/North.md',
  });
  const onDefault = campaign({ yaml: `${campaignYaml()}modules:\n  encyclopedia: true\n` });
  assert.equal(exportAtlas(onDefault, { audience: 'players' }).ok, true);
  assert.equal(dataOf(readHtml(onDefault, 'players')).places.find((p) => p.id === 'north').link.href, 'http://localhost/e/north/');
});

test('two exports of the same atlas give the same index.html', () => {
  const root = campaign();
  exportAtlas(root, { audience: 'master' });
  const first = readHtml(root, 'master');
  exportAtlas(root, { audience: 'master' });
  assert.equal(readHtml(root, 'master'), first);
});

test('the page is in the campaign language, and an Italian campaign gets Italian strings', () => {
  const root = campaign({ yaml: `${campaignYaml()}language:\n  main: it\n` });
  assert.equal(exportAtlas(root, { audience: 'master' }).ok, true);
  const html = readHtml(root, 'master');
  assert.ok(html.startsWith('<!doctype html>\n<html lang="it">'));
  assert.equal(dataOf(html).strings.atlas, 'Atlante');
});

test('an atlas that does not validate is refused, and nothing is written', () => {
  const root = campaign({ places: [['north', [500, 500]], ['ghost', [600, 600]]] });
  const result = exportAtlas(root, { audience: 'master' });
  assert.equal(result.ok, false);
  assert.equal(result.dir, null);
  assert.ok(result.problems.some((p) => p.code === 'unknown-place'));
  assert.ok(!fs.existsSync(path.join(root, SITE)));
});

test('a realm names its place: the label comes from the place title, and players get none for a private sheet', () => {
  const root = campaign();
  const atlasDir = path.join(root, 'Atlas');
  const political = {
    layer: 'political',
    constraints: [],
    features: [{
      id: 'ash', type: 'realm', color: '#aa3322', seeds: [[300, 300]], polygon: [[200, 200], [800, 200], [800, 800], [200, 800]],
      place: 'north', provenance: 'master', visibility: 'public', sources: [],
    }],
  };
  fs.writeFileSync(path.join(atlasDir, 'political.json'), JSON.stringify(political));
  const manifest = JSON.parse(fs.readFileSync(path.join(atlasDir, 'atlas.json'), 'utf8'));
  manifest.layers = {};
  fs.writeFileSync(path.join(atlasDir, 'atlas.json'), JSON.stringify(manifest));
  const built = exportAtlas(root, { audience: 'master' });
  assert.equal(built.ok, true, JSON.stringify(built.problems));
  const master = readHtml(root, 'master');
  assert.ok(master.includes('>NORTH</textPath>'));
  assert.equal(exportAtlas(root, { audience: 'players' }).ok, true);
  assert.ok(readHtml(root, 'players').includes('>NORTH</textPath>'), 'North is public, so its name is shown');
});

test('summaryOf takes the first paragraph after the title, strips emphasis and links, and cuts at a word boundary', () => {
  assert.equal(summaryOf('# Title\n\n## Description\n\n*A **small** [town](https://x.y) by the sea.*\n\nMore.'), 'A small town by the sea.');
  assert.equal(summaryOf('# Title\n\n<!-- a hidden note -->\nVisible text.'), 'Visible text.');
  const long = `${'word '.repeat(120)}end`;
  const cut = summaryOf(`# T\n\n${long}`);
  assert.ok(Array.from(cut).length <= 400);
  assert.ok(cut.endsWith('…'));
  assert.ok(cut.slice(0, -1).endsWith('word'), 'the cut is at a word boundary');
});

test('the viewer data carries the vignette colour and opacity, the sea tile, and always lists the labels layer', () => {
  const root = campaign();
  const result = exportAtlas(root, { audience: 'master' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const html = readHtml(root, 'master');
  assert.ok(!html.includes('layer-vignette'), 'the vignette is drawn by the viewer, not in the SVG');
  const data = dataOf(html);
  assert.equal(typeof data.vignette.color, 'string');
  assert.equal(typeof data.vignette.opacity, 'number');
  assert.equal(data.seaTile, Math.max(data.canvas.width, data.canvas.height) / 9);
  assert.ok(data.layers.includes('labels'));
});

/**
 * An urban campaign (settlement scope): a ground layer with no water, buildings, and optional districts.
 * Each building entry is `[place id, point, kind]`; the north sheet has a master block, like the geographic one.
 */
function urbanCampaign({
  yaml,
  buildings = [['north', [500, 500], 'tavern'], ['south', [600, 600], 'house']],
  extraBuildings = [],
  districts = [],
} = {}) {
  const root = makeCampaign({
    'World/North/North.md': sheet({ id: 'north', title: 'North', body: 'The northern quarter keeps the old market.', master: `Secret: ${SECRET}.` }),
    'World/South.md': sheet({ id: 'south', title: 'South', body: 'A quiet row of houses.' }),
    'World/Keep.md': sheet({ id: 'keep', title: 'Keep', body: 'A keep of grey stone.' }),
  }, yaml ? { yaml } : {});
  const layers = { ground: groundLayer(), buildings: buildingsLayer(buildings) };
  layers.buildings.features.push(...extraBuildings);
  if (districts.length > 0) layers.districts = { layer: 'districts', constraints: [], features: districts };
  writeAtlas(root, { manifest: urbanManifest({ style: 'fantasy-color' }), layers });
  return root;
}

const district = (id, place, seed, polygon) => ({
  id, type: 'district', color: '#aa3322', seeds: [seed], polygon, place, provenance: 'master', visibility: 'public', sources: [],
});

test('an urban export lists its urban layers in drawing order, is marked urban, and has a card for each building', () => {
  const root = urbanCampaign();
  const result = exportAtlas(root, { audience: 'master' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const data = dataOf(readHtml(root, 'master'));
  assert.equal(data.scale, 'urban');
  assert.deepEqual(data.layers, ['ground', 'buildings', 'labels']);
  assert.deepEqual(data.places.map((p) => p.id), ['north', 'south']);
  assert.deepEqual(data.places.find((p) => p.id === 'north').at, [500, 500]);
  assert.deepEqual(data.places.find((p) => p.id === 'north').link, { kind: 'document', path: 'World/North/North.md' });
  assert.ok(readHtml(root, 'master').includes('data-place="north"'), 'the building is clickable by its place');
});

test('an urban players export has no master-visibility building, and its card and mark are gone', () => {
  const root = urbanCampaign({
    extraBuildings: [{ id: 'keep', place: 'keep', at: [900, 900], kind: 'keep', provenance: 'master', visibility: 'master', sources: [] }],
  });
  const master = exportAtlas(root, { audience: 'master' });
  assert.equal(master.ok, true, JSON.stringify(master.problems));
  assert.ok(readHtml(root, 'master').includes('data-place="keep"'));
  const players = exportAtlas(root, { audience: 'players' });
  assert.equal(players.ok, true, JSON.stringify(players.problems));
  assert.ok(players.checks.every((c) => c.status === 'pass'));
  const html = readHtml(root, 'players');
  assert.ok(!html.includes('data-place="keep"'));
  assert.ok(!dataOf(html).places.some((p) => p.id === 'keep'));
  assert.equal(dataOf(html).scale, 'urban');
  assert.ok(!html.includes(SECRET));
});

test('a district with a place gives a card: one card per place, the building wins its point, a district alone takes its seed', () => {
  const root = urbanCampaign({
    buildings: [['north', [500, 500], 'tavern']],
    districts: [
      district('old-town', 'north', [300, 300], [[200, 200], [800, 200], [800, 800], [200, 800]]),
      district('south-ward', 'south', [700, 700], [[600, 600], [900, 600], [900, 900], [600, 900]]),
    ],
  });
  const result = exportAtlas(root, { audience: 'master' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const data = dataOf(readHtml(root, 'master'));
  assert.deepEqual(data.layers, ['ground', 'buildings', 'districts', 'labels']);
  assert.deepEqual(data.places.map((p) => p.id), ['north', 'south']);
  assert.deepEqual(data.places.find((p) => p.id === 'north').at, [500, 500]);
  assert.deepEqual(data.places.find((p) => p.id === 'south').at, [700, 700]);
  assert.equal(result.stats.places, 2);
});

test('the urban layer names and the campaign language: an Italian urban atlas gets Italian layer names', () => {
  const root = urbanCampaign({ yaml: `${campaignYaml()}language:\n  main: it\n` });
  assert.equal(exportAtlas(root, { audience: 'master' }).ok, true);
  const data = dataOf(readHtml(root, 'master'));
  assert.equal(data.strings.layerNames.buildings, 'Edifici');
  assert.equal(data.strings.layerNames.ground, 'Terreno e acque');
  assert.equal(data.strings.layerNames.districts, 'Quartieri');
});

test('a geographic export is marked geo', () => {
  const root = campaign();
  assert.equal(exportAtlas(root, { audience: 'master' }).ok, true);
  assert.equal(dataOf(readHtml(root, 'master')).scale, 'geo');
});

test('an urban place record carries its building kind, or the kind district for a district, and its anchor', () => {
  const root = urbanCampaign({
    buildings: [['north', [500, 500], 'tavern']],
    districts: [district('south-ward', 'south', [700, 700], [[600, 600], [900, 600], [900, 900], [600, 900]])],
  });
  assert.equal(exportAtlas(root, { audience: 'master' }).ok, true);
  const places = dataOf(readHtml(root, 'master')).places;
  assert.deepEqual(places.find((p) => p.id === 'north'), {
    id: 'north',
    title: 'North',
    icon: null,
    at: [500, 500],
    summary: 'The northern quarter keeps the old market.',
    link: { kind: 'document', path: 'World/North/North.md' },
    kind: 'tavern',
  });
  const ward = places.find((p) => p.id === 'south');
  assert.equal(ward.kind, 'district');
  assert.deepEqual(ward.at, [700, 700], 'a district is anchored at its first seed');
  assert.equal(places.length, 2);
});

test('the card summary is the public part of the sheet: the master block of a building reaches no output of either build', () => {
  const root = urbanCampaign({ buildings: [['north', [500, 500], 'tavern']] });
  // The public part is empty: the master text sits right under the marker. A summary that did not stop at the
  // marker would take the secret as the first paragraph.
  fs.writeFileSync(path.join(root, 'World/North/North.md'), [
    '<!-- yllir', 'id: north', 'kind: place', 'provenance: master', '-->',
    '# North', '', '## Description', '', '<!-- master -->', `Secret: ${SECRET}.`, '',
  ].join('\n'));
  assert.ok(fs.readFileSync(path.join(root, 'World/North/North.md'), 'utf8').includes(SECRET));
  assert.equal(exportAtlas(root, { audience: 'master' }).ok, true);
  assert.equal(exportAtlas(root, { audience: 'players' }).ok, true);
  for (const audience of ['master', 'players']) {
    for (const file of listFiles(path.join(root, SITE, audience))) {
      const text = fs.readFileSync(path.join(root, SITE, audience, file), 'utf8');
      assert.ok(!text.includes(SECRET), `${audience}/${file} holds the master block`);
      assert.ok(!text.includes('Secret:'), `${audience}/${file} holds the master block`);
    }
  }
  const summary = dataOf(readHtml(root, 'master')).places.find((p) => p.id === 'north').summary;
  assert.equal(summary, '');
});

/**
 * An atlas with urban layers and, unless `withTerrain` is false, a terrain (land): the city of the north sheet
 * (a tavern on a block), and a place `south` in the places layer (no kind, it is not a building).
 * `extraBuildings` adds buildings; `biomes` is an optional biomes layer.
 */
function cityCampaign({ withTerrain = true, extraBuildings = [], biomes = null } = {}) {
  const root = makeCampaign({
    'World/North/North.md': sheet({ id: 'north', title: 'North', body: 'The northern quarter keeps the old market.', master: `Secret: ${SECRET}.` }),
    'World/South.md': sheet({ id: 'south', title: 'South', body: 'A quiet fishing village.' }),
    'World/Keep.md': sheet({ id: 'keep', title: 'Keep', body: 'A keep of grey stone.' }),
  });
  const buildings = buildingsLayer([['north', [500, 500], 'tavern']]);
  buildings.features.push(...extraBuildings);
  const layers = {
    ground: groundLayer(),
    blocks: blocksLayer([{
      id: 'block-1', type: 'block', polygon: square(400, 400, 600, 600), character: 'common', lots: [],
      provenance: 'agent-choice', visibility: 'public', sources: [],
    }]),
    buildings,
  };
  if (withTerrain) {
    layers.terrain = terrainLayer();
    layers.places = placesLayer([['south', [700, 700]]]);
  }
  if (biomes) layers.biomes = biomes;
  writeAtlas(root, { manifest: baseManifest({ style: 'fantasy-color' }), layers });
  return root;
}

test('a mixed atlas (terrain with a city) is scale mixed: terrain and blocks are drawn, the sea stays, the city has its cards', () => {
  const root = cityCampaign({
    extraBuildings: [{ id: 'keep', place: 'keep', at: [560, 560], kind: 'keep', provenance: 'master', visibility: 'master', sources: [] }],
  });
  const master = exportAtlas(root, { audience: 'master' });
  assert.equal(master.ok, true, JSON.stringify(master.problems));
  const html = readHtml(root, 'master');
  const data = dataOf(html);
  assert.equal(data.scale, 'mixed');
  assert.ok(html.includes('data-layer="terrain"'), 'the terrain group is drawn');
  assert.ok(html.includes('data-layer="blocks"'), 'the blocks group is drawn');
  assert.equal(typeof data.seaTexture, 'string', 'the sea is drawn');
  assert.deepEqual(data.layers, ['terrain', 'places', 'ground', 'blocks', 'buildings', 'labels']);
  const north = data.places.find((p) => p.id === 'north');
  assert.equal(north.kind, 'tavern');
  assert.equal(north.summary, 'The northern quarter keeps the old market.');
  assert.ok(html.includes('data-place="north"'));
  // A place of the places layer has no kind, so it is a card without a marker.
  assert.equal('kind' in data.places.find((p) => p.id === 'south'), false);

  const players = exportAtlas(root, { audience: 'players' });
  assert.equal(players.ok, true, JSON.stringify(players.problems));
  const playersHtml = readHtml(root, 'players');
  assert.equal(dataOf(playersHtml).scale, 'mixed');
  assert.ok(!playersHtml.includes('data-place="keep"'), 'a master-visibility building is not in the players build');
  assert.ok(!dataOf(playersHtml).places.some((p) => p.id === 'keep'));
  assert.ok(!playersHtml.includes(SECRET));
});

test('an urban atlas with a forest in biomes is mixed, not urban: the forest is drawn by the geographic renderer', () => {
  const forest = {
    layer: 'biomes',
    constraints: [],
    features: [{ id: 'wood', type: 'forest', polygon: [[100, 100], [300, 100], [300, 300], [100, 300]], provenance: 'master', visibility: 'public', sources: [] }],
  };
  const root = cityCampaign({ withTerrain: false, biomes: forest });
  const result = exportAtlas(root, { audience: 'master' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const html = readHtml(root, 'master');
  const data = dataOf(html);
  assert.equal(data.scale, 'mixed');
  assert.ok(html.includes('data-layer="biomes"'), 'the forest is drawn');
  assert.ok(html.includes('data-layer="blocks"'), 'the urban blocks are drawn too');
  assert.deepEqual(data.layers, ['biomes', 'ground', 'blocks', 'buildings', 'labels']);
  assert.equal(typeof data.seaTexture, 'string');
});

test('a purely urban atlas, with no geographic feature, is still scale urban: no sea, markers for its buildings', () => {
  const root = cityCampaign({ withTerrain: false });
  assert.equal(exportAtlas(root, { audience: 'master' }).ok, true);
  const data = dataOf(readHtml(root, 'master'));
  assert.equal(data.scale, 'urban');
  assert.equal(data.places.find((p) => p.id === 'north').kind, 'tavern');
});

test('the scale ignores the scope: a region scope with only urban features is urban, a settlement scope with terrain is mixed', () => {
  const setScope = (root, kind) => {
    const file = path.join(root, 'Atlas', 'atlas.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.scope.kind = kind;
    fs.writeFileSync(file, JSON.stringify(manifest));
  };
  const urbanOnly = cityCampaign({ withTerrain: false });
  setScope(urbanOnly, 'region');
  assert.equal(exportAtlas(urbanOnly, { audience: 'master' }).ok, true);
  assert.equal(dataOf(readHtml(urbanOnly, 'master')).scale, 'urban');

  const withTerrain = cityCampaign();
  setScope(withTerrain, 'settlement');
  assert.equal(exportAtlas(withTerrain, { audience: 'master' }).ok, true);
  assert.equal(dataOf(readHtml(withTerrain, 'master')).scale, 'mixed');
});

/**
 * Adds a bake to the campaign's manifest: a fake PNG under Atlas/bake/. `hash` overrides the layers hash
 * (a wrong one makes the bake stale); `withFile: false` leaves the file out.
 */
function addBake(root, { hash, withFile = true } = {}) {
  const dir = path.join(root, 'Atlas');
  const layers = readAtlas(root).layers;
  fs.mkdirSync(path.join(dir, 'bake'), { recursive: true });
  if (withFile) fs.writeFileSync(path.join(dir, 'bake', 'bake-1a2b3c4d.png'), encodePng(2, 2, new Uint8Array(12)));
  const manifestPath = path.join(dir, 'atlas.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.bake = { file: 'bake/bake-1a2b3c4d.png', layersHash: hash ?? layersHash(layers), width: 1000, height: 1000 };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return layers;
}

test('a current bake replaces the drawn map in both builds: the image is copied, the labels and targets stay', () => {
  const root = campaign();
  addBake(root);
  const master = exportAtlas(root, { audience: 'master' });
  assert.equal(master.ok, true, JSON.stringify(master.problems));
  assert.equal(master.stats.bake, 'current');
  const html = readHtml(root, 'master');
  assert.equal(dataOf(html).bake, true);
  assert.ok(html.includes('<image href="assets/bake.png"'));
  assert.ok(html.includes('data-layer="bake"'));
  assert.ok(!html.includes('id="layer-terrain"'), 'the drawn map is not in the page');
  assert.ok(html.includes('data-place="north"'), 'the place has its target');
  assert.ok(html.includes('>North<'), 'the label stays as text');
  const copied = fs.readFileSync(path.join(root, SITE, 'master', 'assets', 'bake.png'));
  assert.deepEqual(copied, fs.readFileSync(path.join(root, 'Atlas', 'bake', 'bake-1a2b3c4d.png')));

  const players = exportAtlas(root, { audience: 'players' });
  assert.equal(players.ok, true, JSON.stringify(players.problems));
  assert.equal(players.stats.bake, 'current');
  assert.equal(dataOf(readHtml(root, 'players')).bake, true);
  assert.ok(fs.existsSync(path.join(root, SITE, 'players', 'assets', 'bake.png')));
  assert.ok(!readHtml(root, 'players').includes(SECRET));
});

test('a stale bake falls back to the drawn map: no bake file, bake false, and the stats say stale', () => {
  const root = campaign();
  addBake(root, { hash: 'f'.repeat(64) });
  const result = exportAtlas(root, { audience: 'master' });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.stats.bake, 'stale');
  const html = readHtml(root, 'master');
  assert.equal(dataOf(html).bake, false);
  assert.ok(html.includes('id="layer-terrain"'), 'the map is drawn as usual');
  assert.ok(!html.includes('data-layer="bake"'));
  assert.ok(!fs.existsSync(path.join(root, SITE, 'master', 'assets', 'bake.png')));
});

test('a bake whose file is missing is not used, and no bake in the manifest gives none', () => {
  const root = campaign();
  addBake(root, { withFile: false });
  const missing = exportAtlas(root, { audience: 'master' });
  assert.equal(missing.ok, true, JSON.stringify(missing.problems));
  assert.equal(missing.stats.bake, 'none');
  assert.equal(dataOf(readHtml(root, 'master')).bake, false);
  const plain = campaign();
  const result = exportAtlas(plain, { audience: 'master' });
  assert.equal(result.stats.bake, 'none');
  assert.equal(dataOf(readHtml(plain, 'master')).bake, false);
});

test('the layers hash is the one of lib/bake.mjs: the labels and the places are left out, the terrain is not', () => {
  const root = campaign();
  const layers = readAtlas(root).layers;
  const base = layersHash(layers);
  assert.equal(layersHash({ ...layers, labels: { layer: 'labels', features: [{ target: 'places/north', text: 'X' }] } }), base);
  assert.equal(layersHash(layers), base, 'the same layers give the same hash');
  const moved = structuredClone(layers);
  moved.places.features[0].at = [501, 500];
  assert.equal(layersHash(moved), base, 'a place moved does not stale the bake');
  const reshaped = structuredClone(layers);
  reshaped.terrain.features[0].extra = 1;
  assert.notEqual(layersHash(reshaped), base, 'a terrain change stales the bake');
});
