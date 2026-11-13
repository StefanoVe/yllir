import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createFakeProvider } from '../agent/fake-provider.js';
import type { AgentEvent, AgentProvider, AgentRunInput } from '../agent/provider.js';
import { request } from '../testing.js';
import { createChatService, type ChatService } from './index.js';
import { makeCampaign, messagesOf, serveChat, submitTo, waitFor, git, type TestCampaign } from './test-support.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function setup(campaign: TestCampaign, provider: AgentProvider, opts: { idleTimeoutMs?: number; hardLimitMs?: number } = {}): ChatService {
  cleanups.push(campaign.cleanup);
  return createChatService(campaign.ctx, provider, opts);
}

function turnStates(campaign: TestCampaign, turnId: string): string[] {
  return campaign.of('turn').filter((e) => e.data.id === turnId).map((e) => e.data.state);
}

function lastTurn(campaign: TestCampaign, turnId: string): any {
  const all = campaign.of('turn').filter((e) => e.data.id === turnId);
  return all[all.length - 1]?.data;
}

describe('turn queue', () => {
  it('runs one turn at a time, in the order the master wrote them', async () => {
    const campaign = makeCampaign();
    const provider = createFakeProvider([{ type: 'delta', text: 'Risposta.' }, { type: 'done' }], { delayMs: 5 });
    const service = setup(campaign, provider);
    const first = await submitTo(service, 'primo');
    const second = await submitTo(service, 'secondo');
    assert.ok(first && second);
    await waitFor(() => lastTurn(campaign, second.turnId)?.state === 'done', 'second turn done');

    assert.deepEqual(
      provider.calls.map((c) => c.prompt),
      ['primo', 'secondo'],
    );
    // Master messages are stored when accepted; each agent reply follows its own turn.
    assert.deepEqual(
      messagesOf(service).map((m) => `${m.role}:${m.text}`),
      ['master:primo', 'master:secondo', 'agent:Risposta.', 'agent:Risposta.'],
    );
    assert.deepEqual(
      messagesOf(service).filter((m) => m.role === 'agent').map((m) => m.turnId),
      [first.turnId, second.turnId],
    );
    assert.equal(lastTurn(campaign, first.turnId).state, 'done');
    assert.equal(service.runner.current(), null);
    await service.runner.close();
  });

  it('hands the choice of model and effort to the provider for that turn only', async () => {
    const campaign = makeCampaign();
    const provider = createFakeProvider([{ type: 'done' }]);
    const service = setup(campaign, provider);
    const chosen = await submitTo(service, 'con scelta', { model: 'haiku', effort: 'low' });
    const plain = await submitTo(service, 'senza scelta');
    assert.ok(chosen && plain);
    await waitFor(() => lastTurn(campaign, plain.turnId)?.state === 'done', 'second turn done');
    assert.equal(provider.calls[0].model, 'haiku');
    assert.equal(provider.calls[0].effort, 'low');
    assert.equal(provider.calls[1].model, undefined);
    assert.equal(provider.calls[1].effort, undefined);
    await service.runner.close();
  });

  it('publishes the user message before its turn, and the agent message before the done turn', async () => {
    const campaign = makeCampaign();
    const service = setup(campaign, createFakeProvider([{ type: 'delta', text: 'Ok' }, { type: 'done' }]));
    const sub = await submitTo(service, 'ciao');
    assert.ok(sub);
    await waitFor(() => campaign.of('turn').some((e) => e.data.state === 'done'), 'done');

    const names = campaign.events.map((e) => (e.event === 'turn' ? `turn:${e.data.state}` : e.event));
    assert.deepEqual(names.slice(0, 2), ['message', 'turn:queued']);
    const messageIndex = names.indexOf('message', 1);
    const doneIndex = names.indexOf('turn:done');
    assert.ok(messageIndex > 0 && messageIndex < doneIndex, `agent message before done: ${names.join(',')}`);
    const userMessage = campaign.of('message')[0].data;
    assert.equal(userMessage.role, 'master');
    assert.equal(userMessage.turnId, sub.turnId);
    assert.equal(userMessage.id, sub.messageId);
    const delta = campaign.of('delta')[0].data;
    assert.equal(delta.text, 'Ok');
    assert.equal(campaign.of('message')[1].data.id, delta.messageId);
    await service.runner.close();
  });

  it('turns an error event into an error turn with the plain message and no agent message', async () => {
    const campaign = makeCampaign();
    const service = setup(campaign, createFakeProvider([{ type: 'error', message: 'Prova di errore.' }]));
    const sub = await submitTo(service, 'ciao');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'error', 'error turn');
    assert.equal(lastTurn(campaign, sub.turnId).error, 'Prova di errore.');
    assert.equal(messagesOf(service).filter((m) => m.role === 'agent').length, 0);
    await service.runner.close();
  });
});

