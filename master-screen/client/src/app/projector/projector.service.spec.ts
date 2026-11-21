import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectorService, projectorSrc } from './projector.service';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A minimal EventSource: records the listeners the service adds so a test can fire them. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (message: MessageEvent) => void>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, listener: (message: MessageEvent) => void): void {
    this.listeners.set(name, listener);
  }
  close(): void {}
}

/** Lets pending promise callbacks run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('projectorSrc', () => {
  it('reduces an absolute same-origin URL to the relative form', () => {
    expect(projectorSrc('http://127.0.0.1:4317/api/file?path=a%2Fb.png', 'http://127.0.0.1:4317')).toBe(
      '/api/file?path=a%2Fb.png',
    );
  });

  it('leaves a relative URL unchanged', () => {
    expect(projectorSrc('/api/file?path=x.png', 'http://127.0.0.1:4317')).toBe('/api/file?path=x.png');
  });

  it('leaves a URL from another origin unchanged', () => {
    expect(projectorSrc('http://evil.example/x.png', 'http://127.0.0.1:4317')).toBe('http://evil.example/x.png');
  });
});

describe('ProjectorService', () => {
  let service: ProjectorService;
  let fakeWindow: { closed: boolean; focus: ReturnType<typeof vi.fn> };
  let openSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    fakeWindow = { closed: false, focus: vi.fn() };
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => fakeWindow as unknown as Window);
    fetchMock = vi.fn(async () => jsonResponse(200, { kind: 'image', src: '/x.png' }));
    vi.stubGlobal('fetch', fetchMock);
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    service = TestBed.inject(ProjectorService);
    // The constructor fetches the current projection once; the tests below count their own calls.
    await settle();
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens the window before posting when it is closed', async () => {
    const order: string[] = [];
    openSpy.mockImplementation(() => {
      order.push('open');
      return fakeWindow as unknown as Window;
    });
    fetchMock.mockImplementation(async () => {
      order.push('post');
      return jsonResponse(200, { kind: 'image', src: '/x.png' });
    });

    const ok = await service.project('/x.png');

    expect(ok).toBe(true);
    expect(order).toEqual(['open', 'post']);
    expect(openSpy).toHaveBeenCalledWith('/projector', 'yllir-projector', 'popup=yes,width=1280,height=720');
  });

  it('POSTs the image projection body', async () => {
    await service.project('/media/a b.png');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/projector');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'image', src: '/media/a b.png' });
  });

  it('POSTs the relative src when given an absolute same-origin image URL', async () => {
    await service.project(`${location.origin}/api/file?path=a%2Fb.png`);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'image', src: '/api/file?path=a%2Fb.png' });
  });

  it('does not open a second window while one is open', async () => {
    await service.project('/a.png');
    await service.project('/b.png');
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns false on a 403 without throwing', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(403, { error: 'master-only' }));
    await expect(service.project('/secret.png')).resolves.toBe(false);
  });

  it('projectCombat opens the window before posting the combat kind', async () => {
    const order: string[] = [];
    openSpy.mockImplementation(() => {
      order.push('open');
      return fakeWindow as unknown as Window;
    });
    fetchMock.mockImplementation(async () => {
      order.push('post');
      return jsonResponse(200, { kind: 'combat', combat: null });
    });

    await expect(service.projectCombat()).resolves.toBe(true);

    expect(order).toEqual(['open', 'post']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/projector');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'combat' });
    expect(service.current()).toEqual({ kind: 'combat', combat: null });
  });

  it('projectCombat returns false on an error without throwing', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'boom' }));
    await expect(service.projectCombat()).resolves.toBe(false);
  });

  it('posts the blank projection', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { kind: 'blank' }));
    await expect(service.blank()).resolves.toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'blank' });
  });

  it('checks projectability and answers false on error', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { projectable: true }));
    await expect(service.check('/a b.png')).resolves.toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/projector/check?src=%2Fa%20b.png');

    fetchMock.mockImplementation(async () => {
      throw new TypeError('offline');
    });
    await expect(service.check('/a.png')).resolves.toBe(false);
  });

  it('does not open an EventSource until listen() is called', () => {
    expect(FakeEventSource.instances).toHaveLength(0);
    service.listen();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/api/projector/events');
  });

  it('listen() is idempotent: a second call opens no second stream', () => {
    service.listen();
    service.listen();
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('listen() fetches the current projection and polls while no stream is open', async () => {
    vi.useFakeTimers();
    service.listen();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projector')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projector')).toHaveLength(2);
  });

  it('listen() stops polling once the stream is open and frames arrive', async () => {
    vi.useFakeTimers();
    service.listen();
    const source = FakeEventSource.instances[0];
    source.onopen?.();
    source.listeners.get('projection')?.({ data: JSON.stringify({ kind: 'blank' }) } as MessageEvent);
    fetchMock.mockClear();

    await vi.advanceTimersByTimeAsync(15000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.current()).toEqual({ kind: 'blank' });
  });

  it('listen() fetches again on every stream error', async () => {
    vi.useFakeTimers();
    service.listen();
    await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockClear();

    FakeEventSource.instances[0].onerror?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/projector');
  });
});
