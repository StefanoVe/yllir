// Unit tests for parseStream (the stream-json parser behind runClaude), parseCommonArgs,
// recordHeader and printSummary.
// Run with: node --test testbench/runners/lib/case-common.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStream, parseCommonArgs, recordHeader, printSummary, parseLimits, applyLimits } from './case-common.mjs';

const USAGE = 'usage: test <caseDir>';
const CASE = ['case-dir'];

const lines = (...objects) => objects.map((o) => JSON.stringify(o)).join('\n');

const sample = lines(
  { type: 'system', subtype: 'init' },
  {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', id: 'a1', name: 'Bash', input: { command: 'ls campaign' } }] },
  },
  {
    type: 'user',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'campaign.yaml' }] },
  },
  {
    type: 'assistant',
    parent_tool_use_id: 'agent1',
    message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'rm -rf campaign' } }] },
  },
  {
    type: 'user',
    parent_tool_use_id: 'agent1',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'b1',
          is_error: true,
          content: [{ type: 'text', text: 'Permission for this tool use was denied. Use another approach.' }],
        },
      ],
    },
  },
  { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.12, duration_ms: 4000, num_turns: 3 },
);

test('returns the final result line fields', () => {
  const { result } = parseStream(sample);
  assert.equal(result.result, 'done');
  assert.equal(result.total_cost_usd, 0.12);
  assert.equal(result.duration_ms, 4000);
  assert.equal(result.num_turns, 3);
});

test('counts every tool_use block', () => {
  assert.equal(parseStream(sample).tool_calls, 2);
});

test('records the refused call of the sub-agent and not the allowed one', () => {
  assert.deepEqual(parseStream(sample).denied, [{ name: 'Bash', input: 'rm -rf campaign', sub: true }]);
});

test('an allowed run has an empty denied list', () => {
  const text = lines(
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input: { file_path: 'a.md' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'text' }] } },
    { type: 'result', result: 'ok' },
  );
  const parsed = parseStream(text);
  assert.deepEqual(parsed.denied, []);
  assert.equal(parsed.tool_calls, 1);
});

test('summarises the input per tool and detects "requires approval"', () => {
  const text = lines(
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 's', name: 'Skill', input: { skill: 'linker' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'g', name: 'Agent', input: { subagent_type: 'audit-judge', prompt: 'p' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'w', name: 'Write', input: { file_path: 'x/y.md', content: 'c' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 's', content: 'This tool requires approval' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'g', content: 'ok' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'w', content: 'Permission for this tool use was denied' }] } },
  );
  const parsed = parseStream(text);
  assert.deepEqual(parsed.denied, [
    { name: 'Skill', input: 'linker', sub: false },
    { name: 'Write', input: 'x/y.md', sub: false },
  ]);
  assert.equal(parsed.tool_calls, 3);
});

test('truncates the denied input to 300 characters', () => {
  const long = `echo ${'x'.repeat(400)}`;
  const text = lines(
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'l', name: 'Bash', input: { command: long } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'l', content: 'requires approval' }] } },
  );
  assert.equal(parseStream(text).denied[0].input, long.slice(0, 300));
});

test('skips lines that are not JSON and reports no result when absent', () => {
  const text = `not json at all\n${lines({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'z', name: 'Bash', input: { command: 'ls' } }] } })}\n\n`;
  const parsed = parseStream(text);
  assert.equal(parsed.result, null);
  assert.equal(parsed.tool_calls, 1);
  assert.deepEqual(parsed.denied, []);
});

test('parseCommonArgs defaults to claude with sonnet', () => {
  const opts = parseCommonArgs(CASE, USAGE);
  assert.equal(opts.agent, 'claude');
  assert.equal(opts.model, 'sonnet');
  assert.equal(opts.modelGiven, false);
  assert.equal(opts.modelLabel, 'sonnet');
});

test('parseCommonArgs --model overrides the sonnet default', () => {
  const opts = parseCommonArgs([...CASE, '--model', 'haiku'], USAGE);
  assert.equal(opts.model, 'haiku');
  assert.equal(opts.modelGiven, true);
});

test('parseCommonArgs labels a claude run with its model', () => {
  const opts = parseCommonArgs([...CASE, '--model', 'sonnet'], USAGE);
  assert.equal(opts.agent, 'claude');
  assert.equal(opts.modelGiven, true);
  assert.equal(opts.modelLabel, 'sonnet');
});