describe('cancel', () => {
  it('cancels a running turn: the provider signal aborts, the state is cancelled, partial text is kept', async () => {
    const campaign = makeCampaign();
    const provider = createFakeProvider([{ type: 'delta', text: 'Parziale' }], { hang: true });
    const service = setup(campaign, provider);
    const sub = await submitTo(service, 'lunga');
    assert.ok(sub);
    await waitFor(() => campaign.of('delta').length === 1, 'delta');
    assert.equal(service.runner.cancel(sub.turnId), true);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'cancelled', 'cancelled');
    assert.equal(provider.calls[0].signal.aborted, true);
    assert.equal(messagesOf(service).at(-1)?.text, 'Parziale');
    await service.runner.close();
  });

  it('cancels a queued turn without running it', async () => {
    const campaign = makeCampaign();
    const provider = createFakeProvider([], { hang: true });
    const service = setup(campaign, provider);
    const first = await submitTo(service, 'prima');
    const second = await submitTo(service, 'seconda');
    assert.ok(first && second);
    await waitFor(() => provider.calls.length === 1, 'first started');
    assert.equal(service.runner.cancel(second.turnId), true);
    assert.deepEqual(turnStates(campaign, second.turnId), ['queued', 'cancelled']);
    assert.equal(service.runner.cancel(first.turnId), true);
    await waitFor(() => lastTurn(campaign, first.turnId)?.state === 'cancelled', 'first cancelled');
    assert.equal(provider.calls.length, 1, 'the cancelled queued turn never ran');
    await service.runner.close();
  });

  it('answers ok for a finished turn and false for an unknown one', async () => {
    const campaign = makeCampaign();
    const service = setup(campaign, createFakeProvider([{ type: 'done' }]));
    const sub = await submitTo(service, 'ciao');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'done', 'done');
    assert.equal(service.runner.cancel(sub.turnId), true);
    assert.equal(service.runner.cancel('00000000-0000-4000-8000-000000000000'), false);
    await service.runner.close();
  });
});

describe('time limits', () => {
  it('stops a turn that makes no progress for the idle timeout', async () => {
    const campaign = makeCampaign();
    const service = setup(campaign, createFakeProvider([{ type: 'activity', text: 'Sto leggendo un documento…' }], { hang: true }), {
      idleTimeoutMs: 60,
      hardLimitMs: 5000,
    });
    const sub = await submitTo(service, 'ciao');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'error', 'idle error');
    assert.match(lastTurn(campaign, sub.turnId).error, /non ha risposto/);
    await service.runner.close();
  });

  it('resets the idle timer on every provider event', async () => {
    const campaign = makeCampaign();
    const script: AgentEvent[] = [];
    for (let i = 0; i < 6; i++) script.push({ type: 'activity', text: 'Sto leggendo un documento…' });
    script.push({ type: 'done' });
    const service = setup(campaign, createFakeProvider(script, { delayMs: 30 }), { idleTimeoutMs: 90, hardLimitMs: 5000 });
    const sub = await submitTo(service, 'ciao');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'done', 'done after many events');
    await service.runner.close();
  });

  it('stops a turn that runs past the hard limit even while it keeps working', async () => {
    const campaign = makeCampaign();
    const script: AgentEvent[] = [];
    for (let i = 0; i < 100; i++) script.push({ type: 'activity', text: 'Sto leggendo un documento…' });
    const service = setup(campaign, createFakeProvider(script, { delayMs: 20 }), { idleTimeoutMs: 5000, hardLimitMs: 100 });
    const sub = await submitTo(service, 'ciao');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'error', 'hard error');
    assert.match(lastTurn(campaign, sub.turnId).error, /troppo tempo/);
    await service.runner.close();
  });
});

