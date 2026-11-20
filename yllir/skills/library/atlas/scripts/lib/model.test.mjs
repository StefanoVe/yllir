import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  atlasDir, readAtlas, validateAtlas, manifestProblems, LAYERS, GEO_LAYERS, URBAN_LAYERS, SCOPE_KINDS,
  isUrbanScope, layersForScope,
} from './model.mjs';
import { buildWorldIndex } from '../../../../../scripts/lib/world-graph.mjs';
import {
  cleanupCampaigns, standardCampaign, makeCampaign, campaignYaml, baseManifest, terrainLayer, landFeature,
  placesLayer, square, writeAtlas, readAtlasFile, urbanManifest, groundLayer, blocksLayer, buildingsLayer,
} from './test-support.mjs';

after(cleanupCampaigns);

const check = (root) => validateAtlas(root, readAtlas(root), { worldIndex: buildWorldIndex(root) });
const codes = (problems) => problems.map((p) => p.code);

function validRoot(options = {}) {
  const root = standardCampaign();
  writeAtlas(root, {
    layers: {
      terrain: terrainLayer(),
      places: placesLayer([['north', [500, 500]]]),
    },
    ...options,
  });
  return root;
}

test('atlasDir follows the atlas entry of campaign.yaml, and is null without one', () => {
  const root = standardCampaign();
  assert.equal(atlasDir(root), path.join(root, 'Atlas'));
  const bare = makeCampaign({}, { yaml: campaignYaml([{ id: 'luoghi', folder: 'World', type: 'places' }]) });
  assert.equal(atlasDir(bare), null);
  assert.deepEqual(check(bare).map((p) => p.code), ['no-atlas']);
});

test('a valid atlas has zero problems', () => {
  assert.deepEqual(check(validRoot()), []);
});

test('readAtlas reads only the layer files that exist, and reports bad JSON', () => {
  const root = validRoot();
  fs.writeFileSync(path.join(root, 'Atlas', 'water.json'), '{ not json');
  const atlas = readAtlas(root);
  assert.deepEqual(Object.keys(atlas.layers).sort(), ['places', 'terrain']);
  assert.deepEqual(codes(atlas.errors), ['bad-json']);
});

test('a duplicate feature id gives duplicate-id', () => {
  const root = validRoot({
    layers: { terrain: terrainLayer([landFeature('land-a', square(100, 100, 300, 300)), landFeature('land-a', square(400, 400, 600, 600))]) },
  });
  assert.ok(codes(check(root)).includes('duplicate-id'));
});

test('a point outside the canvas gives out-of-canvas', () => {
  const root = validRoot({
    layers: { terrain: terrainLayer([landFeature('land-a', [[100, 100], [1200, 100], [900, 900]])]) },
  });
  const problems = check(root);
  const found = problems.find((p) => p.code === 'out-of-canvas');
  assert.ok(found, 'out-of-canvas expected');
  assert.equal(found.file, 'Atlas/terrain.json');
  assert.equal(found.path, 'features[0].polygon[1]');
});

test('a place id that is not a place of the world gives unknown-place', () => {
  const root = validRoot({ layers: { terrain: terrainLayer(), places: placesLayer([['ghost', [500, 500]]]) } });
  assert.ok(codes(check(root)).includes('unknown-place'));
});

test('a place id that is a character sheet gives id-not-place', () => {
  const root = validRoot({ layers: { terrain: terrainLayer(), places: placesLayer([['mara', [500, 500]]]) } });
  assert.ok(codes(check(root)).includes('id-not-place'));
});

test('a place outside the land gives place-in-sea', () => {
  const root = validRoot({ layers: { terrain: terrainLayer(), places: placesLayer([['north', [50, 50]]]) } });
  assert.ok(codes(check(root)).includes('place-in-sea'));
});

test('a place inside a terrain lake or a water lake gives place-in-lake', () => {
  const lake = landFeature('lake-a', square(450, 450, 550, 550), { type: 'lake' });
  const terrainWithLake = terrainLayer([landFeature('land-main', square(100, 100, 900, 900)), lake]);
  assert.ok(codes(check(validRoot({ layers: { terrain: terrainWithLake, places: placesLayer([['north', [500, 500]]]) } })))
    .includes('place-in-lake'));

  const waterLake = {
    layer: 'water',
    constraints: [],
    features: [{ id: 'lake-w', type: 'lake', polygon: square(450, 450, 550, 550), provenance: 'master', visibility: 'public', sources: [] }],
  };
  assert.ok(codes(check(validRoot({ layers: { water: waterLake, terrain: terrainLayer(), places: placesLayer([['north', [500, 500]]]) } })))
    .includes('place-in-lake'));
});

test('cross-layer position checks are skipped when there is no land', () => {
  const sea = { layer: 'terrain', constraints: [], features: [] };
  const root = validRoot({ layers: { terrain: sea, places: placesLayer([['north', [50, 50]]]) } });
  assert.equal(codes(check(root)).includes('place-in-sea'), false);
});

