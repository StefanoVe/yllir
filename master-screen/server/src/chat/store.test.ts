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

function chatsDir(dir: string): string {
  return path.join(dir, 'chats');
}

describe('ChatStore persistence', () => {
  it('round-trips messages and the session id of a conversation through chats/<id>.json', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const id = store.currentId();
    await store.addMessage(id, message(1));
    await store.addMessage(id, message(2, 'agent'));
    await store.setResumeId(id, 'session-abc');
    await store.flush();

    const reopened = new ChatStore(dir);
    assert.equal(reopened.currentId(), id);
    assert.deepEqual(reopened.messages(id), [message(1), message(2, 'agent')]);
    assert.equal(reopened.resumeId(id), 'session-abc');
  });

  it('writes the conversation file with mode 0600 and no temporary files left behind', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const id = store.currentId();
    await store.addMessage(id, message(1));
    await store.flush();
    const file = path.join(chatsDir(dir), `${id}.json`);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
    assert.deepEqual(fs.readdirSync(chatsDir(dir)).filter((name) => name.endsWith('.tmp')), []);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(raw.version, 1);
    assert.equal(raw.id, id);
    assert.equal(raw.messages.length, 1);
  });

  it('keeps only the last MAX_MESSAGES messages of a conversation', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const id = store.currentId();
    for (let i = 0; i < MAX_MESSAGES + 10; i++) await store.addMessage(id, message(i));
    await store.flush();
    const kept = new ChatStore(dir).messages(id);
    assert.equal(kept.length, MAX_MESSAGES);
    assert.equal(kept[0].id, 'm10');
    assert.equal(kept.at(-1)?.id, `m${MAX_MESSAGES + 9}`);
  });

  it('serializes concurrent writes so the last state on disk is the last state in memory', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const id = store.currentId();
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 25; i++) writes.push(store.addMessage(id, message(i)));
    await Promise.all(writes);
    await store.flush();
    assert.equal(new ChatStore(dir).messages(id).length, 25);
  });

  it('a damaged legacy chat.json is kept as chat.json.bak and ignored', () => {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'chat.json'), '{"version": 1, "messages": [');
    const logs: string[] = [];
    const store = new ChatStore(dir, (msg) => logs.push(msg));
    assert.deepEqual(store.messages(store.currentId()), []);
    assert.equal(store.resumeId(store.currentId()), undefined);
    assert.equal(fs.readFileSync(path.join(dir, 'chat.json.bak'), 'utf8'), '{"version": 1, "messages": [');
    assert.ok(!fs.existsSync(path.join(dir, 'chat.json')));
    assert.ok(!fs.existsSync(path.join(dir, 'chat.json.migrated')));
    assert.equal(logs.length, 1);
  });

  it('treats a legacy chat.json with a wrong shape as corrupted', () => {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify({ version: 1, messages: [{ id: 3 }] }));
    const store = new ChatStore(dir);
    assert.deepEqual(store.messages(store.currentId()), []);
    assert.ok(fs.existsSync(path.join(dir, 'chat.json.bak')));
  });

  it('can write again after a damaged legacy file was moved aside', async () => {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'chat.json'), 'not json');
    const store = new ChatStore(dir);
    const id = store.currentId();
    await store.addMessage(id, message(1));
    await store.flush();
    assert.deepEqual(new ChatStore(dir).messages(id), [message(1)]);
  });
});

