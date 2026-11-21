import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { summarize } from './lib/results.mjs';
import { TOLERANCE, compare } from './regression-gate.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'regression-gate.mjs');
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** Records of one case and model, one per pass value, under one hash and dated from day. */
function runs(hash, passes, { day = 1, model = 'haiku', caseName = 'entry-go-back' } = {}) {
  return passes.map((pass, index) => ({
    case: caseName,
    run: index + 1,
    date: `2026-11-${String(day + index).padStart(2, '0')}T10:00:00.000Z`,
    model,
    instructions_hash: hash,
    pass,
    checks: {},
  }));
}

/** The comparison of the previous set (hash old, all passes) with the current set (hash new). */
function compareSets(previousPasses, currentPasses, tolerance) {
  const records = [
    ...runs('old', previousPasses, { day: 1 }),
    ...runs('new', currentPasses, { day: 10 }),
  ];
  return compare(summarize(records), tolerance);
}

test('TOLERANCE is 0.34: one run in three of drop is tolerated', () => {
  assert.equal(TOLERANCE, 0.34);
});

test('a drop of one run in three (1 to 2 of 3) is ok', () => {
  const [item] = compareSets([true, true, true], [true, true, false]);
  assert.equal(item.status, 'ok');
  assert.ok(Math.abs(item.drop - 1 / 3) < 1e-9);
  assert.equal(item.previous_hash, 'old');
  assert.equal(item.current_hash, 'new');
});

test('a drop of two runs in three (3 to 1 of 3) is blocked', () => {
  const [item] = compareSets([true, true, true], [true, false, false]);
  assert.equal(item.status, 'blocked');
  assert.ok(Math.abs(item.drop - 2 / 3) < 1e-9);
});

test('equal pass rates are ok', () => {
  const [item] = compareSets([true, false, true], [false, true, true]);
  assert.equal(item.drop, 0);
  assert.equal(item.status, 'ok');
});

test('a case with only one group is no-baseline and does not block', () => {
  const items = compare(summarize(runs('only', [false, false, false])));
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'no-baseline');
  assert.equal(items[0].previous_hash, null);
  assert.equal(items[0].previous_rate, null);
  assert.equal(items[0].drop, null);
});

test('the previous group is the one before the latest by its newest run, not by array order', () => {
  const records = [
    ...runs('new', [false, false, false], { day: 20 }),
    ...runs('old', [true, true, true], { day: 1 }),
  ];
  const [item] = compare(summarize(records));
  assert.equal(item.current_hash, 'new');
  assert.equal(item.previous_hash, 'old');
  assert.equal(item.status, 'blocked');
});

test('models are compared only with the same model', () => {
  const records = [
    ...runs('a', [true, true, true], { day: 1, model: 'haiku' }),
    ...runs('b', [false, false, false], { day: 10, model: 'sonnet' }),
  ];
  const items = compare(summarize(records));
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.status === 'no-baseline'));
});

test('the CLI exits 1 when a case is blocked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-gate-'));
  tempDirs.push(dir);
  const records = [...runs('old', [true, true, true], { day: 1 }), ...runs('new', [false, false, false], { day: 10 })];
  fs.writeFileSync(path.join(dir, 'g.jsonl'), records.map((r) => JSON.stringify(r)).join('\n'));
  let status = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [SCRIPT, '--results', dir], { encoding: 'utf8' });
  } catch (err) {
    status = err.status;
    stdout = err.stdout;
  }
  assert.equal(status, 1);
  assert.match(stdout, /^BLOCKED /m);
});

test('the CLI exits 0 when nothing is blocked, and 2 on a bad tolerance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-gate-'));
  tempDirs.push(dir);
  const records = [...runs('old', [true, true, true], { day: 1 }), ...runs('new', [true, true, false], { day: 10 })];
  fs.writeFileSync(path.join(dir, 'g.jsonl'), records.map((r) => JSON.stringify(r)).join('\n'));
  assert.equal(execFileSync(process.execPath, [SCRIPT, '--results', dir], { encoding: 'utf8' }).includes('ok '), true);

  let status = 0;
  try {
    execFileSync(process.execPath, [SCRIPT, '--results', dir, '--tolerance', '2'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    status = err.status;
  }
  assert.equal(status, 2);
});
