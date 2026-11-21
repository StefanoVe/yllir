import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupKey, median, readResults, summarize } from './results.mjs';

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-results-'));
  tempDirs.push(dir);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

function record(overrides = {}) {
  return {
    case: 'entry-go-back',
    run: 1,
    date: '2026-11-01T10:00:00.000Z',
    model: 'haiku',
    instructions_hash: 'aaaa',
    pass: true,
    checks: { E1: true, 'L-time': true, 'L-calls': true },
    failures: [],
    ...overrides,
  };
}

test('readResults reads every jsonl file, skips blank lines and collects bad JSON lines', () => {
  const dir = tempDir({
    'a.jsonl': `${JSON.stringify(record({ run: 1 }))}\n\n${JSON.stringify(record({ run: 2 }))}\n`,
    'b.jsonl': `{not json\n${JSON.stringify(record({ run: 3 }))}`,
    'notes.txt': 'ignored\n',
  });
  const { records, bad } = readResults(dir);
  assert.deepEqual(records.map((r) => r.run), [1, 2, 3]);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].file, 'b.jsonl');
  assert.equal(bad[0].line, 1);
  assert.equal(typeof bad[0].reason, 'string');
});

test('readResults collects a line that is valid JSON but not an object', () => {
  const dir = tempDir({ 'a.jsonl': '42\n[]\n' });
  const { records, bad } = readResults(dir);
  assert.deepEqual(records, []);
  assert.deepEqual(bad.map((b) => b.line), [1, 2]);
});

test('groupKey combines case, model and instructions hash, and tolerates missing fields', () => {
  assert.equal(groupKey(record()), 'entry-go-back|haiku|aaaa');
  assert.equal(groupKey({ case: 'x' }), 'x|unknown|unknown');
});

test('summarize groups by model and hash, not by case alone', () => {
  const groups = summarize([
    record({ run: 1, instructions_hash: 'aaaa' }),
    record({ run: 2, instructions_hash: 'bbbb' }),
    record({ run: 3, instructions_hash: 'bbbb', model: 'sonnet' }),
  ]);
  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((g) => [g.model, g.instructions_hash, g.runs]).sort(),
    [
      ['haiku', 'aaaa', 1],
      ['haiku', 'bbbb', 1],
      ['sonnet', 'bbbb', 1],
    ],
  );
});

test('summarize computes pass rate, stability 2/3 for two passes of three, and the dates', () => {
  const groups = summarize([
    record({ run: 1, pass: true, date: '2026-11-01T10:00:00.000Z' }),
    record({ run: 2, pass: true, date: '2026-11-03T10:00:00.000Z' }),
    record({ run: 3, pass: false, date: '2026-11-02T10:00:00.000Z', checks: { E1: false, 'L-time': false, 'L-calls': true } }),
  ]);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.equal(group.runs, 3);
  assert.equal(group.passed, 2);
  assert.equal(group.pass_rate, 2 / 3);
  assert.equal(group.stability, 2 / 3);
  assert.equal(group.first_date, '2026-11-01T10:00:00.000Z');
  assert.equal(group.last_date, '2026-11-03T10:00:00.000Z');
  assert.deepEqual(group.failing_checks, { E1: 1, 'L-time': 1 });
  assert.equal(group.time_overruns, 1);
  assert.equal(group.call_overruns, 0);
});

test('summarize puts the group with the newest record first within a case and model', () => {
  const groups = summarize([
    record({ instructions_hash: 'old', date: '2026-10-01T00:00:00.000Z' }),
    record({ instructions_hash: 'new', date: '2026-11-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(groups.map((g) => g.instructions_hash), ['new', 'old']);
});

test('summarize medians and costs ignore unknown values, and null when none is known', () => {
  const groups = summarize([
    record({ duration_ms: 1000, tool_calls: 10, cost_usd: 0.5 }),
    record({ duration_ms: 3000, tool_calls: 20 }),
    record({ duration_ms: 2000, tool_calls: 30, cost_usd: 0.25 }),
  ]);
  assert.equal(groups[0].median_duration_ms, 2000);
  assert.equal(groups[0].median_tool_calls, 20);
  assert.equal(groups[0].total_cost_usd, 0.75);

  const bare = summarize([record({ duration_ms: undefined, tool_calls: undefined, cost_usd: undefined })]);
  assert.equal(bare[0].median_duration_ms, null);
  assert.equal(bare[0].median_tool_calls, null);
  assert.equal(bare[0].total_cost_usd, null);
});

test('summarize does not crash on records with missing fields', () => {
  const groups = summarize([{ case: 'old-case', pass: true }, { checks: 'not an object' }, {}]);
  assert.equal(groups.length, 2);
  const oldCase = groups.find((g) => g.case === 'old-case');
  assert.equal(oldCase.model, 'unknown');
  assert.equal(oldCase.instructions_hash, 'unknown');
  assert.equal(oldCase.last_date, null);
  assert.deepEqual(oldCase.failing_checks, {});
  assert.equal(oldCase.stability, 1);
});

test('median takes the middle value, or the mean of the two middle values, or null', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});
