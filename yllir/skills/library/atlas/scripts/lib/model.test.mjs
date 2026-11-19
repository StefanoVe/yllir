import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { atlasDir, readAtlas, validateAtlas, manifestProblems } from './model.mjs';
import { buildWorldIndex } from '../../../../../scripts/lib/world-graph.mjs';
import {
  cleanupCampaigns, standardCampaign, makeCampaign, campaignYaml, baseManifest, terrainLayer, landFeature,
  placesLayer, square, writeAtlas, readAtlasFile,
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
    layers: { terrain: { locked: true, snapshot: { constraints: 'a'.repeat(64), features: {} } } },
  });
  assert.deepEqual(manifestProblems(good), []);
  const bad = baseManifest({ layers: { terrain: { locked: true, snapshot: { constraints: 'nope', features: {} } } } });
  assert.deepEqual(codes(manifestProblems(bad)), ['bad-manifest']);
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
