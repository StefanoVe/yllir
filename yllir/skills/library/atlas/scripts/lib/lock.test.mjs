import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotOf, lockProblems, checkWrite } from './lock.mjs';
import { readAtlas, validateAtlas } from './model.mjs';
import {
  cleanupCampaigns, standardCampaign, baseManifest, terrainLayer, landFeature, square, writeAtlas,
} from './test-support.mjs';

after(cleanupCampaigns);

function lockedManifest(layer) {
  return baseManifest({ layers: { terrain: { locked: true, snapshot: snapshotOf(layer) } } });
}

function movedVertex(layer) {
  const moved = structuredClone(layer);
  moved.features[0].polygon[2] = [880, 880];
  return moved;
}

test('checkWrite: changing a locked feature is refused, unlock allows it', () => {
  const locked = terrainLayer();
  const manifest = lockedManifest(locked);
  const refused = checkWrite(manifest, 'terrain', movedVertex(locked), { current: locked });
  assert.equal(refused.ok, false);
  assert.ok(refused.changed.includes('land-main'));

  const allowed = checkWrite(manifest, 'terrain', movedVertex(locked), { current: locked, unlock: true });
  assert.equal(allowed.ok, true);
});

test('checkWrite: a new non-overlapping land is allowed after the lock', () => {
  const locked = terrainLayer();
  const manifest = lockedManifest(locked);
  const candidate = structuredClone(locked);
  candidate.features.push(landFeature('land-island', square(10, 10, 60, 60)));
  const result = checkWrite(manifest, 'terrain', candidate, { current: locked });
  assert.equal(result.ok, true);
  assert.deepEqual(result.added, ['land-island']);
  assert.deepEqual(result.overlaps, []);
});

test('checkWrite: a new land overlapping locked land is refused even without changes', () => {
  const locked = terrainLayer();
  const manifest = lockedManifest(locked);
  const candidate = structuredClone(locked);
  candidate.features.push(landFeature('land-clash', square(300, 300, 400, 400)));
  const result = checkWrite(manifest, 'terrain', candidate, { current: locked });
  assert.equal(result.ok, false);
  assert.deepEqual(result.overlaps, ['land-clash']);
  assert.equal(checkWrite(manifest, 'terrain', candidate, { current: locked, unlock: true }).ok, true);
});

test('lockProblems: a feature edited on disk after the lock is reported', () => {
  const root = standardCampaign();
  const layer = terrainLayer();
  writeAtlas(root, { manifest: lockedManifest(layer), layers: { terrain: movedVertex(layer) } });
  const atlas = readAtlas(root);
  const problems = lockProblems(atlas.manifest, atlas.layers);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, 'locked-layer-changed');
  assert.deepEqual(problems[0].ids, ['land-main']);
});

test('lockProblems: a locked layer that is unchanged reports nothing, and new ids are allowed', () => {
  const layer = terrainLayer();
  const manifest = lockedManifest(layer);
  const grown = structuredClone(layer);
  grown.features.push(landFeature('land-new', square(10, 10, 20, 20)));
  assert.deepEqual(lockProblems(manifest, { terrain: layer }), []);
  assert.deepEqual(lockProblems(manifest, { terrain: grown }), []);
});

test('lockProblems: a removed feature and a changed constraint are reported', () => {
  const layer = terrainLayer();
  const manifest = lockedManifest(layer);
  const removed = { ...layer, features: [], constraints: [{ note: 'x' }] };
  const [problem] = lockProblems(manifest, { terrain: removed });
  assert.deepEqual(problem.ids, ['(constraints)', 'land-main']);
});

test('validateAtlas reports locked-layer-changed for an edit on disk', () => {
  const root = standardCampaign();
  const layer = terrainLayer();
  writeAtlas(root, { manifest: lockedManifest(layer), layers: { terrain: movedVertex(layer) } });
  const problems = validateAtlas(root, readAtlas(root), {});
  assert.ok(problems.some((p) => p.code === 'locked-layer-changed' && p.file === 'Atlas/terrain.json'));
});
