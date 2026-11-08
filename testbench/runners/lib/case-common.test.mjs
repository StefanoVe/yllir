// Unit tests for parseStream, the stream-json parser behind runClaude.
// Run with: node --test testbench/runners/lib/case-common.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStream } from './case-common.mjs';

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
