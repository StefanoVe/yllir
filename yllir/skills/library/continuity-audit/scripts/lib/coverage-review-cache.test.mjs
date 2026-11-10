import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  coverageReviewKey,
  readCoverageReviewCache,
  reusableCoverageReview,
  storeCoverageReviewCache,
} from './coverage-review-cache.mjs';

const CLI = new URL('../coverage-review-cache.mjs', import.meta.url);

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-review-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'campaign');
  fs.mkdirSync(root);
  const write = (file, value) => {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
    return target;
  };
  const facts = {
    complete: true,
    coverage: [{ fid: 'F1', document: 'A.md', status: 'read' }],
    discarded: [],
    facts: [],
  };
  const review = { verdict: 'CONFIRMED', missed: [] };
  const factsFile = write('facts.json', JSON.stringify(facts));
  const scopeFile = write('scope.json', JSON.stringify({ files: [{ fid: 'F1', document: 'A.md' }] }));
  const vocabularyFile = write('vocab.yaml', 'attributes: []\n');
  const instructionsFile = write('reviewer.md', 'review instructions\n');
  fs.writeFileSync(path.join(root, 'A.md'), 'source A\n');
  const cacheDir = path.join(dir, 'cache');
  const input = { root, factsFile, scopeFile, vocabularyFile, instructionsFile };
  return { dir, root, write, facts, review, factsFile, scopeFile, vocabularyFile, instructionsFile, cacheDir, input };
}

function keyFor(f) {
  return coverageReviewKey(f.input);
}

function cli(f, operation, extra = []) {
  const args = [
    CLI.pathname,
    operation,
    f.root,
    '--facts', f.factsFile,
    '--scope', f.scopeFile,
    '--review', f.reviewFile,
    '--out', f.cacheDir,
    '--vocab', f.vocabularyFile,
    '--instructions', f.instructionsFile,
    ...extra,
  ];
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

test('cache key changes when facts, vocabulary, reviewer instructions, or scoped documents change', (t) => {
  const f = fixture(t);
  const initial = keyFor(f);

  fs.writeFileSync(f.factsFile, JSON.stringify({ ...f.facts, facts: [{ id: 'new-fact' }] }));
  assert.notEqual(keyFor(f), initial, 'facts affect the key');
  fs.writeFileSync(f.factsFile, JSON.stringify(f.facts));

  fs.writeFileSync(f.vocabularyFile, 'attributes:\n  - name\n');
  assert.notEqual(keyFor(f), initial, 'vocabulary affects the key');
  fs.writeFileSync(f.vocabularyFile, 'attributes: []\n');

  fs.writeFileSync(f.instructionsFile, 'changed review instructions\n');
  assert.notEqual(keyFor(f), initial, 'reviewer instructions affect the key');
  fs.writeFileSync(f.instructionsFile, 'review instructions\n');

  fs.writeFileSync(path.join(f.root, 'A.md'), 'changed source A\n');
  assert.notEqual(keyFor(f), initial, 'contents of a scoped document affect the key');
});

test('cache key changes when scope adds or removes a document', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'B.md'), 'source B\n');
  const initial = keyFor(f);

  fs.writeFileSync(f.scopeFile, JSON.stringify({ files: [
    { fid: 'F1', document: 'A.md' },
    { fid: 'F2', document: 'B.md' },
  ] }));
  const withAddedDocument = keyFor(f);
  assert.notEqual(withAddedDocument, initial, 'adding a scoped document affects the key');

  fs.writeFileSync(f.scopeFile, JSON.stringify({ files: [{ fid: 'F2', document: 'B.md' }] }));
  assert.notEqual(keyFor(f), withAddedDocument, 'removing a scoped document affects the key');
});

