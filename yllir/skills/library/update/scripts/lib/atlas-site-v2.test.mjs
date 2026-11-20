import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, detect } from '../../migrations/atlas-site-v2/deterministic.mjs';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-atlas-site-v2-'));
  tempDirs.push(dir);
  return dir;
}

/** A cached site file, with the given text as its index.html. */
function site(root, audience, text) {
  const dir = path.join(root, '.campaign', 'cache', 'atlas', audience);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), text);
  return path.join(dir, 'index.html');
}

const SEA_OLD = '<html><script type="application/json">{"canvas":{},"sea":{"file":"assets/sea.png"},"places":[]}</script></html>';
const SEA_FEATHERED = '<html><style>.feather-mx{}</style><script type="application/json">{"canvas":{},"sea":{"file":"assets/sea.png"},"places":[]}</script></html>';
const NO_SEA = '<html><script type="application/json">{"canvas":{},"sea":null,"places":[]}</script></html>';
const NO_SEA_KEY = '<html><script type="application/json">{"canvas":{},"places":[]}</script></html>';

test('no cached site: detect is false and nothing is rebuilt', () => {
  const root = tmp();
  assert.equal(detect(root), false);
  assert.deepEqual(apply(root, { dryRun: true }), { status: 'complete', changed: [], errors: [] });
});

test('a cached site with a sea object and no feather-mx is stale', () => {
  const root = tmp();
  site(root, 'master', SEA_OLD);
  assert.equal(detect(root), true);
});

test('a cached site with a sea object that already has feather-mx is not stale', () => {
  const root = tmp();
  site(root, 'master', SEA_FEATHERED);
  assert.equal(detect(root), false);
});

test('a cached site with "sea":null is not stale', () => {
  const root = tmp();
  site(root, 'players', NO_SEA);
  assert.equal(detect(root), false);
});

test('a cached site without a sea key is not stale', () => {
  const root = tmp();
  site(root, 'players', NO_SEA_KEY);
  assert.equal(detect(root), false);
});

test('a dry run lists the stale site and leaves the file untouched', () => {
  const root = tmp();
  const file = site(root, 'players', SEA_OLD);
  const result = apply(root, { dryRun: true });
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.changed, ['.campaign/cache/atlas/players/index.html']);
  assert.deepEqual(result.errors, []);
  assert.equal(fs.readFileSync(file, 'utf8'), SEA_OLD);
});

test('a stale site in a folder that is not an atlas campaign is skipped, not failed, and kept', () => {
  const root = tmp();
  const file = site(root, 'master', SEA_OLD);
  const result = apply(root, {});
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.changed, []);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].audience, 'master');
  assert.equal(typeof result.skipped[0].reason, 'string');
  assert.deepEqual(result.errors, []);
  assert.equal(fs.readFileSync(file, 'utf8'), SEA_OLD);
});
