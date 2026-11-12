import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { createFakeProvider } from '../agent/fake-provider.js';
import type { AgentEvent } from '../agent/provider.js';
import { createChatService, type ChatService } from './index.js';
import { makeCampaign, waitFor, git, type TestCampaign } from './test-support.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function setup(campaign: TestCampaign, provider: ReturnType<typeof createFakeProvider>, opts: { idleTimeoutMs?: number; hardLimitMs?: number } = {}): ChatService {
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
    const first = await service.runner.submit('primo');
    const second = await service.runner.submit('secondo');
    assert.ok(first && second);
    await waitFor(() => lastTurn(campaign, second.turnId)?.state === 'done', 'second turn done');

    assert.deepEqual(
      provider.calls.map((c) => c.prompt),
      ['primo', 'secondo'],
    );
    // Master messages are stored when accepted; each agent reply follows its own turn.
    assert.deepEqual(
      service.store.messages().map((m) => `${m.role}:${m.text}`),
      ['master:primo', 'master:secondo', 'agent:Risposta.', 'agent:Risposta.'],
    );
    assert.deepEqual(
      service.store.messages().filter((m) => m.role === 'agent').map((m) => m.turnId),
      [first.turnId, second.turnId],
    );
    assert.equal(lastTurn(campaign, first.turnId).state, 'done');
    assert.equal(service.runner.current(), null);
    await service.runner.close();
  });

  it('publishes the user message before its turn, and the agent message before the done turn', async () => {
    const campaign = makeCampaign();
    const service = setup(campaign, createFakeProvider([{ type: 'delta', text: 'Ok' }, { type: 'done' }]));
    const sub = await service.runner.submit('ciao');
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
    const sub = await service.runner.submit('ciao');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'error', 'error turn');
    assert.equal(lastTurn(campaign, sub.turnId).error, 'Prova di errore.');
    assert.equal(service.store.messages().filter((m) => m.role === 'agent').length, 0);
    await service.runner.close();
  });
});

describe('cancel', () => {
  it('cancels a running turn: the provider signal aborts, the state is cancelled, partial text is kept', async () => {
    const campaign = makeCampaign();
    const provider = createFakeProvider([{ type: 'delta', text: 'Parziale' }], { hang: true });
    const service = setup(campaign, provider);
    const sub = await service.runner.submit('lunga');
    assert.ok(sub);
    await waitFor(() => campaign.of('delta').length === 1, 'delta');
    assert.equal(service.runner.cancel(sub.turnId), true);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'cancelled', 'cancelled');
    assert.equal(provider.calls[0].signal.aborted, true);
    assert.equal(service.store.messages().at(-1)?.text, 'Parziale');
    await service.runner.close();
  });

  it('cancels a queued turn without running it', async () => {
    const campaign = makeCampaign();
    const provider = createFakeProvider([], { hang: true });
    const service = setup(campaign, provider);
    const first = await service.runner.submit('prima');
    const second = await service.runner.submit('seconda');
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
    const sub = await service.runner.submit('ciao');
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
    const sub = await service.runner.submit('ciao');
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
    const sub = await service.runner.submit('ciao');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'done', 'done after many events');
    await service.runner.close();
  });

  it('stops a turn that runs past the hard limit even while it keeps working', async () => {
    const campaign = makeCampaign();
    const script: AgentEvent[] = [];
    for (let i = 0; i < 100; i++) script.push({ type: 'activity', text: 'Sto leggendo un documento…' });
    const service = setup(campaign, createFakeProvider(script, { delayMs: 20 }), { idleTimeoutMs: 5000, hardLimitMs: 100 });
    const sub = await service.runner.submit('ciao');
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
    const sub = await service.runner.submit('ciao');
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
    const sub = await service.runner.submit('apri');
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
    const sub = await service.runner.submit('crea una nuova');
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
    const sub = await service.runner.submit('domanda');
    assert.ok(sub);
    await waitFor(() => lastTurn(campaign, sub.turnId)?.state === 'done', 'done');
    await service.store.flush();
    assert.equal(campaign.of('changes').length, 0);
    const turns = JSON.parse(fs.readFileSync(path.join(campaign.dir, '.campaign', 'state', 'master-screen', 'turns.json'), 'utf8'));
    assert.deepEqual(turns[0], { messageId: sub.messageId, turnId: sub.turnId, fromSha: '', toSha: '' });
    await service.runner.close();
  });
});

describe('shutdown', () => {
  it('cancels the running turn and the queue, and refuses new messages', async () => {
    const campaign = makeCampaign();
    const provider = createFakeProvider([], { hang: true });
    const service = setup(campaign, provider);
    const first = await service.runner.submit('uno');
    const second = await service.runner.submit('due');
    assert.ok(first && second);
    await waitFor(() => provider.calls.length === 1, 'first started');
    await campaign.ctx.closeAll();
    assert.equal(provider.calls[0].signal.aborted, true);
    assert.equal(lastTurn(campaign, first.turnId).state, 'cancelled');
    assert.equal(lastTurn(campaign, second.turnId).state, 'cancelled');
    assert.equal(await service.runner.submit('tre'), null);
  });
});