test('document provenance with empty sources gives no-sources; a missing source file gives missing-source', () => {
  const noSources = landFeature('land-a', square(100, 100, 300, 300), { provenance: 'document', sources: [] });
  assert.ok(codes(check(validRoot({ layers: { terrain: terrainLayer([noSources]) } }))).includes('no-sources'));

  const missing = landFeature('land-a', square(100, 100, 300, 300), {
    provenance: 'document',
    sources: [{ file: 'World/Nowhere.md' }],
  });
  const problems = check(validRoot({ layers: { terrain: terrainLayer([missing]) } }));
  assert.ok(codes(problems).includes('missing-source'));
});

test('a document source that exists is accepted', () => {
  const sourced = landFeature('land-a', square(100, 100, 300, 300), {
    provenance: 'document',
    sources: [{ file: 'World/North/North.md', section: 'Description' }],
  });
  assert.deepEqual(check(validRoot({ layers: { terrain: terrainLayer([sourced]) } })), []);
});

test('a route that connects a place not in the places layer gives unknown-route-place', () => {
  const routes = {
    layer: 'routes',
    constraints: [],
    features: [{
      id: 'road-a', type: 'road', path: [[100, 100], [200, 200]], connects: ['ghost'],
      provenance: 'master', visibility: 'public', sources: [],
    }],
  };
  assert.ok(codes(check(validRoot({ layers: { terrain: terrainLayer(), places: placesLayer([['north', [500, 500]]]), routes } })))
    .includes('unknown-route-place'));
});

test('a label with a missing target gives unknown-label-target', () => {
  const labels = {
    layer: 'labels',
    constraints: [],
    features: [{ id: 'label-a', target: 'terrain/nothing', text: 'Far', provenance: 'master', visibility: 'public', sources: [] }],
  };
  assert.ok(codes(check(validRoot({ layers: { terrain: terrainLayer(), labels } }))).includes('unknown-label-target'));
});

test('manifest problems are reported with stable codes', () => {
  const root = validRoot({ manifest: baseManifest({ scope: { kind: 'planet', places: [] }, canvas: { width: 50, height: 1000 } }) });
  const problems = check(root);
  assert.ok(problems.some((p) => p.code === 'bad-manifest' && p.path === 'scope.kind'));
  assert.ok(problems.some((p) => p.code === 'bad-manifest' && p.path === 'canvas.width'));
});

test('manifestProblems accepts a locked layer with a snapshot and rejects a bad digest', () => {
  const good = baseManifest({
    layers: { terrain: { locked: true, snapshot: { constraints: ['a'.repeat(64)], features: {} } } },
  });
  assert.deepEqual(manifestProblems(good), []);
  const bad = baseManifest({ layers: { terrain: { locked: true, snapshot: { constraints: 'nope', features: {} } } } });
  assert.deepEqual(codes(manifestProblems(bad)), ['bad-manifest']);
  const badList = baseManifest({ layers: { terrain: { locked: true, snapshot: { constraints: ['nope'], features: {} } } } });
  assert.deepEqual(codes(manifestProblems(badList)), ['bad-manifest']);
});

test('terrain constraints: unknown kind gives bad-constraint; a region on an unknown place gives unknown-place', () => {
  const root = validRoot({
    layers: {
      terrain: { ...terrainLayer(), constraints: [{ kind: 'volcano', provenance: 'master', sources: [] }] },
      places: placesLayer([['north', [500, 500]]]),
    },
  });
  assert.ok(codes(check(root)).includes('bad-constraint'));

  const unknown = validRoot({
    layers: {
      terrain: { ...terrainLayer(), constraints: [{ kind: 'region', place: 'ghost', at: [500, 500], radius: 50, provenance: 'master', sources: [] }] },
    },
  });
  assert.ok(codes(check(unknown)).includes('unknown-place'));
});

test('terrain constraints: sources may be empty whatever the provenance, but a source file must exist', () => {
  const documentEmpty = { kind: 'sea', at: [900, 900], radius: 10, provenance: 'document', sources: [] };
  assert.deepEqual(check(validRoot({ layers: { terrain: { ...terrainLayer(), constraints: [documentEmpty] } } })), []);

  const missing = { kind: 'sea', at: [900, 900], radius: 10, provenance: 'master', sources: [{ file: 'World/Nowhere.md' }] };
  assert.ok(codes(check(validRoot({ layers: { terrain: { ...terrainLayer(), constraints: [missing] } } }))).includes('missing-source'));
});

test('a missing atlas.json is a bad-manifest problem', () => {
  const root = standardCampaign();
  fs.mkdirSync(path.join(root, 'Atlas'), { recursive: true });
  assert.deepEqual(check(root).map((p) => [p.code, p.file]), [['bad-manifest', 'Atlas/atlas.json']]);
});

test('problems are sorted by file then path, and files are campaign-relative', () => {
  const root = validRoot({
    layers: {
      terrain: terrainLayer([landFeature('land-a', [[100, 100], [1200, 100], [900, 900]])]),
      places: placesLayer([['ghost', [500, 500]]]),
    },
  });
  const problems = check(root);
  const files = problems.map((p) => p.file);
  assert.deepEqual(files, [...files].sort());
  assert.ok(problems.every((p) => p.file.startsWith('Atlas/')));
  assert.equal(readAtlasFile(root, 'places.json').includes('ghost'), true);
});

