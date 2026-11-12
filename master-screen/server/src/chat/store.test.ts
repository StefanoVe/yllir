import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { ChatMessage } from '../../../shared/src/types.js';
import { ChatStore, MAX_MESSAGES } from './store.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function stateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yllir-store-'));
  dirs.push(dir);
  return path.join(dir, '.campaign', 'state', 'master-screen');
}

function message(i: number, role: 'master' | 'agent' = 'master'): ChatMessage {
  return { id: `m${i}`, role, text: `testo ${i}`, at: new Date(2026, 0, 1, 0, 0, i).toISOString(), turnId: `t${i}` };
}

describe('ChatStore persistence', () => {
  it('round-trips messages and the session id through chat.json', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    await store.addMessage(message(1));
    await store.addMessage(message(2, 'agent'));
    await store.setResumeId('session-abc');
    await store.flush();

    const reopened = new ChatStore(dir);
    assert.deepEqual(reopened.messages(), [message(1), message(2, 'agent')]);
    assert.equal(reopened.resumeId(), 'session-abc');
  });

  it('writes chat.json with mode 0600 and no temporary files left behind', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    await store.addMessage(message(1));
    await store.flush();
    const file = path.join(dir, 'chat.json');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp')), []);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1);
  });

  it('keeps only the last MAX_MESSAGES messages', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    for (let i = 0; i < MAX_MESSAGES + 10; i++) await store.addMessage(message(i));
    await store.flush();
    const kept = new ChatStore(dir).messages();
    assert.equal(kept.length, MAX_MESSAGES);
    assert.equal(kept[0].id, 'm10');
    assert.equal(kept.at(-1)?.id, `m${MAX_MESSAGES + 9}`);
  });

  it('serializes concurrent writes so the last state on disk is the last state in memory', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 25; i++) writes.push(store.addMessage(message(i)));
    await Promise.all(writes);
    await store.flush();
    assert.equal(new ChatStore(dir).messages().length, 25);
  });

  it('starts empty when chat.json is corrupted and keeps the broken file as chat.json.bak', () => {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'chat.json'), '{"version": 1, "messages": [');
    const logs: string[] = [];
    const store = new ChatStore(dir, (msg) => logs.push(msg));
    assert.deepEqual(store.messages(), []);
    assert.equal(store.resumeId(), undefined);
    assert.equal(fs.readFileSync(path.join(dir, 'chat.json.bak'), 'utf8'), '{"version": 1, "messages": [');
    assert.ok(!fs.existsSync(path.join(dir, 'chat.json')));
    assert.equal(logs.length, 1);
  });

  it('treats a chat.json with a wrong shape as corrupted', () => {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify({ version: 1, messages: [{ id: 3 }] }));
    const store = new ChatStore(dir);
    assert.deepEqual(store.messages(), []);
    assert.ok(fs.existsSync(path.join(dir, 'chat.json.bak')));
  });

  it('can write again after a corrupted file was moved aside', async () => {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'chat.json'), 'not json');
    const store = new ChatStore(dir);
    await store.addMessage(message(1));
    await store.flush();
    assert.deepEqual(new ChatStore(dir).messages(), [message(1)]);
  });
});

describe('steps of an agent message', () => {
  const steps = [
    { id: 'tu-1', kind: 'read' as const, text: 'Sto leggendo «Taverna»…', at: '2026-01-01T00:00:01.000Z', endedAt: '2026-01-01T00:00:02.000Z', state: 'done' as const },
    { id: 'tu-2', kind: 'image' as const, text: 'Sto generando l’immagine…', at: '2026-01-01T00:00:03.000Z', state: 'failed' as const, parentId: 'task-1' },
  ];

  it('persists and reloads the steps of an agent message', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    await store.addMessage({ ...message(1, 'agent'), steps });
    await store.flush();
    const reopened = new ChatStore(dir);
    assert.deepEqual(reopened.messages()[0].steps, steps);
  });

  it('loads a chat.json written before steps existed, and drops a malformed steps field only', async () => {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    const old = { version: 1, messages: [message(1), { ...message(2, 'agent'), steps: 'rotto' }] };
    fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify(old));
    const store = new ChatStore(dir);
    assert.deepEqual(store.messages(), [message(1), message(2, 'agent')]);
    assert.equal(fs.existsSync(path.join(dir, 'chat.json.bak')), false);
  });
});

describe('turns.json', () => {
  it('appends {messageId, turnId, fromSha, toSha} records as a JSON array', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    await store.appendTurn({ messageId: 'm1', turnId: 't1', fromSha: 'a'.repeat(40), toSha: 'b'.repeat(40) });
    await store.appendTurn({ messageId: 'm2', turnId: 't2', fromSha: '', toSha: '' });
    await store.flush();
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'turns.json'), 'utf8'));
    assert.deepEqual(raw, [
      { messageId: 'm1', turnId: 't1', fromSha: 'a'.repeat(40), toSha: 'b'.repeat(40) },
      { messageId: 'm2', turnId: 't2', fromSha: '', toSha: '' },
    ]);
    assert.equal(new ChatStore(dir).turns().length, 2);
  });

  it('keeps a damaged turns.json as turns.json.bak and starts a new list', async () => {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'turns.json'), '{"not": "a list"}');
    const store = new ChatStore(dir);
    assert.deepEqual(store.turns(), []);
    assert.ok(fs.existsSync(path.join(dir, 'turns.json.bak')));
    await store.appendTurn({ messageId: 'm1', turnId: 't1', fromSha: '', toSha: '' });
    await store.flush();
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'turns.json'), 'utf8')).length, 1);
  });
});