test('parseCommonArgs accepts an explicit --agent claude', () => {
  const opts = parseCommonArgs([...CASE, '--agent', 'claude'], USAGE);
  assert.equal(opts.agent, 'claude');
  assert.equal(opts.modelLabel, 'sonnet');
});

test('parseCommonArgs rejects codex with a message that names claude', () => {
  assert.throws(() => parseCommonArgs([...CASE, '--agent', 'codex'], USAGE), (err) => {
    assert.equal(err.message, `codex is no longer a test agent: use --agent claude\n${USAGE}`);
    return true;
  });
});

test('parseCommonArgs rejects an unknown agent with the usage text', () => {
  assert.throws(() => parseCommonArgs([...CASE, '--agent', 'bogus'], USAGE), (err) => {
    assert.equal(err.message, `--agent must be claude\n${USAGE}`);
    return true;
  });
  assert.throws(() => parseCommonArgs([...CASE, '--agent'], USAGE), /--agent must be claude/);
});

test('recordHeader returns the agent and the model label', () => {
  assert.deepEqual(recordHeader({ agent: 'claude', modelLabel: 'haiku' }), {
    agent: 'claude',
    model: 'haiku',
  });
});

test('parseLimits returns null without limits and keeps only the given keys', () => {
  assert.equal(parseLimits({ case: 'x' }), null);
  assert.deepEqual(parseLimits({ limits: { max_minutes: 4, max_tool_calls: 60 } }), { max_minutes: 4, max_tool_calls: 60 });
  assert.deepEqual(parseLimits({ limits: { max_minutes: 2.5 } }), { max_minutes: 2.5 });
});

test('parseLimits rejects a value that is not a positive number or a mapping', () => {
  assert.throws(() => parseLimits({ limits: { max_minutes: 'four' } }), /limits.max_minutes must be a positive number/);
  assert.throws(() => parseLimits({ limits: { max_tool_calls: 0 } }), /limits.max_tool_calls must be a positive number/);
  assert.throws(() => parseLimits({ limits: [4] }), /limits must be a mapping/);
});

test('applyLimits adds L-time and L-calls, and fails the run when a limit is exceeded', () => {
  const graded = { checks: { B1: true }, failures: [], pass: true };
  const limits = { max_minutes: 4, max_tool_calls: 60 };
  const inside = applyLimits(graded, limits, { duration_ms: 3 * 60000, tool_calls: 60 });
  assert.deepEqual(inside.checks, { B1: true, 'L-time': true, 'L-calls': true });
  assert.equal(inside.pass, true);
  assert.deepEqual(inside.failures, []);

  const slow = applyLimits(graded, limits, { duration_ms: 5 * 60000, tool_calls: 10 });
  assert.equal(slow.checks['L-time'], false);
  assert.equal(slow.checks['L-calls'], true);
  assert.equal(slow.pass, false);
  assert.match(slow.failures[0], /^L-time 5\.0 min \(limit 4 min\)$/);

  const many = applyLimits(graded, limits, { duration_ms: 60000, tool_calls: 61 });
  assert.equal(many.checks['L-calls'], false);
  assert.match(many.failures[0], /^L-calls 61 tool calls \(limit 60\)$/);
});

test('applyLimits fails a limit whose value was not measured, and skips limits the case does not declare', () => {
  const graded = { checks: {}, failures: [], pass: true };
  const unmeasured = applyLimits(graded, { max_minutes: 4 }, { duration_ms: null, tool_calls: null });
  assert.equal(unmeasured.checks['L-time'], false);
  assert.equal(unmeasured.checks['L-calls'], undefined);
  assert.equal(unmeasured.failures[0], 'L-time duration not measured (limit 4 min)');
  assert.equal(applyLimits(graded, null, { duration_ms: 1, tool_calls: 1 }), graded);
});

test('printSummary names the agent only when it is given', () => {
  const results = [{ run: 1, pass: true, failures: [] }];
  const printed = [];
  const original = console.log;
  console.log = (text) => printed.push(text);
  try {
    assert.equal(printSummary(results, 'haiku', 'abc', 'claude'), 1);
    assert.equal(printSummary(results, 'haiku', 'abc'), 1);
  } finally {
    console.log = original;
  }
  const [withAgent, withoutAgent] = printed.map((text) => text.split('\n').pop());
  assert.equal(withAgent, 'pass rate: 1/1  agent: claude  model: haiku  instructions: abc');
  assert.equal(withoutAgent, 'pass rate: 1/1  model: haiku  instructions: abc');
});
