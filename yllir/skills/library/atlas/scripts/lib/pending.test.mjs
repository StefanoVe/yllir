import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { folderOfPlace, inScope, pendingPlaces } from './pending.mjs';
import { readAtlas } from './model.mjs';
import { buildWorldIndex } from '../../../../../scripts/lib/world-graph.mjs';
import {
  cleanupCampaigns, standardCampaign, baseManifest, placesLayer, writeAtlas,
} from './test-support.mjs';

after(cleanupCampaigns);

test('folderOfPlace: a sheet named like its folder owns that folder; others do not', () => {
  assert.equal(folderOfPlace({ file: 'World/North/North.md' }), 'World/North/');
  assert.equal(folderOfPlace({ file: 'World/North/Port Ash.md' }), null);
  assert.equal(folderOfPlace({ file: 'World/South.md' }), null);
});

test('pendingPlaces: scope north gives north and port-ash, not south', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: baseManifest({ scope: { kind: 'region', places: ['north'] } }) });
  const atlas = readAtlas(root);
  const pending = pendingPlaces(root, atlas, buildWorldIndex(root));
  assert.deepEqual(pending.map((p) => p.id), ['north', 'port-ash']);
  assert.deepEqual(Object.keys(pending[0]).sort(), ['file', 'id', 'title']);
});

test('pendingPlaces: after a north place feature, only port-ash is pending', () => {
  const root = standardCampaign();
  writeAtlas(root, {
    manifest: baseManifest({ scope: { kind: 'region', places: ['north'] } }),
    layers: { places: placesLayer([['north', [500, 500]]]) },
  });
  const pending = pendingPlaces(root, readAtlas(root), buildWorldIndex(root));
  assert.deepEqual(pending.map((p) => p.id), ['port-ash']);
});

test('pendingPlaces: an empty scope means every place, and characters are never places', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: baseManifest({ scope: { kind: 'world', places: [] } }) });
  const pending = pendingPlaces(root, readAtlas(root), buildWorldIndex(root));
  assert.deepEqual(pending.map((p) => p.id), ['north', 'port-ash', 'south']);
});

test('inScope: a listed id that is not in the index matches only itself', () => {
  const index = { subjects: [] };
  assert.equal(inScope({ id: 'ghost', file: 'World/Ghost/Other.md' }, { places: ['ghost'] }, index), true);
  assert.equal(inScope({ id: 'other', file: 'World/Ghost/Other.md' }, { places: ['ghost'] }, index), false);
});

test('pendingPlaces: no manifest, no pending places', () => {
  const root = standardCampaign();
  assert.deepEqual(pendingPlaces(root, { manifest: undefined, layers: {} }, buildWorldIndex(root)), []);
});
