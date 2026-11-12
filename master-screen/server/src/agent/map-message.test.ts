import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Ctx } from '../context.js';
import { TEXTS } from '../chat/text.js';
import type { AgentEvent } from './provider.js';
import { mapMessage, type RunState } from './claude-provider.js';

const ctx = { log: () => undefined } as unknown as Ctx;
const T = TEXTS.en;

function run(messages: unknown[]): AgentEvent[] {
  const state: RunState = { finished: false, answer: '' };
  const events: AgentEvent[] = [];
  for (const message of messages) {
    events.push(...mapMessage(message as SDKMessage, state, ctx, 'en'));
  }
  return events;
}

const assistant = (content: unknown[]) => ({ type: 'assistant', message: { content } });
const result = { type: 'result', subtype: 'success', is_error: false };
const toolResult = { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } };
const deltas = (events: AgentEvent[]) => events.filter((e) => e.type === 'delta');

describe('mapMessage: progress and answer', () => {
  it('turns intermediate narration into activity and streams only the final answer once', () => {
    const events = run([
      { type: 'system', subtype: 'init', session_id: 'abc' },
      assistant([
        { type: 'text', text: 'Pending migration: read post-update.md.' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/x/post-update.md' } },
      ]),
      toolResult,
      assistant([{ type: 'text', text: 'The answer for the master.' }]),
      result,
    ]);

    assert.deepEqual(events[0], { type: 'resume', id: 'abc' });
    // The first assistant message: narration (unsafe, so the generic text), then the tool sentence.
    assert.equal(events[1].type, 'activity');
    assert.equal((events[1] as { text: string }).text, T.working);
    assert.deepEqual(events[2], { type: 'activity', text: T.reading });
    assert.deepEqual(deltas(events), [{ type: 'delta', text: 'The answer for the master.' }]);
    assert.deepEqual(events[events.length - 1], { type: 'done' });
    assert.equal(events.filter((e) => e.type === 'delta').length, 1);
  });

  it('streams the answer of a run that used no tool, then done', () => {
    const events = run([assistant([{ type: 'text', text: 'Hello.' }]), result]);
    assert.deepEqual(events, [
      { type: 'delta', text: 'Hello.' },
      { type: 'done' },
    ]);
  });

  it('sends done alone when the final text is empty', () => {
    const events = run([assistant([{ type: 'tool_use', name: 'Glob', input: {} }]), toolResult, assistant([]), result]);
    assert.deepEqual(deltas(events), []);
    assert.deepEqual(events[events.length - 1], { type: 'done' });
  });

  it('strips a leading narration line from the final answer', () => {
    const events = run([
      assistant([{ type: 'text', text: 'Migration check\n\nReal answer.' }]),
      result,
    ]);
    assert.deepEqual(deltas(events), [{ type: 'delta', text: 'Real answer.' }]);
  });

  it('ignores sub-agent messages', () => {
    const events = run([
      { ...assistant([{ type: 'text', text: 'Inner.' }]), parent_tool_use_id: 'task-1' },
      result,
    ]);
    assert.deepEqual(events, [{ type: 'done' }]);
  });

  it('reports a failed run as an error and drops the held answer', () => {
    const events = run([
      assistant([{ type: 'text', text: 'Partial.' }]),
      { type: 'result', subtype: 'error_max_turns', is_error: true },
    ]);
    assert.deepEqual(events, [{ type: 'error', message: T.tooLong }]);
  });
});
