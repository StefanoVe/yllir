import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { AlignStatus } from '../../../shared/src/types.js';
import { createChatService, type ChatService } from '../chat/index.js';
import { createCtx, type Ctx } from '../context.js';
import { createFakeProvider } from '../agent/fake-provider.js';
import { makeCampaign } from '../live/test-support.js';
import { AlignService, createAlignService } from './align.js';
import { ALIGN_MODEL, ALIGN_PROMPT, ALIGN_TEXTS } from './align-text.js';
import type { AgentEvent, AgentProvider } from '../agent/provider.js';

const EN = ALIGN_TEXTS.en;
const cleanups: Array<() => Promise<void> | void> = [];
after(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

interface Setup {
  ctx: Ctx;
  chat: ChatService;
  align: AlignService;
  pending: { value: boolean };
  agent: { available: boolean; reason?: string };
  provider: ReturnType<typeof createFakeProvider>;
}

function setup(script: AgentEvent[], opts: { hang?: boolean; pending?: boolean; provider?: AgentProvider } = {}): Setup {
  const root = makeCampaign({}, 'en');
  const logs: string[] = [];
  const agent = { available: true } as { available: boolean; reason?: string };
  const ctx = createCtx({
    campaignRoot: root,
    frameworkRoot: path.join(root, 'framework'),
    port: 0,
    log: (msg) => logs.push(msg),
    agentStatus: () => agent,
  });
  const provider = createFakeProvider(script, { hang: opts.hang });
  const chat = createChatService(ctx, opts.provider ?? provider, { idleTimeoutMs: 5000, hardLimitMs: 5000, headSha: async () => '' });
  ctx.chat = chat;
  const pending = { value: opts.pending ?? true };
  const align = createAlignService(ctx, { check: async () => pending.value });
  cleanups.push(async () => {
    await chat.runner.close();
    await ctx.closeAll();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { ctx, chat, align, pending, agent, provider };
}

/** Polls the status until its state is `state`, or fails after a few seconds. */
async function until(align: AlignService, state: AlignStatus['state']): Promise<AlignStatus> {
  const started = Date.now();
  for (;;) {
    const status = await align.status();
    if (status.state === state) return status;
    if (Date.now() - started > 4000) throw new Error(`timed out waiting for ${state}, last ${status.state}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('alignment status', () => {
  it('is none when the framework has nothing to align', async () => {
    const s = setup([], { pending: false });
    assert.deepEqual(await s.align.status(), { state: 'none', conversationId: null });
  });

  it('is needed when the framework says so, and start is then refused when it is not needed', async () => {
    const s = setup([], { pending: true });
    assert.deepEqual(await s.align.status(), { state: 'needed', conversationId: null });
    s.pending.value = false;
    s.align = createAlignService(s.ctx, { check: async () => false });
    const refused = await s.align.start();
    assert.deepEqual(refused, { ok: false, code: 409, error: EN.notNeeded });
  });

  it('answers 503 with the reason when the agent is not available', async () => {
    const s = setup([]);
    s.agent.available = false;
    s.agent.reason = 'No Claude Code found';
    const refused = await s.align.start();
    assert.deepEqual(refused, { ok: false, code: 503, error: 'No Claude Code found' });
    assert.equal(s.ctx.chat?.store.conversations().length, 1, 'no conversation is created');
  });
});

describe('alignment run', () => {
  it('starts one sonnet turn in a new conversation, and is done when the framework says so afterwards', async () => {
    const s = setup([{ type: 'delta', text: 'Done.' }, { type: 'done' }]);
    const started = await s.align.start();
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.status.state, 'running');
    const conversationId = started.status.conversationId as string;
    assert.ok(conversationId);

    const call = s.provider.calls[0];
    assert.equal(call.prompt, ALIGN_PROMPT);
    assert.equal(call.model, ALIGN_MODEL);
    assert.equal(call.model, 'sonnet');
    assert.ok(s.ctx.chat?.store.has(conversationId));

    s.pending.value = false;
    const done = await until(s.align, 'done');
    assert.deepEqual(done, { state: 'done', conversationId });
    assert.equal(s.align.busy(), false);
  });

  it('waits for the master when the framework still needs the alignment after the turn', async () => {
    const s = setup([{ type: 'delta', text: 'Which way?' }, { type: 'done' }]);
    const started = await s.align.start();
    assert.equal(started.ok, true);
    const waiting = await until(s.align, 'waiting-answer');
    assert.equal(waiting.conversationId, s.ctx.chat?.store.currentId());
    assert.equal(s.align.busy(), true);
    assert.equal(s.align.applyBlocked(), ALIGN_TEXTS.en.alignBusy);
  });

  it('runs again when the master answers in the same conversation, and waits again after it', async () => {
    const s = setup([{ type: 'delta', text: 'Ok.' }, { type: 'done' }]);
    const started = await s.align.start();
    assert.equal(started.ok, true);
    const waiting = await until(s.align, 'waiting-answer');
    const conversationId = waiting.conversationId as string;

    const answered = await s.chat.runner.submit(conversationId, 'Continue.', {});
    assert.ok(answered);
    const again = await until(s.align, 'waiting-answer');
    assert.equal(again.conversationId, conversationId);
    assert.equal(s.provider.calls.length, 2);
  });

  it('is failed when the turn errors, and a start again is allowed as a retry', async () => {
    const s = setup([{ type: 'error', message: 'boom' }]);
    const started = await s.align.start();
    assert.equal(started.ok, true);
    const failed = await until(s.align, 'failed');
    assert.equal(failed.state, 'failed');
    assert.ok(failed.conversationId);

    const retry = await s.align.start();
    assert.equal(retry.ok, true, 'a failed run can be started again');
    await until(s.align, 'failed');
  });

  it('refuses a second start while a run is active, and says so', async () => {
    const s = setup([{ type: 'delta', text: '...' }], { hang: true });
    const started = await s.align.start();
    assert.equal(started.ok, true);
    const second = await s.align.start();
    assert.deepEqual(second, { ok: false, code: 409, error: EN.alreadyRunning });
    const status = await s.align.status();
    assert.equal(status.state, 'running');
    assert.equal(s.align.applyBlocked(), ALIGN_TEXTS.en.alignBusy);
  });

  it('a turn of another conversation does not move the alignment', async () => {
    const s = setup([{ type: 'done' }]);
    const other = await s.ctx.chat?.store.createConversation();
    assert.ok(other);
    const started = await s.align.start();
    assert.equal(started.ok, true);
    await until(s.align, 'waiting-answer');
    await s.chat.runner.submit(other.id, 'Ciao', {});
    assert.equal((await s.align.status()).state, 'waiting-answer');
  });
});