describe('always one conversation', () => {
  it('creates an empty conversation in memory on an empty folder and writes nothing', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const list = store.conversations();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, '');
    assert.equal(list[0].messageCount, 0);
    assert.equal(store.currentId(), list[0].id);
    assert.equal(store.has(list[0].id), true);
    assert.deepEqual(store.messages(list[0].id), []);
    await store.flush();
    assert.equal(fs.existsSync(dir), false, 'the state folder is not created');
    assert.equal(fs.existsSync(chatsDir(dir)), false, 'no chats/ folder is created');
  });

  it('persists the in-memory conversation at its first message', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const id = store.currentId();
    await store.addMessage(id, message(1));
    await store.flush();
    assert.ok(fs.existsSync(path.join(chatsDir(dir), `${id}.json`)));
    assert.equal(new ChatStore(dir).currentId(), id);
    assert.deepEqual(new ChatStore(dir).messages(id), [message(1)]);
  });

  it('persists the in-memory conversation at its first session id', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const id = store.currentId();
    await store.setResumeId(id, 'session-first');
    await store.flush();
    assert.ok(fs.existsSync(path.join(chatsDir(dir), `${id}.json`)));
    assert.equal(new ChatStore(dir).resumeId(id), 'session-first');
  });

  it('a conversation that was only looked at is not written at restart', async () => {
    const dir = stateDir();
    new ChatStore(dir).currentId();
    await new ChatStore(dir).flush();
    assert.equal(fs.existsSync(chatsDir(dir)), false);
  });

  it('does not create another conversation when one already exists', async () => {
    const dir = stateDir();
    const first = new ChatStore(dir);
    const id = first.currentId();
    await first.addMessage(id, message(1));
    await first.flush();
    const reopened = new ChatStore(dir);
    assert.deepEqual(reopened.conversations().map((c) => c.id), [id]);
  });

  it('ignores damaged conversation files, keeps them as .bak and still has one conversation', async () => {
    const dir = stateDir();
    fs.mkdirSync(chatsDir(dir), { recursive: true });
    fs.writeFileSync(path.join(chatsDir(dir), 'bad.json'), '{"version": 1, "id": ');
    const logs: string[] = [];
    const store = new ChatStore(dir, (msg) => logs.push(msg));
    assert.equal(store.conversations().length, 1);
    assert.equal(fs.readFileSync(path.join(chatsDir(dir), 'bad.json.bak'), 'utf8'), '{"version": 1, "id": ');
    assert.ok(!fs.existsSync(path.join(chatsDir(dir), 'bad.json')));
    assert.equal(logs.length, 1);
    await store.flush();
  });
});