test('a sea constraint with roughness 2 gives bad-constraint; roughness 0.5 is accepted', () => {
  const bad = { kind: 'sea', at: [900, 900], radius: 10, roughness: 2, provenance: 'master', sources: [] };
  const badRoot = validRoot({ layers: { terrain: { ...terrainLayer(), constraints: [bad] } } });
  assert.ok(codes(check(badRoot)).includes('bad-constraint'));

  const good = { kind: 'sea', at: [900, 900], radius: 10, roughness: 0.5, provenance: 'master', sources: [] };
  assert.deepEqual(check(validRoot({ layers: { terrain: { ...terrainLayer(), constraints: [good] } } })), []);
});

test('each layer takes only its own constraint kinds; places and labels take none', () => {
  const range = { kind: 'range', id: 'peaks', type: 'mountains', spine: [[100, 100], [300, 100]], width: 40, provenance: 'master', sources: [] };
  const good = validRoot({ layers: { terrain: terrainLayer(), relief: { layer: 'relief', constraints: [range], features: [] } } });
  assert.deepEqual(check(good), []);

  const wrongLayer = validRoot({ layers: { terrain: { ...terrainLayer(), constraints: [range] } } });
  assert.ok(codes(check(wrongLayer)).includes('bad-constraint'));

  const placesWithConstraint = validRoot({
    layers: { places: { ...placesLayer([['north', [500, 500]]]), constraints: [range] } },
  });
  assert.ok(check(placesWithConstraint).some((p) => p.code === 'bad-constraint' && p.file === 'Atlas/places.json'));
});

test('new layer constraints are checked field by field and need unique kebab ids', () => {
  const badRiver = { kind: 'river', id: 'Silver River', source: [100, 100], mouth: [200, 200], meander: 3, provenance: 'master', sources: [] };
  const badRoot = validRoot({ layers: { water: { layer: 'water', constraints: [badRiver], features: [] } } });
  assert.ok(check(badRoot).some((p) => p.code === 'bad-constraint' && p.path === 'constraints[0].id'));
  assert.ok(check(badRoot).some((p) => p.code === 'bad-constraint' && p.path === 'constraints[0].meander'));

  const river = { kind: 'river', id: 'silver', source: [100, 100], mouth: [200, 200], provenance: 'master', sources: [] };
  const dupRoot = validRoot({ layers: { water: { layer: 'water', constraints: [river, { ...river }], features: [] } } });
  assert.ok(codes(check(dupRoot)).includes('duplicate-id'));
});

test('a realm constraint needs a colour and at least one seed; a route constraint needs from and to', () => {
  const realm = { kind: 'realm', id: 'north', color: 'red', seeds: [], provenance: 'master', sources: [] };
  const route = { kind: 'road', id: 'road-ab', from: 'a', provenance: 'master', sources: [] };
  const root = validRoot({
    layers: {
      political: { layer: 'political', constraints: [realm], features: [] },
      routes: { layer: 'routes', constraints: [route], features: [] },
    },
  });
  const problems = check(root);
  assert.ok(problems.some((p) => p.file === 'Atlas/political.json' && p.code === 'bad-constraint' && p.path === 'constraints[0].color'));
  assert.ok(problems.some((p) => p.file === 'Atlas/routes.json' && p.code === 'bad-constraint' && p.path === 'constraints[0].to'));
});

test('political features accept polygons (a list) as well as the legacy polygon', () => {
  const realmLayer = (feature) => ({ layer: 'political', constraints: [], features: [feature] });
  const modern = {
    id: 'north', type: 'realm', color: '#aa3322', seeds: [[500, 500]],
    polygons: [square(100, 100, 300, 300), square(400, 400, 600, 600)],
    provenance: 'agent-choice', visibility: 'public', sources: [],
  };
  assert.deepEqual(check(validRoot({ layers: { political: realmLayer(modern) } })), []);

  const broken = { ...modern, polygons: [[[0, 0], [1, 1]]] };
  assert.ok(codes(check(validRoot({ layers: { political: realmLayer(broken) } }))).includes('bad-feature'));
});

test('a port far from the water gives port-not-coast; a port near the coast passes', () => {
  const inland = placesLayer([['north', [500, 500]]]);
  inland.features[0].icon = 'port';
  assert.ok(codes(check(validRoot({ layers: { terrain: terrainLayer(), places: inland } }))).includes('port-not-coast'));

  const coastal = placesLayer([['north', [500, 500]]]);
  coastal.features[0].icon = 'port';
  coastal.features[0].at = [201, 500];
  const root = validRoot({ layers: { terrain: terrainLayer([landFeature('land-main', square(200, 100, 900, 900))]), places: coastal } });
  assert.equal(codes(check(root)).includes('port-not-coast'), false);
});

test('a realm names a place of the world: an unknown id is unknown-place, a character is id-not-place', () => {
  const realmWith = (extra) => validRoot({
    layers: {
      political: {
        layer: 'political',
        constraints: [{ kind: 'realm', id: 'ash', color: '#aa3322', seeds: [[500, 500]], provenance: 'master', sources: [], ...extra }],
        features: [],
      },
    },
  });
  assert.deepEqual(check(realmWith({ name: 'Ashmark', place: 'north' })), []);
  assert.ok(codes(check(realmWith({ place: 'nowhere' }))).includes('unknown-place'));
  assert.ok(codes(check(realmWith({ place: 'mara' }))).includes('id-not-place'));
  assert.ok(codes(check(realmWith({ name: '' }))).includes('bad-constraint'));
  assert.ok(codes(check(realmWith({ place: 7 }))).includes('bad-constraint'));
});

