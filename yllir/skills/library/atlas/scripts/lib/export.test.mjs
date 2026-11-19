import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exportAtlas, summaryOf } from './export.mjs';
import {
  cleanupCampaigns, makeCampaign, campaignYaml, baseManifest, terrainLayer, placesLayer, writeAtlas,
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
