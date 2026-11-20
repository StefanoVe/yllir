import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCKABLE, lockProblems, setLock, checkLandChange } from './lock.mjs';
import { baseManifest } from './test-support.mjs';

const HASH = 'b'.repeat(64);

test('LOCKABLE is the base and the land', () => {
  assert.deepEqual(LOCKABLE, ['base', 'land']);
});

test('lockProblems: a locked item without a sha256 is reported, one with a hash is not', () => {
  const manifest = baseManifest();
  assert.deepEqual(lockProblems(manifest), []);

  const noHash = baseManifest({ land: { file: 'land.png', sha256: 'nope', locked: true } });
  const problems = lockProblems(noHash);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, 'locked-without-hash');
  assert.equal(problems[0].file, 'atlas.json');
  assert.equal(problems[0].path, 'land.sha256');

  const hashed = baseManifest({ base: { file: 'base.png', sha256: HASH, locked: true } });
  assert.deepEqual(lockProblems(hashed), []);
});

test('lockProblems: nothing to report for a missing or non-object manifest', () => {
  assert.deepEqual(lockProblems(undefined), []);
  assert.deepEqual(lockProblems(null), []);
});

test('setLock locks and unlocks named items and returns a new manifest', () => {
  const manifest = baseManifest();
  const locked = setLock(manifest, ['base', 'land'], true);
  assert.equal(locked.base.locked, true);
  assert.equal(locked.land.locked, true);
  assert.equal(manifest.base.locked, false, 'the given manifest is not changed');
  assert.notEqual(locked, manifest);

  const unlocked = setLock(locked, ['land'], false);
  assert.equal(unlocked.land.locked, false);
  assert.equal(unlocked.base.locked, true);
});

test('setLock refuses to lock an item that does not exist, and an unknown name', () => {
  const manifest = baseManifest({ base: undefined });
  assert.throws(() => setLock(manifest, ['base'], true), /does not exist/);
  assert.throws(() => setLock(manifest, ['terrain'], true), RangeError);
  assert.throws(() => setLock(manifest, ['terrain'], false), RangeError);
});

test('setLock unlocking an item that does not exist changes nothing', () => {
  const manifest = baseManifest({ base: undefined });
  assert.deepEqual(setLock(manifest, ['base'], false), manifest);
});

test('checkLandChange: an unlocked land accepts any change', () => {
  const manifest = baseManifest();
  assert.deepEqual(checkLandChange({ manifest, diff: { gained: 5000, lost: 5000 } }), { ok: true });
});

test('checkLandChange: a locked land refuses a change, unless unlock is given', () => {
  const manifest = setLock(baseManifest(), ['land'], true);
  assert.deepEqual(checkLandChange({ manifest, diff: { gained: 400, lost: 0 } }), { ok: false, reason: 'land-locked' });
  assert.deepEqual(checkLandChange({ manifest, diff: { gained: 0, lost: 400 } }), { ok: false, reason: 'land-locked' });
  assert.deepEqual(checkLandChange({ manifest, diff: { gained: 400, lost: 0 }, unlock: true }), { ok: true });
});

test('checkLandChange: extend accepts a change that gains land and loses none', () => {
  const manifest = setLock(baseManifest(), ['land'], true);
  assert.deepEqual(checkLandChange({ manifest, diff: { gained: 400, lost: 0 }, extend: true }), { ok: true });
  assert.deepEqual(checkLandChange({ manifest, diff: { gained: 400, lost: 300 }, extend: true }), { ok: false, reason: 'land-locked' });
});

test('checkLandChange: changes below 25 pixels on each side are noise', () => {
  const manifest = setLock(baseManifest(), ['land'], true);
  assert.deepEqual(checkLandChange({ manifest, diff: { gained: 24, lost: 3 } }), { ok: true });
  assert.deepEqual(checkLandChange({ manifest, diff: { gained: 0, lost: 0 } }), { ok: true });
  assert.deepEqual(checkLandChange({ manifest, diff: { gained: 25, lost: 0 } }), { ok: false, reason: 'land-locked' });
});

test('checkLandChange: no diff given counts as no change', () => {
  const manifest = setLock(baseManifest(), ['land'], true);
  assert.deepEqual(checkLandChange({ manifest }), { ok: true });
});

test('checkLandChange: a lock on the base alone does not restrict the land', () => {
  const manifest = setLock(baseManifest(), ['base'], true);
  assert.deepEqual(checkLandChange({ manifest, diff: { gained: 900, lost: 900 } }), { ok: true });
});