test('a realm feature takes the same name and place; a bad name on a feature is bad-feature', () => {
  const feature = (extra) => ({
    id: 'ash', type: 'realm', color: '#aa3322', seeds: [[500, 500]], polygon: square(300, 300, 700, 700),
    provenance: 'master', visibility: 'public', sources: [], ...extra,
  });
  const layerWith = (f) => validRoot({ layers: { political: { layer: 'political', constraints: [], features: [f] } } });
  assert.deepEqual(check(layerWith(feature({ name: 'Ashmark', place: 'north' }))), []);
  assert.ok(codes(check(layerWith(feature({ name: 3 })))).includes('bad-feature'));
  assert.ok(codes(check(layerWith(feature({ place: 'nowhere' })))).includes('unknown-place'));
});

test('a forest biome may carry a variant of conifer or broadleaf; other variants are refused', () => {
  const biome = (extra) => ({
    id: 'wood', type: 'forest', polygon: square(300, 300, 500, 500), provenance: 'master', visibility: 'public', sources: [], ...extra,
  });
  const layerWith = (f) => validRoot({ layers: { biomes: { layer: 'biomes', constraints: [], features: [f] } } });
  assert.deepEqual(check(layerWith(biome({ variant: 'conifer' }))), []);
  assert.deepEqual(check(layerWith(biome({ variant: 'broadleaf' }))), []);
  assert.ok(codes(check(layerWith(biome({ variant: 'palm' })))).includes('bad-feature'));
  assert.ok(codes(check(layerWith(biome({ type: 'swamp', variant: 'conifer' })))).includes('bad-feature'));
});

// Urban scale (settlement, district): layers, constraints, features, building checks, and mixed atlases.

const urbanRoot = (layers = {}, manifest = urbanManifest()) => {
  const root = standardCampaign();
  writeAtlas(root, { manifest, layers });
  return root;
};
const layer = (name, { constraints = [], features = [] } = {}) => ({ layer: name, constraints, features });
const master = { provenance: 'master', sources: [] };
const shown = { provenance: 'master', visibility: 'public', sources: [] };
/** The problems of an urban atlas with these layers, as `code path` (no file: the path is enough here). */
const problemsOf = (layers) => check(urbanRoot(layers)).map((p) => `${p.code} ${p.path}`);

test('layer lists: every layer once, labels last, geographic order kept, urban layers in drawing order', () => {
  assert.equal(new Set(LAYERS).size, LAYERS.length);
  assert.equal(LAYERS.filter((name) => name === 'labels').length, 1);
  assert.equal(LAYERS.at(-1), 'labels');
  assert.deepEqual(GEO_LAYERS, ['terrain', 'relief', 'water', 'biomes', 'political', 'places', 'routes', 'labels']);
  assert.deepEqual(URBAN_LAYERS, ['ground', 'green', 'walls', 'streets', 'blocks', 'buildings', 'districts', 'labels']);
  assert.deepEqual(LAYERS.filter((name) => GEO_LAYERS.includes(name)), GEO_LAYERS);
  assert.deepEqual(LAYERS.filter((name) => URBAN_LAYERS.includes(name)), URBAN_LAYERS);
  assert.equal(LAYERS.length, 15);
});

test('settlement and district are urban scopes; the other scope kinds are geographic', () => {
  assert.deepEqual(SCOPE_KINDS, ['world', 'continent', 'region', 'settlement', 'district']);
  assert.equal(isUrbanScope('settlement'), true);
  assert.equal(isUrbanScope('district'), true);
  assert.equal(isUrbanScope('region'), false);
  assert.equal(isUrbanScope('world'), false);
  assert.deepEqual(layersForScope('district'), LAYERS);
  assert.deepEqual(layersForScope('continent'), LAYERS);
});

test('scope.unit is optional; m and paces are accepted, anything else is bad-manifest', () => {
  assert.deepEqual(manifestProblems(urbanManifest({ scope: { kind: 'settlement', places: [], unit: 'paces' } })), []);
  assert.deepEqual(manifestProblems(urbanManifest({ scope: { kind: 'settlement', places: [], unit: 'm' } })), []);
  const bad = manifestProblems(urbanManifest({ scope: { kind: 'settlement', places: [], unit: 'feet' } }));
  assert.ok(bad.some((p) => p.code === 'bad-manifest' && p.path === 'scope.unit'));
});

test('every layer is allowed in every scope kind: a city inside a region and hills around a city both validate', () => {
  assert.deepEqual(check(urbanRoot({ terrain: terrainLayer(), biomes: layer('biomes'), ground: groundLayer() })), []);
  assert.deepEqual(check(validRoot({ layers: { terrain: terrainLayer(), ground: groundLayer(), streets: layer('streets') } })), []);
  assert.equal(check(validRoot({ layers: { terrain: terrainLayer(), ground: groundLayer() } })).some((p) => p.code === 'wrong-scale-layer'), false);
});

test('labels is shared: an urban atlas and a geographic one may both have labels', () => {
  const labels = layer('labels');
  assert.deepEqual(check(urbanRoot({ labels })), []);
  assert.deepEqual(check(validRoot({ layers: { labels } })), []);
});