test('malformed, incomplete, discarded, and MISSED reviews are never reusable', (t) => {
  const f = fixture(t);
  assert.equal(reusableCoverageReview({ facts: f.facts, review: f.review }), true);
  assert.equal(reusableCoverageReview({ facts: { ...f.facts, complete: false }, review: f.review }), false);
  assert.equal(reusableCoverageReview({
    facts: { ...f.facts, coverage: [{ fid: 'F1', document: 'A.md', status: 'to-read' }] },
    review: f.review,
  }), false);
  assert.equal(reusableCoverageReview({ facts: { ...f.facts, discarded: [{ fid: 'F1' }] }, review: f.review }), false);
  assert.equal(reusableCoverageReview({
    facts: f.facts,
    review: { verdict: 'MISSED', missed: [{ fid: 'F1' }] },
  }), false);

  const key = keyFor(f);
  fs.mkdirSync(f.cacheDir, { recursive: true });
  fs.writeFileSync(path.join(f.cacheDir, `${key}.json`), '{broken json');
  assert.equal(readCoverageReviewCache(f.cacheDir, key), null, 'malformed cache entry is rejected');
  fs.writeFileSync(path.join(f.cacheDir, `${key}.json`), JSON.stringify({
    key,
    certificate: { complete: false, coverage: f.facts.coverage, discarded: [] },
    review: f.review,
  }));
  assert.equal(readCoverageReviewCache(f.cacheDir, key), null, 'incomplete cached certificate is rejected');
  fs.writeFileSync(path.join(f.cacheDir, `${key}.json`), JSON.stringify({
    key,
    certificate: f.facts,
    review: { verdict: 'MISSED', missed: [{ fid: 'F1' }] },
  }));
  assert.equal(readCoverageReviewCache(f.cacheDir, key), null, 'MISSED cached review is rejected');
});

test('store rejects a key that changed after lookup', (t) => {
  const f = fixture(t);
  const lookupKey = keyFor(f);
  fs.writeFileSync(path.join(f.root, 'A.md'), 'changed after lookup\n');
  const currentKey = keyFor(f);

  assert.equal(storeCoverageReviewCache({
    cacheDir: f.cacheDir,
    key: currentKey,
    expectedKey: lookupKey,
    facts: f.facts,
    review: f.review,
  }), false);
  assert.equal(fs.existsSync(path.join(f.cacheDir, `${currentKey}.json`)), false);
});

test('CLI lookup and store round-trip the key snapshot and reject stale review input', (t) => {
  const f = fixture(t);
  f.reviewFile = path.join(f.dir, 'review.json');
  const keyFile = path.join(f.dir, 'lookup-key.txt');
  const outputReview = f.reviewFile;

  const firstLookup = cli(f, 'lookup', ['--key-out', keyFile]);
  assert.equal(firstLookup.status, 0, firstLookup.stderr);
  assert.equal(firstLookup.stdout, 'coverage review: run reviewer\nexit: 0\n');
  const snapshot = fs.readFileSync(keyFile, 'utf8').trim();

  fs.writeFileSync(f.reviewFile, JSON.stringify(f.review));
  const stored = cli(f, 'store', ['--key-file', keyFile]);
  assert.equal(stored.status, 0, stored.stderr);
  assert.equal(stored.stdout, 'coverage review: cached\nexit: 0\n');

  const reused = cli(f, 'lookup', ['--key-out', keyFile]);
  assert.equal(reused.status, 0, reused.stderr);
  assert.equal(reused.stdout, 'coverage review: reused\nexit: 0\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(outputReview, 'utf8')), f.review);
  assert.equal(fs.readFileSync(keyFile, 'utf8').trim(), snapshot);

  fs.writeFileSync(path.join(f.root, 'A.md'), 'changed after review lookup\n');
  const staleStore = cli(f, 'store', ['--key-file', keyFile]);
  assert.equal(staleStore.status, 0, staleStore.stderr);
  assert.equal(staleStore.stdout, 'coverage review: not cached\nexit: 0\n');
  assert.equal(readCoverageReviewCache(f.cacheDir, keyFor(f)), null);
});
