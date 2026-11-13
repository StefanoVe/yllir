import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlignStatus, ChatMessage, ChatResponse, Turn } from '@shared/types';
import { ApiService } from '../core/api.service';
import { ALIGN_POLL_MS, UpdateAlign } from './update-align';

const AT = '2026-11-14T10:00:00.000Z';

function message(id: string, role: ChatMessage['role'], text: string): ChatMessage {
  return { id, role, text, at: AT };
}

function turn(state: Turn['state']): Turn {
  return { id: 't1', messageId: 'm2', state, activity: 'Reading the sheets', startedAt: AT };
}

/** A fake server: the alignment state and the conversation are plain variables the tests change. */
function makeApi() {
  const fake = {
    current: { state: 'none', conversationId: null } as AlignStatus,
    response: { conversationId: 'c1', messages: [], turn: null } as ChatResponse,
    alignStatus: vi.fn(async (): Promise<AlignStatus> => ({ ...fake.current })),
    startAlign: vi.fn(async (): Promise<AlignStatus> => {
      fake.current = { state: 'running', conversationId: 'c1' };
      return { ...fake.current };
    }),
    chat: vi.fn(async (conversationId?: string): Promise<ChatResponse> => ({ ...fake.response, conversationId: conversationId ?? 'c1' })),
    sendMessage: vi.fn(async () => ({ messageId: 'm9', turnId: 't9' })),
  };
  return fake;
}

let api: ReturnType<typeof makeApi>;

/** Lets pending promises and timers run, then renders. */
async function settle(fixture: ComponentFixture<UpdateAlign>, ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  fixture.detectChanges();
}

async function create(initial: AlignStatus): Promise<ComponentFixture<UpdateAlign>> {
  api.current = initial;
  const fixture = TestBed.createComponent(UpdateAlign);
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

function el(fixture: ComponentFixture<UpdateAlign>, selector: string): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);
}

function textarea(fixture: ComponentFixture<UpdateAlign>): HTMLTextAreaElement {
  return el(fixture, 'textarea') as HTMLTextAreaElement;
}

function closeButton(fixture: ComponentFixture<UpdateAlign>): HTMLButtonElement | null {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === 'Close',
  ) as HTMLButtonElement | undefined ?? null;
}

function escape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