test('a mixed atlas (terrain land, a river on ground, buildings) validates; a tavern in the river is caught by the urban check', () => {
  const river = { id: 'river-main', type: 'water', kind: 'river', polygon: square(1000, 380, 1100, 420), ...shown };
  const mixed = (at) => ({
    terrain: terrainLayer(),
    ground: layer('ground', { features: [river] }),
    buildings: buildingsLayer([['north', at, 'tavern']]),
  });
  assert.deepEqual(problemsOf(mixed([500, 500])), []);
  assert.deepEqual(problemsOf(mixed([1050, 400])), ['building-in-water features[0].at']);
});

test('a complete urban atlas has zero problems', () => {
  const root = urbanRoot({
    ground: layer('ground', {
      constraints: [{ kind: 'pond', id: 'mill-pond', at: [1200, 400], radius: 60, ...master }],
      features: [{ id: 'mill-pond', type: 'water', kind: 'pond', polygon: square(1140, 340, 1260, 460), ...shown }],
    }),
    streets: layer('streets', {
      constraints: [{ kind: 'street', id: 'high-street', rank: 'main', path: [[0, 900], [2400, 900]], ...master }],
      features: [
        { id: 'high-street', type: 'street', rank: 'main', width: 14, path: [[0, 900], [2400, 900]], ...shown },
        { id: 'market-square', type: 'square', polygon: square(300, 300, 400, 400), ...shown },
      ],
    }),
    blocks: layer('blocks', {
      constraints: [{ kind: 'fill', id: 'old-town', character: 'poor', ...master }],
      features: [{
        id: 'block-1', type: 'block', polygon: square(200, 200, 800, 800), character: 'common',
        lots: [{ kind: 'house', at: [250, 250], size: [10, 8], angle: 0 }], ...shown,
      }],
    }),
    buildings: buildingsLayer([['north', [500, 500], 'tavern']]),
    districts: layer('districts', {
      features: [{
        id: 'docks', type: 'district', color: '#3366aa', seeds: [[400, 1200]], name: 'The Docks',
        polygon: square(300, 1000, 900, 1500), character: 'poor', ...shown,
      }],
    }),
    labels: layer('labels', {
      features: [{ id: 'label-market', target: 'streets/market-square', text: 'Market', ...shown }],
    }),
  });
  assert.deepEqual(check(root), []);
});

test('ground constraints: each kind is checked field by field', () => {
  const river = { kind: 'river', id: 'silver', source: [0, 900], mouth: [2400, 900], width: 30, ...master };
  const coast = { kind: 'coast', id: 'harbour', side: 'south', depth: 300, roughness: 0.4, ...master };
  const pond = { kind: 'pond', id: 'mill-pond', at: [1200, 400], radius: 60, ...master };
  const canal = { kind: 'canal', id: 'east-cut', path: [[1800, 0], [1800, 1800]], width: 12, ...master };
  assert.deepEqual(problemsOf({ ground: layer('ground', { constraints: [river, coast, pond, canal] }) }), []);

  const ground = (constraint) => problemsOf({ ground: layer('ground', { constraints: [constraint] }) });
  assert.deepEqual(ground({ ...river, width: 0 }), ['bad-constraint constraints[0].width']);
  assert.deepEqual(ground({ ...river, meander: 2 }), ['bad-constraint constraints[0].meander']);
  assert.deepEqual(ground({ ...coast, side: 'up' }), ['bad-constraint constraints[0].side']);
  assert.deepEqual(ground({ ...coast, depth: 0 }), ['bad-constraint constraints[0].depth']);
  assert.deepEqual(ground({ ...pond, radius: -1 }), ['bad-constraint constraints[0].radius']);
  assert.deepEqual(ground({ ...pond, roughness: 3 }), ['bad-constraint constraints[0].roughness']);
  assert.deepEqual(ground({ ...canal, path: [[1800, 0]] }), ['bad-constraint constraints[0].path']);
  assert.deepEqual(ground({ ...canal, id: 'East Cut' }), ['bad-constraint constraints[0].id']);
  assert.deepEqual(ground({ ...canal, visibility: 'secret' }), ['bad-constraint constraints[0].visibility']);
  assert.deepEqual(ground({ ...canal, kind: 'lake' }), ['bad-constraint constraints[0].kind']);
});

test('ground features: water polygons need a type of water and at least three points', () => {
  const pond = (extra) => ({ id: 'mill-pond', type: 'water', kind: 'pond', polygon: square(1140, 340, 1260, 460), ...shown, ...extra });
  assert.deepEqual(problemsOf({ ground: layer('ground', { features: [pond({})] }) }), []);
  assert.deepEqual(problemsOf({ ground: layer('ground', { features: [pond({ type: 'wetland' })] }) }), ['bad-feature features[0].type']);
  assert.deepEqual(
    problemsOf({ ground: layer('ground', { features: [pond({ polygon: [[0, 0], [10, 10]] })] }) }),
    ['bad-feature features[0].polygon'],
  );
});

