import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService, isApiFailure } from './api.service';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('ApiService failures', () => {
  let api: ApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    api = TestBed.inject(ApiService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function failureOf(response: Response): Promise<unknown> {
    vi.stubGlobal('fetch', vi.fn(async () => response));
    try {
      await api.status();
    } catch (failure) {
      return failure;
    }
    throw new Error('the call did not fail');
  }

  it('keeps the server error string', async () => {
    const failure = await failureOf(jsonResponse(404, { error: 'Document not found.' }));
    expect(failure).toEqual({ error: 'Document not found.', status: 404 });
    expect(isApiFailure(failure)).toBe(true);
  });

  it('uses the server message as the plain text when the body has only a message (undo 409)', async () => {
    const failure = await failureOf(
      jsonResponse(409, { ok: false, message: 'Save the open changes first.' }),
    );
    expect(failure).toEqual({ error: 'Save the open changes first.', status: 409, message: 'Save the open changes first.' });
  });

  it('falls back to the generic text when the body is not JSON', async () => {
    const failure = await failureOf(new Response('<html>', { status: 500 }));
    expect(failure).toMatchObject({ status: 500, error: expect.any(String) });
    expect((failure as { error: string }).error).not.toBe('');
  });

  it('rejects with a network failure when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    await expect(api.status()).rejects.toMatchObject({ status: 0, error: expect.any(String) });
  });
});

describe('ApiService conversations', () => {
  let api: ApiService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    api = TestBed.inject(ApiService);
    fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function lastCall(): { url: string; init: RequestInit } {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
    return { url, init };
  }

  it('lists the conversations with GET /api/chats', async () => {
    await api.conversations();
    expect(lastCall()).toMatchObject({ url: '/api/chats', init: { method: 'GET' } });
  });

  it('creates a conversation with POST /api/chats', async () => {
    await api.createConversation();
    expect(lastCall()).toMatchObject({ url: '/api/chats', init: { method: 'POST' } });
  });

  it('deletes a conversation by its encoded id', async () => {
    await api.deleteConversation('a/b c');
    expect(lastCall()).toMatchObject({ url: '/api/chats/a%2Fb%20c', init: { method: 'DELETE' } });
  });

  it('loads the shown conversation by its id, encoded in the query', async () => {
    await api.chat('c 1&x');
    expect(lastCall().url).toBe('/api/chat?conversationId=c+1%26x');
  });

  it('loads the default conversation when no id is given', async () => {
    await api.chat();
    expect(lastCall().url).toBe('/api/chat');
  });

  it('sends the conversation id in the message body only when given', async () => {
    await api.sendMessage('hello', { model: 'haiku' }, 'c2');
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ text: 'hello', model: 'haiku', conversationId: 'c2' });

    await api.sendMessage('plain');
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ text: 'plain' });
  });
});