describe('UpdateAlign', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api = makeApi();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: ApiService, useValue: api }],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('stays closed when the alignment is not needed', async () => {
    const fixture = await create({ state: 'none', conversationId: null });
    expect(el(fixture, '.align-panel')).toBeNull();
    expect(api.startAlign).not.toHaveBeenCalled();
  });

  it('opens by itself when needed and starts the alignment once, with no button to press', async () => {
    api.current = { state: 'needed', conversationId: null };
    const fixture = await create({ state: 'needed', conversationId: null });
    expect(el(fixture, '.align-panel')).not.toBeNull();
    expect(api.startAlign).toHaveBeenCalledTimes(1);
    expect(el(fixture, 'h2')?.textContent?.trim()).toBe('Updating your campaign');
    expect(el(fixture, '.hint')?.textContent?.trim()).toBe('Wait, I am working');
  });

  it('does not start again while the polling reads the state', async () => {
    api.current = { state: 'needed', conversationId: null };
    const fixture = await create({ state: 'needed', conversationId: null });
    await settle(fixture, ALIGN_POLL_MS * 3);
    expect(api.startAlign).toHaveBeenCalledTimes(1);
  });

  it('opens after a reload while the alignment runs, without starting it again', async () => {
    const fixture = await create({ state: 'running', conversationId: 'c1' });
    expect(el(fixture, '.align-panel')).not.toBeNull();
    expect(api.startAlign).not.toHaveBeenCalled();
    expect(api.chat).toHaveBeenCalledWith('c1');
  });

  it('shows the assistant messages and hides the written prompt', async () => {
    api.response = {
      conversationId: 'c1',
      messages: [message('m1', 'master', 'PROMPT TEXT'), message('m2', 'agent', 'Here is what changed')],
      turn: null,
    };
    const fixture = await create({ state: 'running', conversationId: 'c1' });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Here is what changed');
    expect(text).not.toContain('PROMPT TEXT');
  });

  it('disables the text box while it runs', async () => {
    const fixture = await create({ state: 'running', conversationId: 'c1' });
    expect(textarea(fixture).disabled).toBe(true);
    expect(el(fixture, '.hint')?.textContent?.trim()).toBe('Wait, I am working');
  });

  it('enables the text box only while waiting for an answer, and sends a reply with the conversation id only', async () => {
    const fixture = await create({ state: 'waiting-answer', conversationId: 'c1' });
    const input = textarea(fixture);
    expect(input.disabled).toBe(false);
    expect(el(fixture, '.hint')?.textContent?.trim()).toBe('Answer the question');

    input.value = 'The harbour';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el(fixture, 'form')?.dispatchEvent(new Event('submit'));
    await settle(fixture);

    expect(api.sendMessage).toHaveBeenCalledWith('The harbour', {}, 'c1');
  });

  it('polls the conversation while it runs and stops once it is done', async () => {
    const fixture = await create({ state: 'running', conversationId: 'c1' });
    api.current = { state: 'done', conversationId: 'c1' };
    await settle(fixture, ALIGN_POLL_MS);
    expect(el(fixture, '.final')?.textContent?.trim()).toBe('Your campaign now works with the updated Yllir.');

    const reads = api.alignStatus.mock.calls.length;
    const chats = api.chat.mock.calls.length;
    await settle(fixture, ALIGN_POLL_MS * 4);
    expect(api.alignStatus.mock.calls.length).toBe(reads);
    expect(api.chat.mock.calls.length).toBe(chats);
  });

  it('keeps the page reading the state while it runs', async () => {
    const fixture = await create({ state: 'running', conversationId: 'c1' });
    const reads = api.alignStatus.mock.calls.length;
    await settle(fixture, ALIGN_POLL_MS * 2);
    expect(api.alignStatus.mock.calls.length).toBeGreaterThan(reads);
  });

  it('shows the running work of the turn as the activity line', async () => {
    api.response = { conversationId: 'c1', messages: [], turn: turn('running') };
    const fixture = await create({ state: 'running', conversationId: 'c1' });
    expect(el(fixture, '.activity')?.textContent).toContain('Reading the sheets');
  });

  it('shows Close and the done sentence only when done, and Close hides the modal without sending anything', async () => {
    const fixture = await create({ state: 'running', conversationId: 'c1' });
    expect(closeButton(fixture)).toBeNull();

    api.current = { state: 'done', conversationId: 'c1' };
    await settle(fixture, ALIGN_POLL_MS);
    expect(closeButton(fixture)).not.toBeNull();
    expect(textarea(fixture).disabled).toBe(true);

    closeButton(fixture)?.click();
    fixture.detectChanges();
    expect(el(fixture, '.align-panel')).toBeNull();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('shows the failure sentence and Close when the alignment fails while it runs', async () => {
    const fixture = await create({ state: 'running', conversationId: 'c1' });
    api.current = { state: 'failed', conversationId: null };
    await settle(fixture, ALIGN_POLL_MS);
    expect(el(fixture, '.final')?.textContent?.trim()).toBe('The update could not be completed. Nothing was changed that you wrote.');
    expect(closeButton(fixture)).not.toBeNull();
  });

  it('ignores Escape while it runs or waits for an answer', async () => {
    const running = await create({ state: 'running', conversationId: 'c1' });
    escape();
    running.detectChanges();
    expect(el(running, '.align-panel')).not.toBeNull();
    running.destroy();

    const waiting = await create({ state: 'waiting-answer', conversationId: 'c1' });
    escape();
    waiting.detectChanges();
    expect(el(waiting, '.align-panel')).not.toBeNull();
  });

  it('closes with Escape once done', async () => {
    const fixture = await create({ state: 'running', conversationId: 'c1' });
    api.current = { state: 'done', conversationId: 'c1' };
    await settle(fixture, ALIGN_POLL_MS);
    escape();
    fixture.detectChanges();
    expect(el(fixture, '.align-panel')).toBeNull();
  });

  it('ends as failed when the start is refused and the state is still needed', async () => {
    api.startAlign.mockImplementationOnce(async () => {
      throw { error: 'refused', status: 409 };
    });
    const fixture = await create({ state: 'needed', conversationId: null });
    expect(el(fixture, '.final')?.textContent?.trim()).toBe('The update could not be completed. Nothing was changed that you wrote.');
    expect(closeButton(fixture)).not.toBeNull();
  });

  it('follows a start refused because the alignment already runs', async () => {
    api.startAlign.mockImplementationOnce(async () => {
      api.current = { state: 'running', conversationId: 'c1' };
      throw { error: 'refused', status: 409 };
    });
    const fixture = await create({ state: 'needed', conversationId: null });
    expect(el(fixture, '.final')).toBeNull();
    expect(textarea(fixture).disabled).toBe(true);
  });
});
