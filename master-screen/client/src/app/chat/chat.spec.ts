import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChatMessage,
  ChatResponse,
  Conversation,
  ConversationsResponse,
  StatusResponse,
  Turn,
  TurnStep,
} from '@shared/types';
import { ApiService } from '../core/api.service';
import { LiveService } from '../core/live.service';
import { StatusService } from '../core/status.service';
import { PrefsService } from '../core/prefs.service';
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

function conversation(id: string, title: string): Conversation {
  return { id, title, createdAt: AT, updatedAt: AT, messageCount: 0 };
}

const AT = '2026-11-12T10:00:00.000Z';

describe('Chat', () => {
  let fixture: ComponentFixture<Chat>;
  let live: FakeLive;
  let agent: ReturnType<typeof signal<StatusResponse | null>>;
  let api: {
    chat: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    cancelTurn: ReturnType<typeof vi.fn>;
    conversations: ReturnType<typeof vi.fn>;
    createConversation: ReturnType<typeof vi.fn>;
    deleteConversation: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();
    live = new FakeLive();
    agent = signal<StatusResponse | null>(status(false, 'Install Claude Code to talk to the assistant.'));
    api = {
      conversations: vi.fn(async (): Promise<ConversationsResponse> => ({
        conversations: [conversation('c2', 'La locanda'), conversation('c1', '')],
        currentId: 'c1',
        turn: null,
      })),
      chat: vi.fn(async (id?: string): Promise<ChatResponse> => ({
        conversationId: id ?? 'c1',
        messages: [],
        turn: null,
      })),
      sendMessage: vi.fn(async () => ({ messageId: 'm1', turnId: 't1' })),
      cancelTurn: vi.fn(async () => ({ ok: true as const })),
      createConversation: vi.fn(async () => conversation('c3', '')),
      deleteConversation: vi.fn(async () => ({ ok: true as const })),
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
    expect(api.sendMessage).toHaveBeenCalledWith('hello', { model: 'sonnet', effort: 'medium' }, 'c1');
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

  function trigger(name: 'model' | 'effort'): HTMLButtonElement {
    const found = el<HTMLButtonElement>(`[data-menu-trigger="${name}"]`);
    if (!found) throw new Error(`no ${name} trigger`);
    return found;
  }

  function menu(): HTMLElement | null {
    return el<HTMLElement>('[role="menu"]');
  }

  function item(name: string, label: string): HTMLButtonElement | undefined {
    return Array.from(el(`[data-menu="${name}"]`)?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
      .find((button) => button.textContent?.includes(label));
  }

  it('shows Sonnet and Medium as the default choice', async () => {
    await settle();
    expect(trigger('model').textContent).toContain('Sonnet');
    expect(trigger('effort').textContent).toContain('Medium');
    expect(trigger('model').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens a menu, selects a model, saves it and closes with focus back on the button', async () => {
    await settle();
    trigger('model').click();
    await settle();
    expect(trigger('model').getAttribute('aria-expanded')).toBe('true');
    expect(menu()?.getAttribute('role')).toBe('menu');
    item('model', 'Opus')?.click();
    await settle();
    expect(menu()).toBeNull();
    expect(trigger('model').textContent).toContain('Opus');
    expect(trigger('model').getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(localStorage.getItem('yllir:chat-choice') ?? '{}')).toEqual({ model: 'opus', effort: 'medium' });
  });

  it('restores the saved choice on the next visit', async () => {
    localStorage.setItem('yllir:chat-choice', JSON.stringify({ model: 'haiku', effort: 'high' }));
    fixture.destroy();
    fixture = TestBed.createComponent(Chat);
    fixture.detectChanges();
    await settle();
    expect(trigger('model').textContent).toContain('Haiku');
    expect(trigger('effort').textContent).toContain('High');
  });

  it('falls back to the default when the saved choice is not valid', async () => {
    localStorage.setItem('yllir:chat-choice', '{"model":"gpt","effort":42}');
    fixture.destroy();
    fixture = TestBed.createComponent(Chat);
    fixture.detectChanges();
    await settle();
    expect(trigger('model').textContent).toContain('Sonnet');
    expect(trigger('effort').textContent).toContain('Medium');
  });

  it('sends the chosen model and thinking level with the message', async () => {
    agent.set(status(true));
    await settle();
    trigger('model').click();
    await settle();
    item('model', 'Haiku')?.click();
    await settle();
    trigger('effort').click();
    await settle();
    item('effort', 'Max')?.click();
    await settle();
    type('deep one');
    el<HTMLButtonElement>('button[type="submit"]')?.click();
    await settle();
    expect(api.sendMessage).toHaveBeenCalledWith('deep one', { model: 'haiku', effort: 'max' }, 'c1');
  });

  it('closes the menu on Escape and returns focus to its button', async () => {
    await settle();
    trigger('effort').focus();
    trigger('effort').click();
    await settle();
    expect(document.activeElement?.getAttribute('role')).toBe('menuitemradio');
    menu()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(menu()).toBeNull();
    expect(trigger('effort').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger('effort'));
  });

  it('moves between choices with the arrow keys', async () => {
    await settle();
    trigger('model').click();
    await settle();
    const first = document.activeElement as HTMLElement;
    expect(first.getAttribute('aria-checked')).toBe('true');
    menu()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await settle();
    expect(document.activeElement?.textContent).toContain('Opus');
    menu()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await settle();
    expect(document.activeElement?.textContent).toContain('Sonnet');
  });

  it('closes the menu when the master clicks outside it', async () => {
    await settle();
    trigger('model').click();
    await settle();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(menu()).toBeNull();
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

  describe('steps', () => {
    const STEP_AT = '2026-11-12T10:00:00.000Z';
    const runningTurn = (steps: TurnStep[]): Turn => ({
      id: 't1',
      messageId: 'm1',
      state: 'running',
      activity: 'Working',
      startedAt: STEP_AT,
      steps,
    });

    it('shows the latest running step on the status line and toggles the list', async () => {
      agent.set(status(true));
      await settle();
      live.emit('turn', runningTurn([
        { id: 's1', kind: 'read', text: 'Reading the sheet', at: STEP_AT, state: 'done', endedAt: STEP_AT },
        { id: 's2', kind: 'write', text: 'Writing the sheet', at: STEP_AT, state: 'running' },
      ]));
      await settle();
      expect(el('.status .activity')?.textContent?.trim()).toBe('Writing the sheet');
      const toggle = el<HTMLButtonElement>('.steps-toggle');
      expect(toggle?.getAttribute('aria-expanded')).toBe('false');
      expect(el('.steps-live')).toBeNull();

      toggle?.click();
      await settle();
      expect(el<HTMLButtonElement>('.steps-toggle')?.getAttribute('aria-expanded')).toBe('true');
      expect(el('.steps-live [role="list"]')?.querySelectorAll('li').length).toBe(2);
      expect(localStorage.getItem('yllir:chat-steps')).toBe('1');
    });

    it('shows a disclosure with the steps under a finished agent message', async () => {
      agent.set(status(true));
      await settle();
      live.emit('message', {
        id: 'a1',
        role: 'agent',
        text: 'Done.',
        at: STEP_AT,
        steps: [{ id: 's1', kind: 'save', text: 'Saved', at: STEP_AT, endedAt: STEP_AT, state: 'done' }],
      });
      await settle();
      const summary = el('details.steps-done summary');
      expect(summary?.textContent?.trim()).toBe('What I did (1 step)');
      expect(el('[data-message-id="a1"] .steps-done li')).not.toBeNull();
    });

    it('shows the helper assistants above the status line while they work, and hides them when the turn ends', async () => {
      agent.set(status(true));
      await settle();
      live.emit('turn', runningTurn([
        { id: 'h1', kind: 'agent', text: 'Writing the innkeeper sheet', at: STEP_AT, state: 'running' },
      ]));
      await settle();
      expect(el('ms-helpers-indicator .count')?.textContent?.trim()).toBe('1 assistant working');
      expect(el('ms-helpers-indicator .item')?.textContent?.trim()).toBe('Writing the innkeeper sheet');
      live.emit('turn', { ...runningTurn([{ id: 'h1', kind: 'agent', text: 'Done', at: STEP_AT, state: 'done', endedAt: STEP_AT }]), state: 'done' });
      await settle();
      expect(el('ms-helpers-indicator .count')).toBeNull();
    });
  });

  describe('conversations', () => {
    function openList(): void {
      el<HTMLButtonElement>('[data-conv-trigger]')?.click();
    }

    function rows(): HTMLElement[] {
      return Array.from(fixture.nativeElement.querySelectorAll('.conv-row') as NodeListOf<HTMLElement>);
    }

    it('shows the shown conversation by its default name, and lists them newest first', async () => {
      agent.set(status(true));
      await settle();
      expect(el('[data-conv-trigger] .conv-current')?.textContent?.trim()).toBe('New conversation');
      openList();
      await settle();
      expect(el('[data-conv-trigger]')?.getAttribute('aria-expanded')).toBe('true');
      expect(rows()).toHaveLength(2);
      expect(rows()[0].textContent).toContain('La locanda');
      expect(rows()[1].textContent).toContain('New conversation');
      expect(rows()[1].querySelector('.conv-time')).not.toBeNull();
      expect(rows()[1].classList.contains('current')).toBe(true);
    });

    it('closes the list on Escape and gives the focus back to its button', async () => {
      await settle();
      openList();
      await settle();
      const pop = el('.conv-pop');
      pop?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(el('.conv-pop')).toBeNull();
      expect(document.activeElement).toBe(el('[data-conv-trigger]'));
    });

    it('creates a conversation and shows it', async () => {
      await settle();
      el<HTMLButtonElement>('.conv-new')?.click();
      await settle();
      expect(api.createConversation).toHaveBeenCalledTimes(1);
      expect(api.chat).toHaveBeenLastCalledWith('c3');
      expect(el('[data-conv-trigger] .conv-current')?.textContent?.trim()).toBe('New conversation');
    });

    it('switches to a picked conversation and loads its history', async () => {
      await settle();
      openList();
      await settle();
      el<HTMLButtonElement>('[data-conv-pick="c2"]')?.click();
      await settle();
      expect(api.chat).toHaveBeenLastCalledWith('c2');
      expect(el('[data-conv-trigger] .conv-current')?.textContent?.trim()).toBe('La locanda');
      expect(el('.conv-pop')).toBeNull();
    });

    it('asks inline before deleting, and cancelling deletes nothing', async () => {
      await settle();
      openList();
      await settle();
      el<HTMLButtonElement>('[data-conv-del="c2"]')?.click();
      await settle();
      expect(el('.conv-confirm-text')?.textContent).toContain('Delete this conversation?');
      expect(api.deleteConversation).not.toHaveBeenCalled();
      el<HTMLButtonElement>('.conv-action:not(.danger)')?.click();
      await settle();
      expect(el('.conv-confirm')).toBeNull();
      expect(api.deleteConversation).not.toHaveBeenCalled();
    });

    it('deletes after the confirmation and switches to the current conversation when the shown one is deleted', async () => {
      await settle();
      openList();
      await settle();
      api.conversations.mockResolvedValueOnce({
        conversations: [conversation('c2', 'La locanda')],
        currentId: 'c2',
        turn: null,
      } satisfies ConversationsResponse);
      el<HTMLButtonElement>('[data-conv-del="c1"]')?.click();
      await settle();
      el<HTMLButtonElement>('.conv-action.danger')?.click();
      await settle();
      expect(api.deleteConversation).toHaveBeenCalledWith('c1');
      expect(api.chat).toHaveBeenLastCalledWith('c2');
      expect(el('[data-conv-trigger] .conv-current')?.textContent?.trim()).toBe('La locanda');
    });

    it('shows the queued notice when the shown conversation waits for another conversation\'s turn', async () => {
      agent.set(status(true));
      await settle();
      live.emit('turn', { id: 't9', messageId: 'm9', state: 'running', activity: '', startedAt: AT, conversationId: 'c2' } satisfies Turn);
      await settle();
      expect(el('.notice.queued')).toBeNull();
      live.emit('turn', { id: 't2', messageId: 'm2', state: 'queued', activity: '', startedAt: AT, conversationId: 'c1' } satisfies Turn);
      await settle();
      expect(el('.notice.queued')?.textContent).toContain('Another conversation is working');
    });

    it('does not show a message or a delta of another conversation', async () => {
      agent.set(status(true));
      await settle();
      live.emit('message', { id: 'x1', role: 'master', text: 'elsewhere', at: AT, conversationId: 'c2' });
      live.emit('message', { id: 'x2', role: 'master', text: 'here', at: AT, conversationId: 'c1' });
      await settle();
      expect(el('[data-message-id="x1"]')).toBeNull();
      expect(el('[data-message-id="x2"]')?.textContent).toContain('here');
    });

    it('disables sending while another conversation is loading', async () => {
      agent.set(status(true));
      await settle();
      type('hello');
      expect(el<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
      const pending = deferred<ChatResponse>();
      api.chat.mockReturnValueOnce(pending.promise);
      openList();
      await settle();
      el<HTMLButtonElement>('[data-conv-pick="c2"]')?.click();
      await settle();
      expect(el<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
      pending.resolve({ conversationId: 'c2', messages: [], turn: null });
      await settle();
      expect(el<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    });
  });
  describe('saved conversation', () => {
    it('shows the saved conversation once the campaign slug arrives after the first load', async () => {
      localStorage.setItem('yllir:test:chat.conversation', 'c2');
      await settle();
      expect(el('[data-conv-trigger] .conv-current')?.textContent?.trim()).toBe('New conversation');
      TestBed.inject(PrefsService).setCampaign('test');
      await settle();
      expect(api.chat).toHaveBeenLastCalledWith('c2');
      expect(el('[data-conv-trigger] .conv-current')?.textContent?.trim()).toBe('La locanda');
    });

    it('keeps the conversation the master picked when the campaign slug arrives later', async () => {
      localStorage.setItem('yllir:test:chat.conversation', 'c2');
      await settle();
      el<HTMLButtonElement>('[data-conv-trigger]')?.click();
      await settle();
      el<HTMLButtonElement>('[data-conv-pick="c1"]')?.click();
      await settle();
      TestBed.inject(PrefsService).setCampaign('test');
      await settle();
      expect(api.chat).not.toHaveBeenCalledWith('c2');
      expect(el('[data-conv-trigger] .conv-current')?.textContent?.trim()).toBe('New conversation');
    });
  });
});