describe('events from the provider', () => {
  it('maps activity to safe sentences only', async () => {
    const campaign = makeCampaign();
    const service = setup(
      campaign,
      createFakeProvider([
        { type: 'activity', text: '/Users/x/campaign/characters/mara.md' },
        { type: 'activity', text: 'Sto controllando i collegamenti…' },
        { type: 'done' },
      ]),
    );
    const sub = await submitTo(service, 'ciao');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'done', 'done');
    const activities = campaign.of('turn').map((e) => e.data.activity).filter((a) => a !== '');
    assert.ok(activities.every((a) => !a.includes('/') && !a.includes('mara.md')), activities.join(' | '));
    assert.ok(activities.includes('Sto controllando i collegamenti…'));
    await service.runner.close();
  });

  it('publishes only open requests that name an existing campaign Markdown document', async () => {
    const campaign = makeCampaign();
    fs.mkdirSync(path.join(campaign.dir, '.campaign', 'state'), { recursive: true });
    fs.writeFileSync(path.join(campaign.dir, '.campaign', 'secret.md'), 'segreto\n');
    const service = setup(
      campaign,
      createFakeProvider([
        { type: 'open', path: 'characters/mara.md' },
        { type: 'open', path: '../outside.md' },
        { type: 'open', path: 'characters/missing.md' },
        { type: 'open', path: '.campaign/secret.md' },
        { type: 'open', path: 'characters/mara.txt' },
        { type: 'open', path: '/etc/hosts.md' },
        { type: 'done' },
      ]),
    );
    const sub = await submitTo(service, 'apri');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'done', 'done');
    assert.deepEqual(campaign.of('open').map((e) => e.data), [{ path: 'characters/mara.md' }]);
    await service.runner.close();
  });

  it('publishes changes when the turn ends with a different HEAD, and records the turn in turns.json', async () => {
    const campaign = makeCampaign({ git: true });
    const provider = createFakeProvider([{ type: 'delta', text: 'Fatto.' }, { type: 'done' }], {
      commit: { path: 'characters/nuova.md', content: '# Nuova\n', message: 'Add a new character' },
    });
    const service = setup(campaign, provider);
    const sub = await submitTo(service, 'crea una nuova');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'done', 'done');
    await service.store.flush();

    assert.equal(campaign.of('changes').length, 1);
    const head = git(campaign.dir, ['rev-parse', 'HEAD']);
    const turns = JSON.parse(fs.readFileSync(path.join(campaign.dir, '.campaign', 'state', 'master-screen', 'turns.json'), 'utf8'));
    assert.deepEqual(turns, [
      { messageId: sub.messageId, turnId: sub.turnId, fromSha: turns[0].fromSha, toSha: head },
    ]);
    assert.notEqual(turns[0].fromSha, turns[0].toSha);
    assert.match(turns[0].fromSha, /^[0-9a-f]{40}$/);
    await service.runner.close();
  });

  it('does not publish changes when HEAD did not move, and uses an empty sha outside git', async () => {
    const campaign = makeCampaign();
    const service = setup(campaign, createFakeProvider([{ type: 'done' }]));
    const sub = await submitTo(service, 'domanda');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'done', 'done');
    await service.store.flush();
    assert.equal(campaign.of('changes').length, 0);
    const turns = JSON.parse(fs.readFileSync(path.join(campaign.dir, '.campaign', 'state', 'master-screen', 'turns.json'), 'utf8'));
    assert.deepEqual(turns[0], { messageId: sub.messageId, turnId: sub.turnId, fromSha: '', toSha: '' });
    await service.runner.close();
  });
});