test('an island is a ground constraint with a point and a radius pair; its land feature is a polygon', () => {
  const island = { kind: 'island', id: 'home-isle', at: [1200, 900], radius: [900, 600], roughness: 0.3, ...master };
  assert.deepEqual(problemsOf({ ground: layer('ground', { constraints: [island] }) }), []);
  const ground = (extra) => problemsOf({ ground: layer('ground', { constraints: [{ ...island, ...extra }] }) });
  assert.deepEqual(ground({ at: [1200] }), ['bad-constraint constraints[0].at']);
  assert.deepEqual(ground({ radius: 900 }), ['bad-constraint constraints[0].radius']);
  assert.deepEqual(ground({ radius: [900, 0] }), ['bad-constraint constraints[0].radius']);
  assert.deepEqual(ground({ roughness: 1.5 }), ['bad-constraint constraints[0].roughness']);
  assert.deepEqual(ground({ id: 'Home Isle' }), ['bad-constraint constraints[0].id']);

  const land = (extra) => ({ id: 'home-isle', type: 'land', kind: 'island', polygon: square(300, 300, 2100, 1500), ...shown, ...extra });
  assert.deepEqual(problemsOf({ ground: layer('ground', { features: [land({})] }) }), []);
  assert.deepEqual(
    problemsOf({ ground: layer('ground', { features: [land({ polygon: [[0, 0], [10, 10]] })] }) }),
    ['bad-feature features[0].polygon'],
  );
});

test('green constraints need a park type, a point and a radius; green features need a green type and a polygon', () => {
  const park = { kind: 'park', id: 'green-park', type: 'garden', at: [600, 600], radius: 150, ...master };
  assert.deepEqual(problemsOf({ green: layer('green', { constraints: [park] }) }), []);
  const green = (constraint) => problemsOf({ green: layer('green', { constraints: [constraint] }) });
  assert.deepEqual(green({ ...park, type: 'forest' }), ['bad-constraint constraints[0].type']);
  assert.deepEqual(green({ ...park, radius: 0 }), ['bad-constraint constraints[0].radius']);
  assert.deepEqual(green({ ...park, at: [600] }), ['bad-constraint constraints[0].at']);

  const feature = (extra) => ({ id: 'green-park', type: 'garden', polygon: square(450, 450, 750, 750), ...shown, ...extra });
  assert.deepEqual(problemsOf({ green: layer('green', { features: [feature({})] }) }), []);
  assert.deepEqual(problemsOf({ green: layer('green', { features: [feature({ type: 'lake' })] }) }), ['bad-feature features[0].type']);
  assert.deepEqual(
    problemsOf({ green: layer('green', { features: [feature({ polygon: [[0, 0]] })] }) }),
    ['bad-feature features[0].polygon'],
  );
});

test('walls constraints: exactly one of ring or path, a thickness, towers and gates are checked', () => {
  const wall = {
    kind: 'wall', id: 'town-wall', ring: [[300, 300], [2100, 300], [2100, 1500], [300, 1500]],
    thickness: 8, towers: 'corners', gates: [{ at: [1200, 300], width: 20 }], ...master,
  };
  assert.deepEqual(problemsOf({ walls: layer('walls', { constraints: [wall] }) }), []);
  const walls = (constraint) => problemsOf({ walls: layer('walls', { constraints: [constraint] }) });
  assert.deepEqual(walls({ ...wall, path: [[300, 300], [900, 300]] }), ['bad-constraint constraints[0].ring']);
  const neither = { ...wall };
  delete neither.ring;
  assert.deepEqual(walls(neither), ['bad-constraint constraints[0].ring']);
  assert.deepEqual(walls({ ...wall, ring: [[300, 300], [900, 300]] }), ['bad-constraint constraints[0].ring']);
  assert.deepEqual(walls({ ...wall, thickness: 0 }), ['bad-constraint constraints[0].thickness']);
  assert.deepEqual(walls({ ...wall, towers: 'dense' }), ['bad-constraint constraints[0].towers']);
  assert.deepEqual(walls({ ...wall, towerSpacing: -5 }), ['bad-constraint constraints[0].towerSpacing']);
  assert.deepEqual(walls({ ...wall, gates: [{ at: [1200, 300], width: 0 }] }), ['bad-constraint constraints[0].gates[0].width']);
  assert.deepEqual(walls({ ...wall, gates: [{ width: 20 }] }), ['bad-constraint constraints[0].gates[0].at']);
});

test('walls features: a wall line, a tower and a gate each have their own fields', () => {
  const line = { id: 'town-wall', type: 'wall', path: [[300, 300], [2100, 300]], closed: false, thickness: 8, ...shown };
  const tower = { id: 'town-wall-tower-1', type: 'tower', at: [300, 300], radius: 12, ...shown };
  const gate = { id: 'town-wall-gate-1', type: 'gate', at: [1200, 300], angle: 0, width: 20, ...shown };
  assert.deepEqual(problemsOf({ walls: layer('walls', { features: [line, tower, gate] }) }), []);
  const walls = (feature) => problemsOf({ walls: layer('walls', { features: [feature] }) });
  assert.deepEqual(walls({ ...line, path: [[300, 300]] }), ['bad-feature features[0].path']);
  assert.deepEqual(walls({ ...line, closed: 'yes' }), ['bad-feature features[0].closed']);
  assert.deepEqual(walls({ ...line, thickness: undefined }), ['bad-feature features[0].thickness']);
  assert.deepEqual(walls({ ...tower, radius: undefined }), ['bad-feature features[0].radius']);
  assert.deepEqual(walls({ ...gate, angle: undefined }), ['bad-feature features[0].angle']);
  assert.deepEqual(walls({ ...gate, width: 0 }), ['bad-feature features[0].width']);
  assert.deepEqual(walls({ ...gate, type: 'moat' }), ['bad-feature features[0].type']);
});

