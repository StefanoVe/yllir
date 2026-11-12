import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planRetirements, readRetiredIds, writeRetiredIds, RETIRED_IDS_FILE } from './retired-ids.mjs';

function tempCampaign(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-retired-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeRetired(dir, text) {
  const full = path.join(dir, RETIRED_IDS_FILE);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

const write = (file, id, extra = {}) => ({
  file,
  id,
  merged: [],
  isNew: true,
  previousId: null,
  ...extra,
});

test('a deleted id is retired', () => {
  const plan = planRetirements({ deletes: [{ file: 'a.md', id: 'old-one' }] });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.ids, ['old-one']);
});

test('a deleted sheet without an id retires nothing', () => {
  const plan = planRetirements({ deletes: [{ file: 'a.md', id: null }] });
  assert.deepEqual(plan.ids, []);
});

test('a rename (delete plus write with the same id) retires nothing and is allowed', () => {
  const plan = planRetirements({
    deletes: [{ file: 'old/Mara.md', id: 'mara' }],
    writes: [write('new/Mara.md', 'mara')],
  });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.ids, []);
});

test('a new sheet with an id retired before the batch is rejected with id-reused', () => {
  const plan = planRetirements({ prior: ['gone'], writes: [write('x.md', 'gone')] });
  assert.equal(plan.errors.length, 1);
  assert.equal(plan.errors[0].code, 'id-reused');
  assert.equal(plan.errors[0].file, 'x.md');
});

test('a sheet whose id changed to a retired id is rejected, an unchanged one is not', () => {
  const changed = planRetirements({
    prior: ['gone'],
    writes: [write('x.md', 'gone', { isNew: false, previousId: 'other' })],
  });
  assert.equal(changed.errors[0]?.code, 'id-reused');

  const unchanged = planRetirements({
    prior: ['gone'],
    writes: [write('x.md', 'gone', { isNew: false, previousId: 'gone' })],
  });
  assert.deepEqual(unchanged.errors, []);
});

test('merged_ids retire their ids, and a new sheet using one is rejected', () => {
  const plan = planRetirements({
    writes: [write('keep.md', 'keep', { merged: ['absorbed'] }), write('other.md', 'absorbed')],
  });
  assert.deepEqual(plan.ids, ['absorbed']);
  assert.deepEqual(plan.errors.map((e) => e.file), ['other.md']);
});

test('the result keeps the prior ids, sorted and without duplicates', () => {
  const plan = planRetirements({
    prior: ['zeta', 'alpha'],
    deletes: [{ file: 'b.md', id: 'alpha' }, { file: 'c.md', id: 'mid' }],
  });
  assert.deepEqual(plan.ids, ['alpha', 'mid', 'zeta']);
});

test('readRetiredIds: a missing file is an empty list', (t) => {
  const dir = tempCampaign(t);
  assert.deepEqual(readRetiredIds(dir), { ok: true, ids: [] });
});

test('readRetiredIds: invalid JSON, a missing ids list and non-string ids are refused', (t) => {
  const dir = tempCampaign(t);
  writeRetired(dir, '{ not json');
  assert.equal(readRetiredIds(dir).ok, false);
  writeRetired(dir, '{"other": []}');
  assert.equal(readRetiredIds(dir).ok, false);
  writeRetired(dir, '{"ids": [1]}');
  assert.equal(readRetiredIds(dir).ok, false);
  writeRetired(dir, '[]');
  assert.equal(readRetiredIds(dir).ok, false);
});

test('writeRetiredIds writes sorted unique ids with 2-space indent and a trailing newline', (t) => {
  const dir = tempCampaign(t);
  writeRetiredIds(dir, ['b', 'a', 'b']);
  assert.equal(fs.readFileSync(path.join(dir, RETIRED_IDS_FILE), 'utf8'), '{\n  "ids": [\n    "a",\n    "b"\n  ]\n}\n');
  assert.deepEqual(readRetiredIds(dir), { ok: true, ids: ['a', 'b'] });
});

test('writeRetiredIds writes nothing for an empty list when there is no file yet', (t) => {
  const dir = tempCampaign(t);
  writeRetiredIds(dir, []);
  assert.equal(fs.existsSync(path.join(dir, RETIRED_IDS_FILE)), false);
});