describe('conversations', () => {
  it('creates a conversation with an empty title and no messages, newest first', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const before = store.currentId();
    const created = await store.createConversation();
    assert.equal(created.title, '');
    assert.equal(created.messageCount, 0);
    assert.equal(store.conversations().length, 2);
    assert.equal(store.currentId(), created.id);
    assert.notEqual(created.id, before);
    assert.deepEqual(store.messages(created.id), []);
    await store.flush();
    // The automatic one is still in memory only; the created one is the only file.
    assert.deepEqual(new ChatStore(dir).conversations().map((c) => c.id), [created.id]);
  });

  it('an explicit create is written at once, before any message', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const created = await store.createConversation();
    assert.ok(fs.existsSync(path.join(chatsDir(dir), `${created.id}.json`)));
    assert.equal(new ChatStore(dir).has(created.id), true);
  });

  it('deletes a conversation file, and deleting the last one leaves one fresh in-memory conversation', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const first = store.currentId();
    const second = (await store.createConversation()).id;
    await store.addMessage(second, message(1));
    await store.flush();

    await store.deleteConversation(second);
    await store.flush();
    assert.equal(store.has(second), false);
    assert.deepEqual(store.conversations().map((c) => c.id), [first]);
    assert.ok(!fs.existsSync(path.join(chatsDir(dir), `${second}.json`)));

    // The in-memory conversation has no file: deleting it keeps one in the list, and nothing is written.
    await store.deleteConversation(first);
    await store.flush();
    const fresh = store.conversations();
    assert.equal(fresh.length, 1);
    assert.notEqual(fresh[0].id, first);
    assert.equal(fresh[0].messageCount, 0);
    assert.deepEqual(fs.readdirSync(chatsDir(dir)), []);
    assert.equal(new ChatStore(dir).conversations().length, 1);
  });

  it('deleting the last persisted conversation removes its file and leaves one in-memory conversation', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const id = (await store.createConversation()).id;
    await store.addMessage(id, message(1));
    await store.flush();
    await store.deleteConversation(id);
    await store.flush();
    assert.deepEqual(fs.readdirSync(chatsDir(dir)), []);
    const list = store.conversations();
    assert.equal(list.length, 1);
    assert.notEqual(list[0].id, id);
    assert.equal(list[0].messageCount, 0);
    assert.equal(new ChatStore(dir).conversations().length, 1);
    assert.deepEqual(fs.readdirSync(chatsDir(dir)), []);
  });

  it('deleting the in-memory conversation while a persisted one exists only drops it from memory', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const automatic = store.currentId();
    const created = (await store.createConversation()).id;
    await store.deleteConversation(automatic);
    await store.flush();
    assert.deepEqual(store.conversations().map((c) => c.id), [created]);
    assert.deepEqual(fs.readdirSync(chatsDir(dir)), [`${created}.json`]);
  });

  it('ignores an unknown id on delete', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const id = store.currentId();
    await store.deleteConversation('no-such-id');
    assert.deepEqual(store.conversations().map((c) => c.id), [id]);
  });

  it('keeps messages and session ids of each conversation apart', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const a = store.currentId();
    const b = (await store.createConversation()).id;
    await store.addMessage(a, message(1));
    await store.addMessage(b, message(2, 'agent'));
    await store.setResumeId(a, 'session-a');
    await store.flush();

    assert.deepEqual(store.messages(a), [message(1)]);
    assert.deepEqual(store.messages(b), [message(2, 'agent')]);
    assert.equal(store.resumeId(a), 'session-a');
    assert.equal(store.resumeId(b), undefined);

    const reopened = new ChatStore(dir);
    assert.deepEqual(reopened.messages(a), [message(1)]);
    assert.equal(reopened.resumeId(b), undefined);
  });

  it('bumps updatedAt to the message time, so the conversation with the newest message comes first', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const a = store.currentId();
    const b = (await store.createConversation()).id;
    const later = new Date(Date.now() + 60_000).toISOString();
    await store.addMessage(a, { ...message(5), at: later });
    await store.flush();
    const list = store.conversations();
    assert.equal(list[0].id, a);
    assert.equal(list[0].updatedAt, later);
    assert.equal(list[0].messageCount, 1);
    assert.equal(list[1].id, b);
  });

  it('answers an empty list for an unknown id and rejects writes to it', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    assert.equal(store.has('nope'), false);
    assert.deepEqual(store.messages('nope'), []);
    assert.equal(store.resumeId('nope'), undefined);
    await assert.rejects(store.addMessage('nope', message(1)), Error);
    await assert.rejects(store.setResumeId('nope', 'x'), Error);
  });
});

describe('title of a conversation', () => {
  it('takes the title from the first master message, whitespace collapsed', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const id = store.currentId();
    await store.addMessage(id, { ...message(1, 'agent'), text: 'Risposta che non fa titolo' });
    await store.addMessage(id, { ...message(2), text: '  Il   porto\n\ndi  Nebbia  ' });
    await store.addMessage(id, { ...message(3), text: 'Un altro messaggio' });
    await store.flush();
    assert.equal(store.conversations()[0].title, 'Il porto di Nebbia');
    assert.equal(new ChatStore(dir).conversations()[0].title, 'Il porto di Nebbia');
  });

  it('cuts a long title to 60 characters and adds an ellipsis', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const id = store.currentId();
    await store.addMessage(id, { ...message(1), text: 'x'.repeat(70) });
    await store.flush();
    assert.equal(store.conversations()[0].title, `${'x'.repeat(60)}…`);
  });

  it('keeps a title of exactly 60 characters without an ellipsis', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const id = store.currentId();
    await store.addMessage(id, { ...message(1), text: 'y'.repeat(60) });
    await store.flush();
    assert.equal(store.conversations()[0].title, 'y'.repeat(60));
  });

  it('keeps the title empty while only blank master messages were sent', async () => {
    const dir = stateDir();
    const store = new ChatStore(dir);
    const id = store.currentId();
    await store.addMessage(id, { ...message(1), text: '   ' });
    await store.flush();
    assert.equal(store.conversations()[0].title, '');
  });
});

