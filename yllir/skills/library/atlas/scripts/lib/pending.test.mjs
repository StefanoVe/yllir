import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { folderOfPlace, inScope, pendingPlaces } from './pending.mjs';
import { readAtlas } from './model.mjs';
import { buildWorldIndex } from '../../../../../scripts/lib/world-graph.mjs';
import {
  cleanupCampaigns, standardCampaign, baseManifest, emptyLabels, writeAtlas,
} from './test-support.mjs';

after(cleanupCampaigns);

const regionScope = (places = []) => baseManifest({ scope: { kind: 'region', places, note: 'test' } });

const onMap = (...ids) => emptyLabels({
  places: ids.map((id, i) => ({
    id: `p${i}`, place: id, x: 100 + i, y: 100, kind: 'town', provenance: 'master', visibility: 'public', sources: [],
  })),
});

test('folderOfPlace: a sheet named like its folder owns that folder; others do not', () => {
  assert.equal(folderOfPlace({ file: 'World/North/North.md' }), 'World/North/');
  assert.equal(folderOfPlace({ file: 'World/North/Port Ash.md' }), null);
  assert.equal(folderOfPlace({ file: 'World/South.md' }), null);
});

test('inScope: a listed id that is not in the index matches only itself', () => {
  const index = { subjects: [] };
  assert.equal(inScope({ id: 'ghost', file: 'World/Ghost/Other.md' }, { places: ['ghost'] }, index), true);
  assert.equal(inScope({ id: 'other', file: 'World/Ghost/Other.md' }, { places: ['ghost'] }, index), false);
});

test('pendingPlaces: scope north lists north as placed, so port-ash is the only one pending; south is out of scope', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: regionScope(['north']) });
  const pending = pendingPlaces(root, readAtlas(root), buildWorldIndex(root));
  assert.deepEqual(pending.map((p) => p.id), ['port-ash']);
  assert.deepEqual(Object.keys(pending[0]).sort(), ['file', 'id', 'title']);
});

test('pendingPlaces: with no scope places, a place is pending until labels.places names it', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: regionScope([]), labels: onMap('north') });
  assert.deepEqual(pendingPlaces(root, readAtlas(root), buildWorldIndex(root)).map((p) => p.id), ['port-ash', 'south']);
});

test('pendingPlaces: only labels.places places a place; a land label does not', () => {
  const root = standardCampaign();
  writeAtlas(root, {
    manifest: regionScope([]),
    labels: { ...onMap('north', 'south'), lands: [{ id: 'l1', text: 'Nord', x: 1, y: 1, size: 20, provenance: 'master', sources: [] }] },
  });
  assert.deepEqual(pendingPlaces(root, readAtlas(root), buildWorldIndex(root)).map((p) => p.id), ['port-ash']);
});

test('pendingPlaces: after a north places item, only port-ash is pending when north is in scope', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: regionScope(['north']), labels: onMap('north') });
  const pending = pendingPlaces(root, readAtlas(root), buildWorldIndex(root));
  assert.deepEqual(pending.map((p) => p.id), ['port-ash']);
});

test('pendingPlaces: an empty scope means every place, and characters are never places', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: baseManifest({ scope: { kind: 'world', places: [] } }) });
  const pending = pendingPlaces(root, readAtlas(root), buildWorldIndex(root));
  assert.deepEqual(pending.map((p) => p.id), ['north', 'port-ash', 'south']);
});

test('pendingPlaces: a folder place in scope brings its sub-places with it', () => {
  const root = standardCampaign();
  writeAtlas(root, { manifest: regionScope(['north']), labels: onMap('south') });
  assert.deepEqual(pendingPlaces(root, readAtlas(root), buildWorldIndex(root)).map((p) => p.id), ['port-ash']);
});

test('pendingPlaces: no manifest, no pending places', () => {
  const root = standardCampaign();
  assert.deepEqual(pendingPlaces(root, { manifest: undefined, labels: undefined }, buildWorldIndex(root)), []);
});
