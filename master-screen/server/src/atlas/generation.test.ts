import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, describe, it } from 'node:test';
import { createChatService, type ChatService } from '../chat/index.js';
import { createCtx, type Ctx } from '../context.js';
import { createFakeProvider } from '../agent/fake-provider.js';
import type { AgentEvent, AgentProvider } from '../agent/provider.js';
import { makeCampaign } from '../live/test-support.js';
import { createAtlasService, type AtlasService } from './service.js';
import { asksQuestion, type AtlasGenerationSnapshot } from './generation.js';
import { ATLAS_PROMPTS, ATLAS_TEXTS } from './texts.js';
import { atlasStatus, makeFakeAtlasCli, NO_ATLAS, type FakeAtlasCli } from './test-support.js';

const EN = ATLAS_TEXTS.en;
const cleanups: Array<() => Promise<void> | void> = [];
after(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

interface Setup {
  ctx: Ctx;
  chat: ChatService;
  service: AtlasService;
  fake: FakeAtlasCli;
  provider: ReturnType<typeof createFakeProvider>;
  agent: { available: boolean; reason?: string };
}

async function setup(
  script: AgentEvent[],
  opts: { hang?: boolean; delayMs?: number; provider?: AgentProvider } = {},
): Promise<Setup> {
  const root = makeCampaign({}, 'en');
  const fake = await makeFakeAtlasCli();
  const agent = { available: true } as { available: boolean; reason?: string };
  const ctx = createCtx({
    campaignRoot: root,
    frameworkRoot: fake.frameworkRoot,
    port: 0,
    log: () => {},
    agentStatus: () => agent,
  });
  const provider = createFakeProvider(script, { hang: opts.hang, delayMs: opts.delayMs });
  const chat = createChatService(ctx, opts.provider ?? provider, {
    idleTimeoutMs: 5000,
    hardLimitMs: 5000,
    headSha: async () => '',
  });
  ctx.chat = chat;
  const service = createAtlasService(ctx);
  cleanups.push(async () => {
    await chat.runner.close();
    await ctx.closeAll();
    await fake.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { ctx, chat, service, fake, provider, agent };
}

/** Polls the generation until its state is `state`, or fails after a few seconds. */
async function until(service: AtlasService, state: AtlasGenerationSnapshot['state']): Promise<AtlasGenerationSnapshot> {
  const started = Date.now();
  for (;;) {
    const snapshot = service.generation.snapshot();
    if (snapshot.state === state) return snapshot;
    if (Date.now() - started > 8000) throw new Error(`timed out waiting for ${state}, last ${snapshot.state}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('atlas generation: refusals', () => {
  it('refuses create while the atlas exists, and creates no conversation', async () => {
    const s = await setup([{ type: 'done' }]);
    await s.fake.respond('status', atlasStatus(0));
    const before = s.chat.store.conversations().length;
    const refused = await s.service.generation.start('create');
    assert.deepEqual(refused, { ok: false, code: 409, error: EN.alreadyExists });
    assert.equal(s.chat.store.conversations().length, before);
  });

  it('refuses update while there is no atlas', async () => {
    const s = await setup([{ type: 'done' }]);
    await s.fake.respond('status', NO_ATLAS);
    const refused = await s.service.generation.start('update');
    assert.deepEqual(refused, { ok: false, code: 409, error: EN.noAtlas });
    assert.equal(s.provider.calls.length, 0);
  });

  it('refuses with the reason when the agent is not available, and creates no conversation', async () => {
    const s = await setup([{ type: 'done' }]);
    await s.fake.respond('status', NO_ATLAS);
    s.agent.available = false;
    s.agent.reason = 'No Claude Code found';
    const before = s.chat.store.conversations().length;
    const refused = await s.service.generation.start('create');
    assert.deepEqual(refused, { ok: false, code: 503, error: 'No Claude Code found' });
    assert.equal(s.chat.store.conversations().length, before);
  });

  it('refuses a second start while a run is active, and says so', async () => {
    const s = await setup([{ type: 'delta', text: '...' }], { hang: true });
    await s.fake.respond('status', NO_ATLAS);
    const started = await s.service.generation.start('create');
    assert.equal(started.ok, true);
    const second = await s.service.generation.start('create');
    assert.deepEqual(second, { ok: false, code: 409, error: EN.alreadyRunning });
    assert.equal(s.service.generation.running(), true);
    assert.equal(s.service.generation.snapshot().state, 'running');
  });
});

describe('atlas generation: the run', () => {
  it('runs the fixed create prompt with the default model, and is done with places still pending when the assistant asks nothing', async () => {
    const s = await setup([{ type: 'delta', text: 'The atlas has two places still unplaced.' }, { type: 'done' }]);
    await s.fake.respond('status', NO_ATLAS);
    const started = await s.service.generation.start('create');
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(s.service.generation.snapshot().mode, 'create');

    await s.fake.respond('status', atlasStatus(2, { locked: true }));
    const done = await until(s.service, 'done');
    assert.equal(done.conversationId, started.conversationId);
    assert.equal(done.mode, 'create');

    const call = s.provider.calls[0];
    assert.equal(call.prompt, ATLAS_PROMPTS.create);
    assert.equal(call.model, undefined, 'no model override: the chat default runs the atlas');
    assert.equal(s.service.generation.running(), false);
  });

  it('is done when the atlas exists and the assistant asks nothing (nothing pending)', async () => {
    const s = await setup([{ type: 'delta', text: 'The atlas is ready.' }, { type: 'done' }], { delayMs: 150 });
    await s.fake.respond('status', NO_ATLAS);
    const started = await s.service.generation.start('create');
    assert.equal(started.ok, true);
    await s.fake.respond('status', atlasStatus(0, { locked: true }));
    const done = await until(s.service, 'done');
    assert.equal(done.conversationId, started.ok ? started.conversationId : null);
    assert.equal(done.mode, 'create');
    assert.equal(s.service.generation.running(), false);
  });

  it('waits for the master when the atlas exists and the last message is not a question, but the land is not approved', async () => {
    const s = await setup([{ type: 'delta', text: 'The land is drawn. Open the Atlas section to see it.' }, { type: 'done' }], { delayMs: 150 });
    await s.fake.respond('status', NO_ATLAS);
    await s.service.generation.start('create');
    await s.fake.respond('status', atlasStatus(0));
    await until(s.service, 'waiting-answer');
  });

  it('is done when the atlas exists, the land is locked and the last message is not a question', async () => {
    const s = await setup([{ type: 'delta', text: 'The land is locked. Open the Atlas section to see it.' }, { type: 'done' }], { delayMs: 150 });
    await s.fake.respond('status', NO_ATLAS);
    await s.service.generation.start('create');
    await s.fake.respond('status', atlasStatus(0, { locked: true }));
    await until(s.service, 'done');
  });

  it('is done for an urban atlas only when its ground is locked', async () => {
    const s = await setup([{ type: 'delta', text: 'The ground is locked. Open the Atlas section to see it.' }, { type: 'done' }], { delayMs: 150 });
    await s.fake.respond('status', NO_ATLAS);
    const started = await s.service.generation.start('create');
    assert.equal(started.ok, true);
    if (!started.ok) return;
    await s.fake.respond('status', atlasStatus(0, { layer: 'ground', locked: false }));
    await until(s.service, 'waiting-answer');

    await s.fake.respond('status', atlasStatus(0, { layer: 'ground', locked: true }));
    await s.chat.runner.submit(started.conversationId, 'Yes, lock the ground.', {});
    await until(s.service, 'done');
  });

  it('settles to done after the master answers and the assistant locks the land', async () => {
    const s = await setup([{ type: 'delta', text: 'Here is the land. Open the Atlas section to see it.' }, { type: 'done' }], { delayMs: 150 });
    await s.fake.respond('status', NO_ATLAS);
    const started = await s.service.generation.start('create');
    assert.equal(started.ok, true);
    if (!started.ok) return;
    await s.fake.respond('status', atlasStatus(0));
    await until(s.service, 'waiting-answer');

    await s.fake.respond('status', atlasStatus(0, { locked: true }));
    await s.chat.runner.submit(started.conversationId, 'Yes, lock the land.', {});
    await until(s.service, 'done');
  });

  it('stays waiting for the master when the assistant ends with a question, even if the atlas exists', async () => {
    const s = await setup([{ type: 'delta', text: 'Is the coast approved?' }, { type: 'done' }], { delayMs: 150 });
    await s.fake.respond('status', NO_ATLAS);
    await s.service.generation.start('create');
    await s.fake.respond('status', atlasStatus(0));
    await until(s.service, 'waiting-answer');
  });

  it('stays waiting for the master with a question, even while places are pending', async () => {
    const s = await setup([{ type: 'delta', text: 'Which place next?' }, { type: 'done' }], { delayMs: 150 });
    await s.fake.respond('status', atlasStatus(2));
    await s.service.generation.start('update');
    await s.fake.respond('status', atlasStatus(2));
    await until(s.service, 'waiting-answer');
  });

  it('is waiting-answer, not done, when the atlas does not exist after a normal end', async () => {
    const s = await setup([{ type: 'delta', text: 'The map is drawn.' }, { type: 'done' }], { delayMs: 150 });
    await s.fake.respond('status', NO_ATLAS);
    await s.service.generation.start('create');
    await until(s.service, 'waiting-answer');
  });

  it('is failed when the turn errors, and a start again is allowed as a retry', async () => {
    const s = await setup([{ type: 'error', message: 'boom' }]);
    await s.fake.respond('status', NO_ATLAS);
    const started = await s.service.generation.start('create');
    assert.equal(started.ok, true);
    await until(s.service, 'failed');
    const retry = await s.service.generation.start('create');
    assert.equal(retry.ok, true, 'a failed run can be started again');
  });

  it('runs the update prompt for places to place, once an atlas exists', async () => {
    const s = await setup([{ type: 'delta', text: 'Placed.' }, { type: 'done' }], { delayMs: 150 });
    await s.fake.respond('status', atlasStatus(2));
    const started = await s.service.generation.start('update');
    assert.equal(started.ok, true);
    assert.equal(s.provider.calls[0]?.prompt, ATLAS_PROMPTS.update);
    await s.fake.respond('status', atlasStatus(0, { locked: true }));
    const done = await until(s.service, 'done');
    assert.equal(done.mode, 'update');
  });

  it('notifies the screen when a turn ends', async () => {
    const s = await setup([{ type: 'delta', text: 'Ok.' }, { type: 'done' }]);
    await s.fake.respond('status', NO_ATLAS);
    const events: string[] = [];
    const bus = s.ctx.bus as unknown as { publish: (event: string, data: unknown) => number };
    const original = bus.publish.bind(s.ctx.bus);
    bus.publish = (event, data) => {
      events.push(event);
      return original(event, data);
    };
    await s.service.generation.start('create');
    await until(s.service, 'waiting-answer');
    assert.ok(events.includes('conversations'), 'the screen is told that the conversations changed');
  });
});

describe('asksQuestion', () => {
  it('is true only when the text ends with a question mark', () => {
    assert.equal(asksQuestion('Which coast?'), true);
    assert.equal(asksQuestion('  Which coast?  '), true);
    assert.equal(asksQuestion('Which coast? Say it.'), false);
    assert.equal(asksQuestion('The atlas is ready.'), false);
    assert.equal(asksQuestion(null), false);
  });
});
