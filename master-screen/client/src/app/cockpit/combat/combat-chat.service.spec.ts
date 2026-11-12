import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CombatChatService } from './combat-chat.service';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  onmessage: ((message: { data: string }) => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }));
}

const STAMP = '2026-11-12T10:00:00Z';

function installServer() {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url === '/api/cockpit/sessions/t1/combat/thread' && method === 'POST') return json({ threadId: 'th1' });
      if (url === '/api/cockpit/sessions/th1' && method === 'GET') return json({ id: 'th1', messages: [], turns: [] });
      if (url === '/api/cockpit/sessions/th1/messages' && method === 'POST') return json({});
      return json({ error: 'not found' }, 404);
    }),
  );
  return calls;
}

describe('CombatChatService', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    TestBed.configureTestingModule({ providers: [CombatChatService] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates the combat thread on the first message, then sends the message to it', async () => {
    const calls = installServer();
    const service = TestBed.inject(CombatChatService);
    await service.bind('t1', null);

    await service.send('Find the map', 'c1');

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST /api/cockpit/sessions/t1/combat/thread',
      'GET /api/cockpit/sessions/th1',
      'POST /api/cockpit/sessions/th1/messages',
    ]);
    expect(calls.at(-1)?.body).toEqual({ text: 'Find the map', clientId: 'c1' });
    expect(service.session()?.id).toBe('th1');
    expect(FakeEventSource.instances.at(-1)?.url).toBe('/api/cockpit/sessions/th1/events');
  });

  it('applies a message event and then a delta event to the thread', async () => {
    installServer();
    const service = TestBed.inject(CombatChatService);
    await service.bind('t1', 'th1');
    const source = FakeEventSource.instances.at(-1)!;

    source.emit({
      type: 'message',
      message: { id: 'm1', role: 'agent', text: 'Hel', at: STAMP, turnId: 'turn1', status: 'streaming' },
    });
    source.emit({ type: 'delta', messageId: 'm1', text: 'lo' });

    expect(service.session()?.messages.map((m) => m.text)).toEqual(['Hello']);
    expect(service.session()?.messages[0]?.status).toBe('streaming');
  });

  it('clears the thread and closes its stream when bound to no thread', async () => {
    installServer();
    const service = TestBed.inject(CombatChatService);
    await service.bind('t1', 'th1');
    const source = FakeEventSource.instances.at(-1)!;

    await service.bind('t1', null);

    expect(service.session()).toBeNull();
    expect(source.closed).toBe(true);
  });
});
