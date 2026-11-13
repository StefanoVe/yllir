import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '@shared/types';
import { RESTART_GIVE_UP_MS, UPDATE_POLL_MS, UpdateService } from './update';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function status(partial: Partial<UpdateStatus> = {}): UpdateStatus {
  return { state: 'idle', news: null, snoozed: false, canApply: true, blockedReason: null, ...partial };
}

/** A fake server: `route` answers each call by method and path. Throwing from it simulates a dropped connection. */
function serve(route: (method: string, path: string) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => route(init?.method ?? 'GET', url.replace(/^\/api/, '')));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('UpdateService', () => {
  let current: UpdateStatus;
  let service: UpdateService;

  beforeEach(() => {
    vi.useFakeTimers();
    current = status();
    serve((method, path) => {
      if (method === 'GET' && path === '/update') return json(200, current);
      throw new Error(`unexpected ${method} ${path}`);
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function start(): Promise<UpdateService> {
    service = TestBed.inject(UpdateService);
    await vi.advanceTimersByTimeAsync(0);
    return service;
  }

  it('reads the status at startup and shows the notice only when an update is available and not postponed', async () => {
    current = status({ state: 'available', news: 'New cards.' });
    await start();
    expect(service.status()?.state).toBe('available');
    expect(service.showNotice()).toBe(true);
  });

  it('keeps the notice hidden once the master said later', async () => {
    current = status({ state: 'available', snoozed: true });
    await start();
    expect(service.showNotice()).toBe(false);
  });

  it('reads the status again when the window regains focus', async () => {
    current = status({ state: 'idle' });
    const fetchMock = serve((method, path) => (method === 'GET' && path === '/update' ? json(200, current) : json(404, { error: 'no' })));
    await start();
    const before = fetchMock.mock.calls.length;
    current = status({ state: 'available' });
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    expect(service.showNotice()).toBe(true);
  });

  it('check posts a fresh check and then reads the status', async () => {
    const fetchMock = serve((method, path) => {
      if (method === 'POST' && path === '/update/check') return json(200, status());
      return json(200, current);
    });
    await start();
    await service.check();
    expect(fetchMock.mock.calls.map((call) => [call[1]?.method, call[0]])).toEqual(
      expect.arrayContaining([['POST', '/api/update/check']]),
    );
    expect(service.checking()).toBe(false);
  });

  it('snooze posts to the server and takes the status it returns', async () => {
    current = status({ state: 'available' });
    await start();
    serve((method, path) => (method === 'POST' && path === '/update/snooze' ? json(200, status({ state: 'available', snoozed: true })) : json(200, current)));
    await service.snooze();
    expect(service.status()?.snoozed).toBe(true);
    expect(service.showNotice()).toBe(false);
  });

  it('a refused apply (409) keeps the state and shows the server sentence as the reason', async () => {
    current = status({ state: 'available', canApply: false, blockedReason: 'live-open' });
    await start();
    serve((method, path) => {
      if (method === 'POST' && path === '/update/apply') return json(409, { error: 'A live table is open: close it first' });
      return json(200, current);
    });
    await service.apply();
    expect(service.actionError()).toBe('A live table is open: close it first');
    expect(service.status()?.state).toBe('available');
    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS * 3);
    expect(service.status()?.state).toBe('available');
  });

  it('an accepted apply shows the update at once and polls every 2 s until the server is idle again', async () => {
    current = status({ state: 'available', news: 'Better search.' });
    await start();
    // One state per poll: the first poll still says updating, then restarting, then idle (polling stops there).
    const steps: UpdateStatus['state'][] = ['updating', 'restarting', 'idle'];
    let calls = 0;
    const fetchMock = serve((method, path) => {
      if (method === 'POST' && path === '/update/apply') return json(202, { ok: true });
      if (method === 'GET' && path === '/update') {
        current = status({ state: steps[Math.min(calls, steps.length - 1)] });
        calls += 1;
        return json(200, current);
      }
      return json(500, { error: 'unexpected' });
    });

    await service.apply();
    expect(service.status()?.state).toBe('updating');
    expect(service.status()?.news).toBe('Better search.');

    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS);
    expect(service.status()?.state).toBe('updating');
    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS);
    expect(service.status()?.state).toBe('restarting');
    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS);
    expect(service.status()?.state).toBe('idle');

    const reads = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS * 5);
    expect(fetchMock.mock.calls.length).toBe(reads);
  });

  it('while restarting, failed reads are quiet and keep polling; the reopen notice comes after 60 s of failures', async () => {
    current = status({ state: 'updating' });
    await start();
    let down = false;
    serve((method, path) => {
      if (method === 'POST' && path === '/update/apply') return json(202, { ok: true });
      if (method === 'GET' && path === '/update') {
        if (down) throw new TypeError('connection refused');
        return json(200, current);
      }
      return json(500, {});
    });
    await service.apply();
    current = status({ state: 'restarting' });
    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS);
    expect(service.status()?.state).toBe('restarting');

    down = true;
    await vi.advanceTimersByTimeAsync(RESTART_GIVE_UP_MS - UPDATE_POLL_MS * 2);
    expect(service.reopenNotice()).toBe(false);
    expect(service.actionError()).toBeNull();

    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS * 3);
    expect(service.reopenNotice()).toBe(true);
    expect(service.status()?.state).toBe('restarting');
  });

  it('shows the reopen notice when the connection comes back after failed reads', async () => {
    current = status({ state: 'restarting' });
    await start();
    let down = true;
    serve((method, path) => {
      if (method === 'GET' && path === '/update') {
        if (down) throw new TypeError('connection refused');
        return json(200, current);
      }
      return json(500, {});
    });
    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS * 2);
    expect(service.reopenNotice()).toBe(false);

    down = false;
    current = status({ state: 'idle' });
    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS);
    expect(service.reopenNotice()).toBe(true);
    expect(service.status()?.state).toBe('idle');
  });

  it('retry after a failed update checks first (which clears the failure) and then applies', async () => {
    current = status({ state: 'failed' });
    await start();
    const calls: string[] = [];
    serve((method, path) => {
      calls.push(`${method} ${path}`);
      if (method === 'POST' && path === '/update/check') {
        current = status({ state: 'available' });
        return json(200, current);
      }
      if (method === 'POST' && path === '/update/apply') return json(202, { ok: true });
      return json(200, current);
    });
    await service.retry();
    expect(calls.indexOf('POST /update/check')).toBeLessThan(calls.indexOf('POST /update/apply'));
    expect(calls.indexOf('POST /update/apply')).toBeGreaterThan(-1);
    expect(service.status()?.state).toBe('updating');
  });

  it('a failed update shows the failed state, and a retry is a new apply', async () => {
    current = status({ state: 'failed' });
    await start();
    expect(service.status()?.state).toBe('failed');
    const fetchMock = serve((method, path) => (method === 'POST' && path === '/update/apply' ? json(202, { ok: true }) : json(200, current)));
    await service.apply();
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === 'POST' && call[0] === '/api/update/apply')).toBe(true);
    expect(service.status()?.state).toBe('updating');
  });

  it('a dropped connection on an ordinary read keeps the last status and sets no error', async () => {
    current = status({ state: 'available' });
    await start();
    serve(() => {
      throw new TypeError('offline');
    });
    await service.load();
    expect(service.status()?.state).toBe('available');
    expect(service.reopenNotice()).toBe(false);
  });

  it('stops polling and listening when the service is destroyed', async () => {
    current = status({ state: 'updating' });
    await start();
    const fetchMock = serve((method, path) => (method === 'GET' && path === '/update' ? json(200, current) : json(500, {})));
    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS);
    const reads = fetchMock.mock.calls.length;
    TestBed.resetTestingModule();
    await vi.advanceTimersByTimeAsync(UPDATE_POLL_MS * 3);
    expect(fetchMock.mock.calls.length).toBe(reads);
  });
});
