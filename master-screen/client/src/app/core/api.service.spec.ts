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
