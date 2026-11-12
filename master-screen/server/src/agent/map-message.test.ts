import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

function runWith(messages: unknown[], runCtx: Ctx, lang: 'it' | 'en'): AgentEvent[] {
  const state: RunState = { finished: false, answer: '' };
  return messages.flatMap((message) => mapMessage(message as SDKMessage, state, runCtx, lang));
}

const steps = (events: AgentEvent[]) => events.filter((e) => e.type === 'step');

describe('mapMessage: precise steps', () => {
  it('starts one step per tool use with the block id, after its activity sentence', () => {
    const events = run([assistant([{ type: 'tool_use', id: 'tu-1', name: 'Glob', input: {} }])]);
    assert.deepEqual(events, [
      { type: 'activity', text: T.searching },
      { type: 'step', id: 'tu-1', kind: 'search', text: T.searching },
    ]);
  });

  it('names a campaign document by its title in Italian and in English', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-map-'));
    try {
      fs.mkdirSync(path.join(dir, 'places'));
      fs.writeFileSync(path.join(dir, 'places', 'porto.md'), '\n# Taverna del Porto\n\nTesto.\n');
      const runCtx = { log: () => undefined, campaignRoot: dir, frameworkRoot: path.join(dir, 'yllir') } as unknown as Ctx;
      const read = [assistant([{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: path.join(dir, 'places', 'porto.md') } }])];
      const it = runWith(read, runCtx, 'it');
      assert.deepEqual(steps(it), [{ type: 'step', id: 'r', kind: 'read', text: 'Sto leggendo «Taverna del Porto»…' }]);
      const en = runWith(read, runCtx, 'en');
      assert.deepEqual(steps(en), [{ type: 'step', id: 'r', kind: 'read', text: 'Reading “Taverna del Porto”…' }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says it re-reads its instructions for a framework file, in Italian', () => {
    const runCtx = { log: () => undefined, campaignRoot: '/camp', frameworkRoot: '/opt/yllir' } as unknown as Ctx;
    const events = runWith(
      [assistant([{ type: 'tool_use', id: 'i', name: 'Read', input: { file_path: '/opt/yllir/skills/library/images/SKILL.md' } }])],
      runCtx,
      'it',
    );
    assert.deepEqual(steps(events), [{ type: 'step', id: 'i', kind: 'read', text: 'Sto rileggendo le mie istruzioni…' }]);
  });

  it('maps the image and Photoshop tools to image steps without naming a service', () => {
    const skill = run([assistant([{ type: 'tool_use', id: 's', name: 'Skill', input: { skill: 'yllir:images' } }])]);
    assert.deepEqual(steps(skill), [{ type: 'step', id: 's', kind: 'image', text: T.skills.images }]);
    const ps = run([assistant([{ type: 'tool_use', id: 'p', name: 'mcp__plugin_yllir_photoshop__photoshop_generate_image', input: {} }])]);
    assert.deepEqual(steps(ps), [{ type: 'step', id: 'p', kind: 'image', text: 'Retouching the image…' }]);
    const gen = run([
      assistant([
        {
          type: 'tool_use',
          id: 'g',
          name: 'Bash',
          input: { command: 'node "/opt/yllir/skills/library/images/providers/codex/scripts/codex-run.mjs" "/camp/.campaign/state/x"' },
        },
      ]),
    ]);
    assert.deepEqual(steps(gen), [{ type: 'step', id: 'g', kind: 'image', text: T.imageRender }]);
    assert.ok(!JSON.stringify(gen).toLowerCase().includes('codex'));
  });

  it('marks the steps of a sub-agent with its parent and never makes them the answer', () => {
    const events = run([
      { ...assistant([{ type: 'tool_use', id: 'inner', name: 'Read', input: {} }]), parent_tool_use_id: 'task-9' },
      { ...assistant([{ type: 'text', text: 'Interno.' }]), parent_tool_use_id: 'task-9' },
      result,
    ]);
    assert.deepEqual(steps(events), [{ type: 'step', id: 'inner', kind: 'read', text: T.reading, parentId: 'task-9' }]);
    assert.deepEqual(events.filter((e) => e.type === 'error' || e.type === 'delta'), []);
    assert.deepEqual(events[events.length - 1], { type: 'done' });
  });

  it('ends a step on its tool result, failed when the result is an error', () => {
    const events = run([
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a' }, { type: 'tool_result', tool_use_id: 'b', is_error: true }] } },
    ]);
    assert.deepEqual(events, [
      { type: 'step-end', id: 'a', ok: true },
      { type: 'step-end', id: 'b', ok: false },
    ]);
  });
});

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