describe('steps of a turn', () => {
  it('publishes the steps as they start and end, and stores them closed on the agent message', async () => {
    const campaign = makeCampaign();
    const service = setup(
      campaign,
      createFakeProvider([
        { type: 'step', id: 'r1', kind: 'read', text: 'Sto leggendo «Taverna del Porto»…' },
        { type: 'step-end', id: 'r1', ok: true },
        { type: 'step', id: 'w1', kind: 'write', text: 'Sto scrivendo la bozza…' },
        { type: 'step', id: 'r2', kind: 'read', text: 'Sto leggendo un documento…', parentId: 'task-1' },
        { type: 'step-end', id: 'r2', ok: false },
        { type: 'delta', text: 'Fatto.' },
        { type: 'done' },
      ]),
    );
    const sub = await submitTo(service, 'scrivi');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'done', 'done');
    await service.store.flush();

    const turn = lastTurn(campaign, sub.turnId);
    assert.deepEqual(
      turn.steps.map((s: { id: string; state: string }) => [s.id, s.state]),
      [['r1', 'done'], ['w1', 'done'], ['r2', 'failed']],
    );
    assert.equal(turn.steps[2].parentId, 'task-1');
    const earlier = campaign.of('turn').filter((e) => e.data.id === sub.turnId && e.data.steps.length === 1);
    assert.equal(earlier[0].data.steps[0].state, 'running');
    const agent = messagesOf(service).find((m) => m.role === 'agent');
    assert.deepEqual(agent?.steps?.map((s) => s.state), ['done', 'done', 'failed']);
    await service.runner.close();
  });

  it('keeps the plain-language rule for step text and at most 60 steps', async () => {
    const campaign = makeCampaign();
    const script: AgentEvent[] = [{ type: 'step', id: 'bad', kind: 'read', text: 'Sto usando Read…' }];
    for (let i = 0; i < 65; i++) script.push({ type: 'step', id: `s${i}`, kind: 'search', text: 'Sto cercando nei documenti…' });
    script.push({ type: 'done' });
    const service = setup(campaign, createFakeProvider(script));
    const sub = await submitTo(service, 'ciao');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'done', 'done');
    const seen = campaign.of('turn').flatMap((e) => e.data.steps ?? []);
    assert.equal(seen.find((s: { id: string }) => s.id === 'bad')?.text, 'Sto lavorando…');
    const turn = lastTurn(campaign, sub.turnId);
    assert.equal(turn.steps.length, 60);
    assert.equal(turn.steps[0].id, 's5');
    assert.equal(turn.steps[0].text, 'Sto cercando nei documenti…');
    await service.runner.close();
  });
});

describe('shutdown', () => {
  it('cancels the running turn and the queue, and refuses new messages', async () => {
    const campaign = makeCampaign();
    const provider = createFakeProvider([], { hang: true });
    const service = setup(campaign, provider);
    const first = await submitTo(service, 'uno');
    const second = await submitTo(service, 'due');
    assert.ok(first && second);
    await waitFor(() => provider.calls.length === 1, 'first started');
    await campaign.ctx.closeAll();
    assert.equal(provider.calls[0].signal.aborted, true);
    assert.equal(lastTurn(campaign, first.turnId).state, 'cancelled');
    assert.equal(lastTurn(campaign, second.turnId).state, 'cancelled');
    assert.equal(await submitTo(service, 'tre'), null);
  });
});

/** Replies with the prompt and names its session after the prompt, so each conversation resumes its own. */
function sessionProvider(): AgentProvider & { calls: AgentRunInput[] } {
  const calls: AgentRunInput[] = [];
  return {
    calls,
    async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
      calls.push(input);
      yield { type: 'resume', id: `session-${input.prompt}` };
      yield { type: 'delta', text: `Risposta a ${input.prompt}` };
      yield { type: 'done' };
    },
  };
}

function messageLines(service: ChatService, conversationId: string): string[] {
  return service.store.messages(conversationId).map((m) => `${m.role}:${m.text}`);
}

