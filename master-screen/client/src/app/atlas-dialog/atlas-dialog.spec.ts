import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasGenerationState, AtlasStatus, ChatMessage, ChatResponse, Turn } from '@shared/types';
import { AtlasApiService } from '../atlas/atlas-api.service';
import { ApiService } from '../core/api.service';
import { ATLAS_DIALOG_POLL_MS, AtlasDialog, isAtlasGenerating } from './atlas-dialog';

const AT = '2026-11-19T10:00:00.000Z';

function status(state: AtlasGenerationState, conversationId: string | null = 'c1'): AtlasStatus {
  return {
    exists: state === 'done',
    built: state === 'done',
    pending: 0,
    generation: { state, conversationId, mode: 'create' },
    agent: { available: true },
  };
}

function message(id: string, role: ChatMessage['role'], text: string): ChatMessage {
  return { id, role, text, at: AT };
}

function turn(state: Turn['state']): Turn {
  return { id: 't1', messageId: 'm2', state, activity: 'Reading the sheets', startedAt: AT };
}

/** A fake of the atlas status, the conversation and the sending: the tests change the plain variables. */
function makeApis() {
  const fake = {
    current: status('running'),
    response: { conversationId: 'c1', messages: [], turn: null } as ChatResponse,
    status: vi.fn(async (): Promise<AtlasStatus> => ({ ...fake.current })),
    previewUrl: (version: number) => `/api/atlas/preview.png?v=${version}`,
    chat: vi.fn(async (conversationId?: string): Promise<ChatResponse> => ({ ...fake.response, conversationId: conversationId ?? 'c1' })),
    sendMessage: vi.fn(async () => ({ messageId: 'm9', turnId: 't9' })),
  };
  return fake;
}

let fake: ReturnType<typeof makeApis>;

async function settle(fixture: ComponentFixture<AtlasDialog>, ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  fixture.detectChanges();
}

async function open(state: AtlasGenerationState): Promise<ComponentFixture<AtlasDialog>> {
  fake.current = status(state);
  const fixture = TestBed.createComponent(AtlasDialog);
  fixture.detectChanges();
  fixture.componentInstance.open();
  await settle(fixture);
  return fixture;
}

function el(fixture: ComponentFixture<AtlasDialog>, selector: string): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);
}

describe('AtlasDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake = makeApis();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AtlasApiService, useValue: fake },
        { provide: ApiService, useValue: fake },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('stays closed until it is opened', async () => {
    fake.current = status('running');
    const fixture = TestBed.createComponent(AtlasDialog);
    fixture.detectChanges();
    await settle(fixture);
    expect(el(fixture, '.atlas-panel')).toBeNull();
    expect(fake.status).not.toHaveBeenCalled();
  });

  it('shows the title and the preview, and hides the answer box while the assistant works', async () => {
    const fixture = await open('running');
    expect(el(fixture, '.atlas-panel h2')?.textContent?.trim()).toBe('Campaign atlas');
    const img = el(fixture, '.atlas-preview img') as HTMLImageElement;
    expect(img.getAttribute('alt')).toBe('Map preview');
    expect(img.getAttribute('src')).toContain('/api/atlas/preview.png?v=');
    expect(el(fixture, 'textarea')).toBeNull();
  });

  it('shows the answer box only when the assistant asks a question', async () => {
    fake.current = status('waiting-answer');
    const fixture = await open('waiting-answer');
    expect(el(fixture, 'textarea')).not.toBeNull();
    expect(el(fixture, '#atlas-hint')?.textContent?.trim()).toBe('Answer the question');
  });

  it('sends a typed answer to the conversation of the atlas', async () => {
    const fixture = await open('waiting-answer');
    const area = el(fixture, 'textarea') as HTMLTextAreaElement;
    area.value = 'The north coast';
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el(fixture, 'button.icon-only') as HTMLButtonElement).click();
    await settle(fixture);
    expect(fake.sendMessage).toHaveBeenCalledWith('The north coast', {}, 'c1');
  });

  it('shows the agent messages and drops the prompt the master never sees', async () => {
    fake.response = {
      conversationId: 'c1',
      messages: [message('m1', 'master', 'Secret prompt'), message('m2', 'agent', 'Which coast is the sea?')],
      turn: null,
    };
    const fixture = await open('running');
    const text = el(fixture, '.atlas-log')?.textContent ?? '';
    expect(text).toContain('Which coast is the sea?');
    expect(text).not.toContain('Secret prompt');
  });

  it('shows the final line and a primary close button when the atlas is done', async () => {
    const fixture = await open('done');
    expect(el(fixture, '.final')?.textContent?.trim()).toBe('The atlas is ready.');
    const close = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (button) => button.textContent?.trim() === 'Close',
    );
    expect(close?.classList.contains('primary')).toBe(true);
  });

  it('closes on Escape and does not stop the generation', async () => {
    const fixture = await open('running');
    const closed = vi.fn();
    fixture.componentInstance.visibleChange.subscribe(closed);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(closed).toHaveBeenCalledWith(false);
    expect(el(fixture, '.atlas-panel')).toBeNull();
    expect(fake.sendMessage).not.toHaveBeenCalled();
  });

  it('refreshes the preview when a turn of the conversation ends', async () => {
    fake.response = { conversationId: 'c1', messages: [], turn: turn('running') };
    const fixture = await open('running');
    const before = (el(fixture, '.atlas-preview img') as HTMLImageElement).getAttribute('src');
    fake.response = { conversationId: 'c1', messages: [], turn: null };
    await settle(fixture, ATLAS_DIALOG_POLL_MS);
    const after = (el(fixture, '.atlas-preview img') as HTMLImageElement).getAttribute('src');
    expect(after).not.toBe(before);
  });

  it('reports which states still run', () => {
    expect(isAtlasGenerating(null)).toBe(false);
    expect(isAtlasGenerating(status('running'))).toBe(true);
    expect(isAtlasGenerating(status('waiting-answer'))).toBe(true);
    expect(isAtlasGenerating(status('done'))).toBe(false);
  });
});
