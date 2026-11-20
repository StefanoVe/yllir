import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { folderOfPlace, inScope, pendingPlaces } from './pending.mjs';
import { readAtlas } from './model.mjs';
import { buildWorldIndex } from '../../../../../scripts/lib/world-graph.mjs';
import {
  cleanupCampaigns, standardCampaign, baseManifest, placesLayer, writeAtlas, urbanManifest, buildingsLayer,
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

test('pendingPlaces, urban: a building or a district places a town; a places feature does not', () => {
  const root = standardCampaign();
  writeAtlas(root, {
    manifest: urbanManifest({ scope: { kind: 'settlement', places: [] } }),
    layers: {
      buildings: buildingsLayer([['north', [500, 500], 'tavern']]),
      districts: {
        layer: 'districts',
        constraints: [],
        features: [{
          id: 'south', type: 'district', color: '#3366aa', seeds: [[400, 400]], place: 'south',
          polygon: [[300, 300], [900, 300], [900, 900]], provenance: 'master', visibility: 'public', sources: [],
        }],
      },
      places: placesLayer([['port-ash', [500, 500]]]),
    },
  });
  const pending = pendingPlaces(root, readAtlas(root), buildWorldIndex(root));
  assert.deepEqual(pending.map((p) => p.id), ['port-ash']);
});

test('pendingPlaces, urban: a place listed in scope.places is not pending; its folder places are still in scope', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: urbanManifest({ scope: { kind: 'settlement', places: ['north'] } }) });
  const pending = pendingPlaces(root, readAtlas(root), buildWorldIndex(root));
  assert.deepEqual(pending.map((p) => p.id), ['port-ash']);
});

test('pendingPlaces, urban: with no scope places, every place is pending until something places it', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: urbanManifest({ scope: { kind: 'district', places: [] } }) });
  const pending = pendingPlaces(root, readAtlas(root), buildWorldIndex(root));
  assert.deepEqual(pending.map((p) => p.id), ['north', 'port-ash', 'south']);
});