describe('conversations', () => {
  it('keeps the messages and the session of each conversation apart', async () => {
    const campaign = makeCampaign();
    const provider = sessionProvider();
    const service = setup(campaign, provider);
    const a = service.store.currentId();
    const b = (await service.store.createConversation()).id;

    const a1 = await service.runner.submit(a, 'A1');
    assert.ok(a1);
    await waitFor(() => lastTurn(campaign, a1.turnId)?.state === 'done', 'A1 done');
    const b1 = await service.runner.submit(b, 'B1');
    assert.ok(b1);
    await waitFor(() => lastTurn(campaign, b1.turnId)?.state === 'done', 'B1 done');
    const a2 = await service.runner.submit(a, 'A2');
    assert.ok(a2);
    await waitFor(() => lastTurn(campaign, a2.turnId)?.state === 'done', 'A2 done');
    await service.store.flush();

    // B starts a new session; A2 resumes the session A1 started, not B's.
    assert.deepEqual(
      provider.calls.map((c) => [c.prompt, c.resumeId]),
      [
        ['A1', undefined],
        ['B1', undefined],
        ['A2', 'session-A1'],
      ],
    );
    assert.deepEqual(messageLines(service, a), ['master:A1', 'agent:Risposta a A1', 'master:A2', 'agent:Risposta a A2']);
    assert.deepEqual(messageLines(service, b), ['master:B1', 'agent:Risposta a B1']);
    assert.equal(service.store.resumeId(a), 'session-A2');
    assert.equal(service.store.resumeId(b), 'session-B1');
    await service.runner.close();
  });

  it('runs one turn at a time across conversations: the other conversation waits queued', async () => {
    const campaign = makeCampaign();
    const provider = createFakeProvider([], { hang: true });
    const service = setup(campaign, provider);
    const a = service.store.currentId();
    const b = (await service.store.createConversation()).id;
    const first = await service.runner.submit(a, 'A1');
    const second = await service.runner.submit(b, 'B1');
    assert.ok(first && second);

    await waitFor(() => provider.calls.length === 1, 'A1 running');
    assert.equal(lastTurn(campaign, first.turnId).state, 'running');
    assert.equal(lastTurn(campaign, second.turnId).state, 'queued');
    assert.equal(lastTurn(campaign, second.turnId).conversationId, b);
    assert.equal(service.runner.currentFor(a)?.id, first.turnId);
    assert.equal(service.runner.currentFor(b), null, 'the running turn of A is not the turn of B');

    assert.equal(service.runner.cancel(first.turnId), true);
    await waitFor(() => provider.calls.length === 2, 'B1 started');
    assert.equal(provider.calls[1].prompt, 'B1');
    assert.equal(service.runner.currentFor(b)?.id, second.turnId);
    assert.equal(service.runner.cancel(second.turnId), true);
    await waitFor(() => lastTurn(campaign, second.turnId)?.state === 'cancelled', 'B1 cancelled');
    await service.runner.close();
  });

  it('cancelConversation cancels the running turn of that conversation and drops only its queued turns', async () => {
    const campaign = makeCampaign();
    const provider = createFakeProvider([], { hang: true });
    const service = setup(campaign, provider);
    const a = service.store.currentId();
    const b = (await service.store.createConversation()).id;
    const a1 = await service.runner.submit(a, 'A1');
    const a2 = await service.runner.submit(a, 'A2');
    const b1 = await service.runner.submit(b, 'B1');
    assert.ok(a1 && a2 && b1);
    await waitFor(() => provider.calls.length === 1, 'A1 running');

    service.runner.cancelConversation(a);
    await waitFor(() => provider.calls.length === 2, 'B1 started');
    assert.equal(provider.calls[0].signal.aborted, true);
    assert.deepEqual(provider.calls.map((c) => c.prompt), ['A1', 'B1']);
    assert.equal(lastTurn(campaign, a1.turnId).state, 'cancelled');
    const droppedA2 = lastTurn(campaign, a2.turnId);
    assert.equal(droppedA2.state, 'cancelled');
    assert.equal(droppedA2.activity, '');
    assert.deepEqual(turnStates(campaign, b1.turnId), ['queued', 'running']);
    assert.equal(service.runner.currentFor(b)?.id, b1.turnId);
    assert.equal(service.runner.cancel(b1.turnId), true);
    await waitFor(() => lastTurn(campaign, b1.turnId)?.state === 'cancelled', 'B1 cancelled');
    await service.runner.close();
  });

  it('carries the conversationId on the message, delta and turn events', async () => {
    const campaign = makeCampaign();
    const service = setup(campaign, createFakeProvider([{ type: 'delta', text: 'Ok' }, { type: 'done' }]));
    const b = (await service.store.createConversation()).id;
    const sub = await service.runner.submit(b, 'ciao');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'done', 'done');

    const messages = campaign.of('message');
    assert.equal(messages.length, 2);
    assert.ok(messages.every((e) => e.data.conversationId === b), 'message events name their conversation');
    assert.equal(campaign.of('delta')[0].data.conversationId, b);
    assert.ok(campaign.of('turn').length > 0);
    assert.ok(campaign.of('turn').every((e) => e.data.conversationId === b), 'turn events name their conversation');
    await service.runner.close();
  });
});

