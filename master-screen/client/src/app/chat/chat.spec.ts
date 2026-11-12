import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatResponse, StatusResponse } from '@shared/types';
import { ApiService } from '../core/api.service';
import { LiveService } from '../core/live.service';
import { StatusService } from '../core/status.service';
import { Chat } from './chat';

class FakeLive {
  private readonly subjects = new Map<string, Subject<unknown>>();
  private readonly resyncs = new Subject<void>();
  readonly resync$ = this.resyncs.asObservable();
  readonly connected = signal(true);

  on(name: string) {
    return this.subject(name).asObservable();
  }

  emit(name: string, data: unknown): void {
    this.subject(name).next(data);
  }

  private subject(name: string): Subject<unknown> {
    let found = this.subjects.get(name);
    if (!found) {
      found = new Subject<unknown>();
      this.subjects.set(name, found);
    }
    return found;
  }
}

function status(available: boolean, reason?: string): StatusResponse {
  return {
    ok: true,
    campaign: { name: 'Test', slug: 'test', language: 'en' },
    frameworkVersion: '0.0.0',
    modules: { music: false, print: false, encyclopedia: false },
    agent: available ? { available: true } : { available: false, reason },
    git: { ok: true },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Chat', () => {
  let fixture: ComponentFixture<Chat>;
  let live: FakeLive;
  let agent: ReturnType<typeof signal<StatusResponse | null>>;
  let api: {
    chat: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    cancelTurn: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    live = new FakeLive();
    agent = signal<StatusResponse | null>(status(false, 'Install Claude Code to talk to the assistant.'));
    api = {
      chat: vi.fn(async (): Promise<ChatResponse> => ({ messages: [], turn: null })),
      sendMessage: vi.fn(async () => ({ messageId: 'm1', turnId: 't1' })),
      cancelTurn: vi.fn(async () => ({ ok: true as const })),
    };
    TestBed.configureTestingModule({
      imports: [Chat],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: LiveService, useValue: live },
        { provide: StatusService, useValue: { status: agent } },
      ],
    });
    fixture = TestBed.createComponent(Chat);
    fixture.detectChanges();
  });

  async function settle(): Promise<void> {
    await flush();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function el<T extends Element = HTMLElement>(selector: string): T | null {
    return (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
  }

  function type(text: string): void {
    const textarea = el<HTMLTextAreaElement>('textarea');
    if (!textarea) throw new Error('no composer');
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('disables the composer and shows the plain reason when there is no agent', async () => {
    await settle();
    expect(el<HTMLTextAreaElement>('textarea')?.disabled).toBe(true);
    expect(el<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(el('.notice')?.textContent).toContain('Install Claude Code');
  });

  it('keeps the composer disabled while the status is not loaded yet', async () => {
    agent.set(null);
    await settle();
    expect(el<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it('enables the composer for a non-empty draft when the agent is available', async () => {
    agent.set(status(true));
    await settle();
    expect(el<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    type('Crea una locanda');
    expect(el<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    expect(el('.notice')).toBeNull();
  });

  it('shows a master message only after the live message event confirms it', async () => {
    agent.set(status(true));
    await settle();
    type('hello');

    el<HTMLButtonElement>('button[type="submit"]')?.click();
    await settle();
    expect(api.sendMessage).toHaveBeenCalledWith('hello');
    expect(el('[data-message-id="m1"]')).toBeNull();
    expect(el<HTMLTextAreaElement>('textarea')?.value).toBe('');

    live.emit('message', { id: 'm1', role: 'master', text: 'hello', at: '2026-11-12T10:00:00.000Z' } satisfies ChatMessage);
    await settle();
    expect(el('[data-message-id="m1"]')?.textContent).toContain('hello');
  });

  it('keeps the text and shows the plain error when sending fails', async () => {
    agent.set(status(true));
    api.sendMessage.mockRejectedValueOnce({ error: 'The assistant is busy.', status: 503 });
    await settle();
    type('again');
    el<HTMLButtonElement>('button[type="submit"]')?.click();
    await settle();
    expect(el<HTMLTextAreaElement>('textarea')?.value).toBe('again');
    expect(el('.error')?.textContent).toContain('The assistant is busy.');
  });

  it('keeps the send call pending until the deferred acknowledgement arrives', async () => {
    agent.set(status(true));
    const ack = deferred<{ messageId: string; turnId: string }>();
    api.sendMessage.mockReturnValueOnce(ack.promise);
    await settle();
    type('wait');
    el<HTMLButtonElement>('button[type="submit"]')?.click();
    await settle();
    expect(el('[data-message-id]')).toBeNull();
    ack.resolve({ messageId: 'm1', turnId: 't1' });
    await settle();
    expect(el<HTMLTextAreaElement>('textarea')?.value).toBe('');
  });
});
