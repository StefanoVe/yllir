import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeOutcomes } from './lib/merge-outcomes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'merge-outcomes.mjs');
function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-merge-'));
  try {
    fs.mkdirSync(path.join(root, 'People'), { recursive: true });
    fs.writeFileSync(path.join(root, 'People', 'A.md'), '# A\n');
    fs.writeFileSync(path.join(root, 'Note.md'), 'A and B\n');
    const plan = { proposals: ['P001', 'P002'].map((pid, i) => ({ pid, file: 'Note.md', line: 1, col: 1 + i, target: `People/${i ? 'B' : 'A'}.md`, text: i ? 'B' : 'A' })) };
    const outcome = (id, reason = 'reviewed') => ({ id, file: 'Note.md', occurrence: `1:${id === 'P001' ? 1 : 2}`, target: `People/${id === 'P001' ? 'A' : 'B'}.md`, evidence: 'People/A.md:1', outcome: 'APPLY', reason });
    fn(root, plan, outcome);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('light merge appends review entries and preserves automatic decisions', () => withRoot((root, plan, outcome) => {
  const auto = { ...outcome('P001', 'deterministic'), outcome: 'APPLY' };
  const merged = mergeOutcomes(root, plan, [auto], [outcome('P002')], { mode: 'scoped', pids: ['P002'] });
  assert.deepEqual(merged, [auto, outcome('P002')]);
}));

test('retry replaces only requested IDs, including an invalid old requested entry', () => withRoot((root, plan, outcome) => {
  const keep = outcome('P001', 'keep me');
  const badRetry = { ...outcome('P002'), evidence: '' };
  const merged = mergeOutcomes(root, plan, [keep, badRetry], [outcome('P002', 'fixed')], { mode: 'scoped', pids: ['P002'] });
  assert.deepEqual(merged, [keep, outcome('P002', 'fixed')]);
}));

test('retry keeps the existing array position of the replaced outcome', () => withRoot((root, plan, outcome) => {
  const first = outcome('P002', 'first position');
  const second = outcome('P001', 'second position');
  const merged = mergeOutcomes(root, plan, [first, second], [outcome('P002', 'revised')], { mode: 'scoped', pids: ['P002'] });
  assert.deepEqual(merged, [outcome('P002', 'revised'), second]);
}));

test('a full review replaces stale outcomes instead of merging with them', () => withRoot((root, plan, outcome) => {
  assert.deepEqual(mergeOutcomes(root, plan, [{ stale: true }], [outcome('P002')], { mode: 'all' }), [outcome('P002')]);
}));

test('unknown, duplicate and out-of-scope response IDs fail', () => withRoot((root, plan, outcome) => {
  assert.throws(() => mergeOutcomes(root, plan, [], [outcome('P001')], { mode: 'scoped', pids: ['P002'] }), /out-of-scope/);
  assert.throws(() => mergeOutcomes(root, plan, [], [outcome('P001'), outcome('P001')], { mode: 'all' }), /duplicate id/);
  assert.throws(() => mergeOutcomes(root, plan, [], [{ ...outcome('P001'), id: 'P999' }], { mode: 'all' }), /unknown id/);
}));

test('CLI rejects malformed response without truncating prior outcomes file', () => withRoot((root, plan) => {
  const file = (name, value) => { const target = path.join(root, name); fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value)); return target; };
  const planFile = file('plan.json', plan);
  const baseFile = file('base.json', []);
  const responseFile = file('response.json', '{broken');
  const outFile = file('out.json', '["preserve"]\n');
  const run = spawnSync(process.execPath, [SCRIPT, root, '--plan', planFile, '--base', baseFile, '--response', responseFile, '--out', outFile, '--mode', 'all'], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.equal(fs.readFileSync(outFile, 'utf8'), '["preserve"]\n');
}));

test('CLI full review overwrites a malformed stale outcomes file', () => withRoot((root, plan, outcome) => {
  const file = (name, value) => { const target = path.join(root, name); fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value)); return target; };
  const planFile = file('plan.json', plan);
  const baseFile = file('base.json', '{stale');
  const responseFile = file('response.json', [outcome('P002')]);
  const outFile = file('out.json', '{old broken file');
  const run = spawnSync(process.execPath, [SCRIPT, root, '--plan', planFile, '--base', baseFile, '--response', responseFile, '--out', outFile, '--mode', 'all'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(outFile, 'utf8')), [outcome('P002')]);
}));