test('streets constraints: rank, square size, grid spacing, jitter and rank are checked', () => {
  const street = { kind: 'street', id: 'high-street', rank: 'main', path: [[0, 900], [2400, 900]], ...master };
  const square_ = { kind: 'square', id: 'market-square', at: [1200, 900], size: [120, 90], angle: 0, ...master };
  const grid = { kind: 'grid', id: 'north-grid', area: square(300, 300, 900, 900), spacing: 60, jitter: 0.2, rank: 'lane', ...master };
  assert.deepEqual(problemsOf({ streets: layer('streets', { constraints: [street, square_, grid] }) }), []);
  const streets = (constraint) => problemsOf({ streets: layer('streets', { constraints: [constraint] }) });
  assert.deepEqual(streets({ ...street, rank: 'avenue' }), ['bad-constraint constraints[0].rank']);
  assert.deepEqual(streets({ ...street, path: [[0, 900]] }), ['bad-constraint constraints[0].path']);
  assert.deepEqual(streets({ ...square_, size: [0, 90] }), ['bad-constraint constraints[0].size']);
  assert.deepEqual(streets({ ...square_, angle: 'north' }), ['bad-constraint constraints[0].angle']);
  assert.deepEqual(streets({ ...grid, spacing: 0 }), ['bad-constraint constraints[0].spacing']);
  assert.deepEqual(streets({ ...grid, jitter: 2 }), ['bad-constraint constraints[0].jitter']);
  assert.deepEqual(streets({ ...grid, rank: 'main' }), ['bad-constraint constraints[0].rank']);
  assert.deepEqual(streets({ ...grid, area: [[0, 0], [1, 1]] }), ['bad-constraint constraints[0].area']);
});

test('streets features: a street, a square polygon and a two-point bridge', () => {
  const street = { id: 'high-street', type: 'street', rank: 'main', width: 14, path: [[0, 900], [2400, 900]], ...shown };
  const square_ = { id: 'market-square', type: 'square', polygon: square(1100, 800, 1300, 1000), ...shown };
  const bridge = { id: 'bridge-high-street-1', type: 'bridge', path: [[1150, 900], [1250, 900]], width: 14, ...shown };
  assert.deepEqual(problemsOf({ streets: layer('streets', { features: [street, square_, bridge] }) }), []);
  const streets = (feature) => problemsOf({ streets: layer('streets', { features: [feature] }) });
  assert.deepEqual(streets({ ...street, rank: 'alley' }), ['bad-feature features[0].rank']);
  assert.deepEqual(streets({ ...street, width: 0 }), ['bad-feature features[0].width']);
  assert.deepEqual(streets({ ...square_, polygon: [[0, 0], [1, 1]] }), ['bad-feature features[0].polygon']);
  assert.deepEqual(
    streets({ ...bridge, path: [[1150, 900], [1200, 900], [1250, 900]] }),
    ['bad-feature features[0].path'],
  );
  assert.deepEqual(streets({ ...bridge, width: undefined }), ['bad-feature features[0].width']);
  assert.deepEqual(streets({ ...bridge, type: 'road' }), ['bad-feature features[0].type']);
});

test('blocks constraint: a fill with a known character and an optional area', () => {
  const fill = { kind: 'fill', id: 'old-town', character: 'poor', area: square(200, 200, 800, 800), district: 'docks', ...master };
  assert.deepEqual(problemsOf({ blocks: layer('blocks', { constraints: [fill] }) }), []);
  assert.deepEqual(problemsOf({ blocks: layer('blocks', { constraints: [{ ...fill, character: 'royal' }] }) }),
    ['bad-constraint constraints[0].character']);
  assert.deepEqual(problemsOf({ blocks: layer('blocks', { constraints: [{ ...fill, district: 'Old Docks' }] }) }),
    ['bad-constraint constraints[0].district']);
});

test('blocks features: a block needs a character, a polygon and a list of lots with kind, point, size and angle', () => {
  const lots = [
    { kind: 'house', at: [250, 250], size: [10, 8], angle: 0 },
    { kind: 'barn', at: [700, 700], size: [20, 12], angle: 1.5707 },
  ];
  const block = (extra) => ({ id: 'block-1', type: 'block', polygon: square(200, 200, 800, 800), character: 'common', lots, ...shown, ...extra });
  assert.deepEqual(problemsOf({ blocks: blocksLayer([block({})]) }), []);
  const blocks = (extra) => problemsOf({ blocks: blocksLayer([block(extra)]) });
  assert.deepEqual(blocks({ character: undefined }), ['bad-feature features[0].character']);
  assert.deepEqual(blocks({ polygon: [[0, 0], [1, 1]] }), ['bad-feature features[0].polygon']);
  assert.deepEqual(blocks({ lots: undefined }), ['bad-feature features[0].lots']);
  assert.deepEqual(blocks({ lots: [{ ...lots[0], kind: 'castle' }] }), ['bad-feature features[0].lots[0].kind']);
  assert.deepEqual(blocks({ lots: [{ ...lots[0], size: [0, 3] }] }), ['bad-feature features[0].lots[0].size']);
  assert.deepEqual(blocks({ lots: [{ ...lots[0], angle: undefined }] }), ['bad-feature features[0].lots[0].angle']);
  assert.deepEqual(blocks({ lots: [{ ...lots[0], at: [2500, 10] }] }), ['out-of-canvas features[0].lots[0].at']);
});

