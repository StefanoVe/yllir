import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'aggregate-reviews.mjs');
const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function fixture(values) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-review-'));
  dirs.push(dir);
  const inputs = values.map((value, i) => {
    const file = path.join(dir, `review-${i + 1}.json`);
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  });
  return { dir, inputs, out: path.join(dir, 'review.json') };
}
function run(fx) {
  return spawnSync(process.execPath, [cli, '--out', fx.out, ...fx.inputs], { encoding: 'utf8' });
}
const item = (document, problem) => ({ document, problem, evidence: `${document}:2` });

test('aggregates ordered items and applies ASK > FIX > APPLY with first ASK question', () => {
  const fx = fixture([
    { outcome: 'FIX', items: [item('a.md', 'fix a')] },
    { outcome: 'ASK', question: 'first question', items: [item('b.md', 'ask b')] },
    { outcome: 'ASK', question: 'second question', items: [item('c.md', 'ask c')] },
  ]);
  const result = run(fx);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(fx.out, 'utf8')), {
    outcome: 'ASK', question: 'first question', items: [item('a.md', 'fix a'), item('b.md', 'ask b'), item('c.md', 'ask c')],
  });
});

test('FIX wins over APPLY and APPLY remains APPLY when all documents pass', () => {
  let fx = fixture([{ outcome: 'APPLY', items: [] }, { outcome: 'FIX', items: [item('x.md', 'problem')] }]);
  assert.equal(run(fx).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(fx.out, 'utf8')).outcome, 'FIX');
  fx = fixture([{ outcome: 'APPLY', items: [] }, { outcome: 'APPLY', items: [] }]);
  assert.equal(run(fx).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(fx.out, 'utf8')), { outcome: 'APPLY', items: [] });
});

test('rejects malformed responses, missing item evidence, and unknown outcomes without an output', () => {
  for (const value of [
    { outcome: 'OTHER', items: [] },
    { outcome: 'FIX', items: [{ document: 'a.md', problem: 'x' }] },
    { outcome: 'ASK', question: '', items: [] },
    { outcome: 'FIX', items: [] },
    'not-json',
  ]) {
    const fx = fixture([value]);
    const result = run(fx);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(fx.out), false);
  }
});
