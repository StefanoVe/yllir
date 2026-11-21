import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatFailingChecks, formatTable } from './metrics-report.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'metrics-report.mjs');
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function group(overrides = {}) {
  return {
    case: 'audit-full',
    model: 'haiku',
    instructions_hash: '746618fdb5e5a3f2',
    runs: 3,
    passed: 2,
    pass_rate: 2 / 3,
    first_date: '2026-11-01T10:00:00.000Z',
    last_date: '2026-11-03T10:00:00.000Z',
    failing_checks: { A1: 2, 'L-time': 1 },
    time_overruns: 1,
    call_overruns: 0,
    median_duration_ms: 90000,
    median_tool_calls: 80,
    total_cost_usd: 0.1234,
    stability: 2 / 3,
    ...overrides,
  };
}

function tempResults(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-results-'));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'x.jsonl'), lines.join('\n'));
  return dir;
}

test('formatTable prints a header, the separator and one row per group in the column order', () => {
  const lines = formatTable([group()]).split('\n');
  assert.equal(lines.length, 3);
  assert.equal(
    lines[0],
    '| case | model | hash | runs | pass | stability | failing checks | time over | calls over | median min | cost $ |',
  );
  assert.equal(lines[1], '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  assert.equal(
    lines[2],
    '| audit-full | haiku | 746618fdb5e5a3f2 | 3 | 2/3 (67%) | 67% | A1×2, L-time×1 | 1 | 0 | 1.5 | 0.123 |',
  );
});

test('formatTable prints - for unknown values and no failing checks', () => {
  const row = formatTable([
    group({ model: 'unknown', instructions_hash: 'unknown', failing_checks: {}, median_duration_ms: null, total_cost_usd: null }),
  ]).split('\n')[2];
  assert.equal(row, '| audit-full | - | - | 3 | 2/3 (67%) | 67% | - | 1 | 0 | - | - |');
});

test('formatFailingChecks sorts by count, then by id', () => {
  assert.equal(formatFailingChecks({ 'L-time': 1, A2: 1, A1: 3 }), 'A1×3, A2×1, L-time×1');
  assert.equal(formatFailingChecks({}), '-');
});

test('formatTable escapes a pipe inside a cell', () => {
  const row = formatTable([group({ case: 'a|b' })]).split('\n')[2];
  assert.ok(row.startsWith('| a\\|b | haiku |'));
});

test('the CLI prints a table for the results folder and exits 0', () => {
  const dir = tempResults([JSON.stringify({ case: 'entry-go-back', run: 1, date: '2026-11-01T00:00:00Z', model: 'haiku', instructions_hash: 'aaaa', pass: true, checks: {} })]);
  const result = spawnSync(process.execPath, [SCRIPT, '--results', dir], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^\| case \| model/m);
  assert.match(result.stdout, /^\| entry-go-back \| haiku \| aaaa \| 1 \| 1\/1 \(100%\)/m);
});

test('the CLI with --json prints the summary array and --case filters it', () => {
  const dir = tempResults([
    JSON.stringify({ case: 'entry-go-back', run: 1, pass: true, model: 'haiku', instructions_hash: 'aaaa', checks: {} }),
    JSON.stringify({ case: 'audit-full', run: 1, pass: false, model: 'haiku', instructions_hash: 'bbbb', checks: {} }),
  ]);
  const result = spawnSync(process.execPath, [SCRIPT, '--results', dir, '--case', 'audit', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const groups = JSON.parse(result.stdout);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].case, 'audit-full');
  assert.equal(groups[0].pass_rate, 0);
});

test('the CLI reports bad lines on stderr and still exits 0', () => {
  const dir = tempResults([
    '{broken',
    JSON.stringify({ case: 'entry-go-back', run: 1, pass: true, checks: {} }),
  ]);
  const result = spawnSync(process.execPath, [SCRIPT, '--results', dir], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /1 bad line\(s\) skipped/);
});

test('the CLI exits 2 on a usage error', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage:/);
});