describe('migration of a legacy chat.json', () => {
  function writeLegacy(dir: string, extra: Record<string, unknown> = {}): void {
    fs.mkdirSync(dir, { recursive: true });
    const legacy = {
      version: 1,
      resumeId: 'legacy-session',
      messages: [message(1), message(2, 'agent'), { ...message(3), text: 'Il ponte rotto' }],
      ...extra,
    };
    fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify(legacy));
  }

  it('turns chat.json into one conversation and renames the file to chat.json.migrated', () => {
    const dir = stateDir();
    writeLegacy(dir);
    const store = new ChatStore(dir);
    const list = store.conversations();
    assert.equal(list.length, 1);
    const conv = list[0];
    assert.equal(conv.title, 'testo 1'); // first master message
    assert.equal(conv.messageCount, 3);
    assert.equal(conv.createdAt, message(1).at);
    assert.equal(conv.updatedAt, message(3).at);
    assert.deepEqual(store.messages(conv.id), [message(1), message(2, 'agent'), { ...message(3), text: 'Il ponte rotto' }]);
    assert.equal(store.resumeId(conv.id), 'legacy-session');
    assert.ok(!fs.existsSync(path.join(dir, 'chat.json')));
    assert.ok(fs.existsSync(path.join(dir, 'chat.json.migrated')));
    assert.ok(fs.existsSync(path.join(chatsDir(dir), `${conv.id}.json`)));
  });

  it('a migrated conversation survives a reload', async () => {
    const dir = stateDir();
    writeLegacy(dir);
    const id = new ChatStore(dir).currentId();
    const reopened = new ChatStore(dir);
    assert.equal(reopened.currentId(), id);
    assert.equal(reopened.messages(id).length, 3);
    assert.equal(reopened.resumeId(id), 'legacy-session');
  });

  it('runs only once: a later chat.json is left alone when a conversation already exists', () => {
    const dir = stateDir();
    writeLegacy(dir);
    const first = new ChatStore(dir);
    const id = first.currentId();
    writeLegacy(dir, { resumeId: 'other', messages: [message(9)] });
    const second = new ChatStore(dir);
    assert.deepEqual(second.conversations().map((c) => c.id), [id]);
    assert.equal(second.messages(id).length, 3);
    assert.equal(second.resumeId(id), 'legacy-session');
    assert.ok(fs.existsSync(path.join(dir, 'chat.json')));
  });

  it('migrates an empty legacy chat to an empty conversation with times from now', () => {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify({ version: 1, messages: [] }));
    const before = Date.now();
    const store = new ChatStore(dir);
    const conv = store.conversations()[0];
    assert.equal(conv.messageCount, 0);
    assert.equal(conv.title, '');
    assert.ok(Date.parse(conv.createdAt) >= before);
    assert.ok(fs.existsSync(path.join(dir, 'chat.json.migrated')));
  });

  it('drops a malformed steps field of a legacy message and keeps the message', async () => {
    const dir = stateDir();
    fs.mkdirSync(dir, { recursive: true });
    const old = { version: 1, messages: [message(1), { ...message(2, 'agent'), steps: 'rotto' }] };
    fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify(old));
    const store = new ChatStore(dir);
    const id = store.currentId();
    assert.deepEqual(store.messages(id), [message(1), message(2, 'agent')]);
    assert.equal(fs.existsSync(path.join(dir, 'chat.json.bak')), false);
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
    const id = store.currentId();
    await store.addMessage(id, { ...message(1, 'agent'), steps });
    await store.flush();
    const reopened = new ChatStore(dir);
    assert.deepEqual(reopened.messages(id)[0].steps, steps);
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