describe('chat routes with conversations', () => {
  async function serveWith(provider: AgentProvider | null) {
    const campaign = makeCampaign();
    const server = await serveChat(campaign, provider);
    cleanups.push(async () => {
      await campaign.ctx.closeAll();
      await server.close();
      campaign.cleanup();
    });
    return { campaign, port: server.port };
  }

  function post(port: number, path: string, body?: unknown) {
    return request(port, {
      method: 'POST',
      path,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function listed(port: number) {
    return (await request(port, { path: '/api/chats' })).json as {
      conversations: Array<{ id: string; messageCount: number }>;
      currentId: string;
      turn: { id: string; state: string } | null;
    };
  }

  it('lists the conversations with the current one and the campaign turn, and creates one with 201', async () => {
    const { campaign, port } = await serveWith(createFakeProvider([{ type: 'done' }]));
    const before = await listed(port);
    assert.equal(before.conversations.length, 1);
    assert.equal(before.currentId, before.conversations[0].id);
    assert.equal(before.turn, null);

    const created = await post(port, '/api/chats');
    assert.equal(created.status, 201);
    const conversation = created.json as { id: string; title: string; messageCount: number };
    assert.equal(conversation.title, '');
    assert.equal(conversation.messageCount, 0);
    assert.ok(campaign.of('conversations').length >= 1, 'conversations published');

    const after = await listed(port);
    assert.equal(after.conversations.length, 2);
    assert.equal(after.currentId, conversation.id);
  });

  it('stores a message in the conversation it names, the most recent one when none is named, and 404s an unknown one', async () => {
    const provider = createFakeProvider([{ type: 'done' }]);
    const { campaign, port } = await serveWith(provider);
    const a = (await listed(port)).currentId;
    const b = ((await post(port, '/api/chats')).json as { id: string }).id;

    // No conversation named: the most recently updated one, which is b.
    const noId = await post(port, '/api/chat/messages', { text: 'senza id' });
    assert.equal(noId.status, 202);
    const noIdTurn = (noId.json as { turnId: string }).turnId;
    await waitFor(() => campaign.of('turn').some((e) => e.data.id === noIdTurn && e.data.state === 'done'), 'first done');
    const withB = (await request(port, { path: `/api/chat?conversationId=${b}` })).json as { messages: Array<{ text: string }> };
    assert.deepEqual(withB.messages.map((m) => m.text), ['senza id']);

    const named = await post(port, '/api/chat/messages', { text: 'in A', conversationId: a });
    assert.equal(named.status, 202);
    await waitFor(() => provider.calls.length === 2, 'second run');
    await waitFor(() => campaign.of('turn').filter((e) => e.data.state === 'done').length === 2, 'second done');
    const withA = (await request(port, { path: `/api/chat?conversationId=${a}` })).json as { messages: Array<{ text: string }> };
    assert.deepEqual(withA.messages.map((m) => m.text), ['in A']);

    const unknown = await post(port, '/api/chat/messages', { text: 'x', conversationId: 'non-esiste' });
    assert.equal(unknown.status, 404);
    assert.equal(typeof (unknown.json as { error: unknown }).error, 'string');
    assert.equal(provider.calls.length, 2, 'nothing queued for an unknown conversation');
  });

  it('answers GET /chat for the most recent conversation when no id is given, and 404 for an unknown id', async () => {
    const { port } = await serveWith(createFakeProvider([{ type: 'done' }]));
    const current = (await listed(port)).currentId;
    const chat = (await request(port, { path: '/api/chat' })).json as { conversationId: string; messages: unknown[]; turn: unknown };
    assert.equal(chat.conversationId, current);
    assert.deepEqual(chat.messages, []);
    assert.equal(chat.turn, null);
    const unknown = await request(port, { path: '/api/chat?conversationId=non-esiste' });
    assert.equal(unknown.status, 404);
    assert.equal(typeof (unknown.json as { error: unknown }).error, 'string');
  });

  it('returns the running turn in GET /chat only for the conversation that owns it', async () => {
    const { campaign, port } = await serveWith(createFakeProvider([], { hang: true }));
    const a = (await listed(port)).currentId;
    const b = ((await post(port, '/api/chats')).json as { id: string }).id;
    const sent = (await post(port, '/api/chat/messages', { text: 'lunga', conversationId: a })).json as { turnId: string };
    await waitFor(() => campaign.of('turn').some((e) => e.data.id === sent.turnId && e.data.state === 'running'), 'running');

    const ownA = (await request(port, { path: `/api/chat?conversationId=${a}` })).json as { turn: { id: string } | null };
    const ownB = (await request(port, { path: `/api/chat?conversationId=${b}` })).json as { turn: unknown };
    assert.equal(ownA.turn?.id, sent.turnId);
    assert.equal(ownB.turn, null);
    assert.equal((await listed(port)).turn?.id, sent.turnId);
    await post(port, `/api/chat/turns/${sent.turnId}/cancel`, {});
  });

  it('deletes a conversation with a running turn: the turn is cancelled, the conversation is gone, unknown ids 404', async () => {
    const { campaign, port } = await serveWith(createFakeProvider([], { hang: true }));
    const a = (await listed(port)).currentId;
    const b = ((await post(port, '/api/chats')).json as { id: string }).id;
    const sent = (await post(port, '/api/chat/messages', { text: 'lunga', conversationId: b })).json as { turnId: string };
    await waitFor(() => campaign.of('turn').some((e) => e.data.id === sent.turnId && e.data.state === 'running'), 'running');

    const deleted = await request(port, { method: 'DELETE', path: `/api/chats/${b}` });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.json, { ok: true });
    assert.equal(lastTurn(campaign, sent.turnId).state, 'cancelled');
    assert.ok(campaign.of('conversations').length >= 1);
    assert.equal(fs.existsSync(path.join(campaign.dir, '.campaign', 'state', 'master-screen', 'chats', `${b}.json`)), false);
    const remaining = await listed(port);
    assert.deepEqual(remaining.conversations.map((c) => c.id), [a]);
    assert.equal((await request(port, { path: `/api/chat?conversationId=${b}` })).status, 404);
    const again = await request(port, { method: 'DELETE', path: `/api/chats/${b}` });
    assert.equal(again.status, 404);
    assert.equal(typeof (again.json as { error: unknown }).error, 'string');
  });

  it('deleting the last conversation leaves a fresh empty one', async () => {
    const { port } = await serveWith(createFakeProvider([{ type: 'done' }]));
    const only = (await listed(port)).currentId;
    assert.equal((await request(port, { method: 'DELETE', path: `/api/chats/${only}` })).status, 200);
    const fresh = await listed(port);
    assert.equal(fresh.conversations.length, 1);
    assert.notEqual(fresh.currentId, only);
    assert.equal(fresh.conversations[0].messageCount, 0);
  });
});