test('buildings: no constraints; the id equals the place, the place is a place sheet, the kind is known', () => {
  assert.deepEqual(problemsOf({ buildings: buildingsLayer([['north', [500, 500], 'tavern']]) }), []);
  const withConstraint = {
    layer: 'buildings', constraints: [{ kind: 'fill', id: 'x', ...master }], features: [],
  };
  assert.deepEqual(problemsOf({ buildings: withConstraint }), ['bad-constraint constraints[0].kind']);

  const mismatch = buildingsLayer([['north', [500, 500], 'tavern']]);
  mismatch.features[0].id = 'port-ash';
  assert.deepEqual(problemsOf({ buildings: mismatch }), ['bad-feature features[0].id']);
  assert.deepEqual(problemsOf({ buildings: buildingsLayer([['north', [500, 500], 'dragon']]) }),
    ['bad-feature features[0].kind']);
  assert.deepEqual(problemsOf({ buildings: buildingsLayer([['ghost', [500, 500], 'house']]) }),
    ['unknown-place features[0].place']);
  assert.deepEqual(problemsOf({ buildings: buildingsLayer([['mara', [500, 500], 'house']]) }),
    ['id-not-place features[0].place']);
  const sized = buildingsLayer([['north', [500, 500], 'tavern']]);
  sized.features[0].size = [0, 4];
  assert.deepEqual(problemsOf({ buildings: sized }), ['bad-feature features[0].size']);
});

test('buildings: a building in water gives building-in-water; off every block or square, building-not-on-block', () => {
  const pond = layer('ground', {
    features: [{ id: 'mill-pond', type: 'water', kind: 'pond', polygon: square(400, 400, 600, 600), ...shown }],
  });
  const blocks = blocksLayer([{ id: 'block-1', type: 'block', polygon: square(200, 200, 800, 800), character: 'common', lots: [], ...shown }]);
  const inWater = check(urbanRoot({ ground: pond, blocks, buildings: buildingsLayer([['north', [500, 500], 'tavern']]) }));
  assert.ok(inWater.some((p) => p.code === 'building-in-water' && p.file === 'Atlas/buildings.json' && p.path === 'features[0].at'));
  assert.equal(inWater.some((p) => p.code === 'building-not-on-block'), false);

  const off = check(urbanRoot({ blocks, buildings: buildingsLayer([['north', [50, 50], 'house']]) }));
  assert.ok(off.some((p) => p.code === 'building-not-on-block' && p.path === 'features[0].at'));
  assert.equal(off.some((p) => p.code === 'building-in-water'), false);
});

test('buildings: a square counts as a place to stand; with no blocks and no squares the check is skipped', () => {
  const squares = layer('streets', {
    features: [{ id: 'market-square', type: 'square', polygon: square(300, 300, 400, 400), ...shown }],
  });
  assert.deepEqual(problemsOf({ streets: squares, buildings: buildingsLayer([['north', [350, 350], 'shop']]) }), []);
  assert.deepEqual(
    problemsOf({ streets: squares, buildings: buildingsLayer([['north', [900, 900], 'shop']]) }),
    ['building-not-on-block features[0].at'],
  );
  assert.deepEqual(problemsOf({ buildings: buildingsLayer([['north', [900, 900], 'shop']]) }), []);
});

test('districts: the realm rules, a character, and the district type', () => {
  const district = { kind: 'district', id: 'docks', color: '#3366aa', seeds: [[400, 1200]], character: 'poor', place: 'north', ...master };
  assert.deepEqual(problemsOf({ districts: layer('districts', { constraints: [district] }) }), []);
  const districts = (constraint) => problemsOf({ districts: layer('districts', { constraints: [constraint] }) });
  assert.deepEqual(districts({ ...district, color: 'blue' }), ['bad-constraint constraints[0].color']);
  assert.deepEqual(districts({ ...district, seeds: [] }), ['bad-constraint constraints[0].seeds']);
  assert.deepEqual(districts({ ...district, character: 'royal' }), ['bad-constraint constraints[0].character']);
  assert.deepEqual(districts({ ...district, place: 'ghost' }), ['unknown-place constraints[0].place']);
  assert.deepEqual(districts({ ...district, kind: 'realm' }), ['bad-constraint constraints[0].kind']);

  const feature = {
    id: 'docks', type: 'district', color: '#3366aa', seeds: [[400, 1200]], name: 'The Docks',
    polygon: square(300, 1000, 900, 1500), character: 'poor', ...shown,
  };
  assert.deepEqual(problemsOf({ districts: layer('districts', { features: [feature] }) }), []);
  assert.deepEqual(problemsOf({ districts: layer('districts', { features: [{ ...feature, type: 'realm' }] }) }),
    ['bad-feature features[0].type']);
  assert.deepEqual(problemsOf({ districts: layer('districts', { features: [{ ...feature, character: 'royal' }] }) }),
    ['bad-feature features[0].character']);
  assert.deepEqual(problemsOf({ districts: layer('districts', { features: [{ ...feature, name: 3 }] }) }),
    ['bad-feature features[0].name']);
});
