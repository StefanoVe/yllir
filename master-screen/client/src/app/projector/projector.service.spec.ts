import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectorService } from './projector.service';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('ProjectorService', () => {
  let service: ProjectorService;
  let fakeWindow: { closed: boolean; focus: ReturnType<typeof vi.fn> };
  let openSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fakeWindow = { closed: false, focus: vi.fn() };
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => fakeWindow as unknown as Window);
    fetchMock = vi.fn(async () => jsonResponse(200, { kind: 'image', src: '/x.png' }));
    vi.stubGlobal('fetch', fetchMock);
    service = TestBed.inject(ProjectorService);
  });

  afterEach(() => {
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
});
