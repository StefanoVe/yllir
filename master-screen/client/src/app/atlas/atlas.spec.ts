import { EMPTY } from 'rxjs';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasGenerationState, AtlasStatus, ChatResponse } from '@shared/types';
import { ApiService } from '../core/api.service';
import { LiveService } from '../core/live.service';
import { AtlasApiService } from './atlas-api.service';
import { AtlasPage, isAtlasDocPath } from './atlas';

function status(overrides: Partial<AtlasStatus> = {}, generation: Partial<AtlasStatus['generation']> = {}): AtlasStatus {
  return {
    exists: false,
    built: false,
    pending: 0,
    generation: { state: 'idle' as AtlasGenerationState, conversationId: null, mode: null, ...generation },
    agent: { available: true },
    ...overrides,
  };
}

/** A fake of the atlas endpoints: `current` is what GET returns; `generate` starts a running generation. */
class FakeAtlasApi {
  current: AtlasStatus = status();
  renderResult: { ok: boolean; error?: string } = { ok: true };
  status = vi.fn(async (): Promise<AtlasStatus> => ({ ...this.current }));
  generate = vi.fn(async (mode: 'create' | 'update') => {
    this.current = status({}, { state: 'running', conversationId: 'c1', mode });
    return { ok: true as const, status: { ...this.current } };
  });
  render = vi.fn(async () => this.renderResult);
  previewUrl(version: number): string {
    return `/api/atlas/preview.png?v=${version}`;
  }
}

let atlas: FakeAtlasApi;
let chat: { chat: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> };

async function settle(fixture: ComponentFixture<AtlasPage>, ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  fixture.detectChanges();
}

async function create(initial: AtlasStatus): Promise<ComponentFixture<AtlasPage>> {
  atlas.current = initial;
  const fixture = TestBed.createComponent(AtlasPage);
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

function root(fixture: ComponentFixture<AtlasPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function buttons(fixture: ComponentFixture<AtlasPage>): HTMLButtonElement[] {
  return Array.from(root(fixture).querySelectorAll<HTMLButtonElement>('button'));
}

function buttonLabeled(fixture: ComponentFixture<AtlasPage>, text: string): HTMLButtonElement | undefined {
  return buttons(fixture).find((button) => button.textContent?.trim() === text);
}

describe('AtlasPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    atlas = new FakeAtlasApi();
    chat = {
      chat: vi.fn(async (conversationId?: string): Promise<ChatResponse> => ({ conversationId: conversationId ?? 'c1', messages: [], turn: null })),
      sendMessage: vi.fn(async () => ({ messageId: 'm1', turnId: 't1' })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AtlasApiService, useValue: atlas },
        { provide: ApiService, useValue: chat },
        { provide: LiveService, useValue: { on: () => EMPTY, resync$: EMPTY } },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('shows exactly one button, with the create text, when there is no atlas', async () => {
    const fixture = await create(status());
    expect(buttons(fixture)).toHaveLength(1);
    expect(buttons(fixture)[0].textContent?.trim()).toBe('Generate the campaign atlas');
    expect(buttons(fixture)[0].disabled).toBe(false);
  });

  it('disables the create button with the reason when the assistant is not available', async () => {
    const fixture = await create(status({ agent: { available: false, reason: 'No assistant set up.' } }));
    const button = buttons(fixture)[0];
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('No assistant set up.');
    expect(button.getAttribute('aria-describedby')).toBe('atlas-unavailable');
  });

  it('a click asks the server to create the atlas and opens the popup', async () => {
    const fixture = await create(status());
    buttonLabeled(fixture, 'Generate the campaign atlas')?.click();
    await settle(fixture);
    expect(atlas.generate).toHaveBeenCalledWith('create');
    expect(root(fixture).querySelector('.atlas-panel')).not.toBeNull();
  });

  it('shows the preparing line and an Open button while a generation runs with the popup closed', async () => {
    const fixture = await create(status({}, { state: 'running', conversationId: 'c1', mode: 'create' }));
    expect(root(fixture).textContent).toContain('The atlas is being prepared');
    expect(buttonLabeled(fixture, 'Open')).toBeDefined();
    buttonLabeled(fixture, 'Open')?.click();
    await settle(fixture);
    expect(root(fixture).querySelector('.atlas-panel')).not.toBeNull();
  });

  it('shows the atlas viewer in an iframe once the site is built', async () => {
    const fixture = await create(status({ exists: true, built: true }));
    const frame = root(fixture).querySelector('iframe') as HTMLIFrameElement;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('src')).toContain('/atlas/index.html');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  });

  it('offers a draw button when the atlas exists but is not built', async () => {
    const fixture = await create(status({ exists: true, built: false }));
    expect(root(fixture).querySelector('iframe')).toBeNull();
    buttonLabeled(fixture, 'Draw the atlas')?.click();
    await settle(fixture);
    expect(atlas.render).toHaveBeenCalledTimes(1);
  });

  it('shows the pending badge only when places are waiting', async () => {
    const none = await create(status({ exists: true, built: true, pending: 0 }));
    expect(root(none).querySelector('.badge')).toBeNull();
    expect(buttonLabeled(none, 'Place them')).toBeUndefined();
  });

  it('shows the pending count and a place button when places are waiting', async () => {
    const fixture = await create(status({ exists: true, built: true, pending: 3 }));
    expect(root(fixture).querySelector('.badge')?.textContent?.trim()).toBe('3 places to place');
    buttonLabeled(fixture, 'Place them')?.click();
    await settle(fixture);
    expect(atlas.generate).toHaveBeenCalledWith('update');
  });

  it('ignores a message that does not come from the viewer', async () => {
    const fixture = await create(status({ exists: true, built: true }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'yllir-atlas-open', path: 'characters/alia.md' }, source: window }),
    );
    expect(navigate).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('opens the document of a valid message from the viewer', async () => {
    const fixture = await create(status({ exists: true, built: true }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const frame = root(fixture).querySelector('iframe') as HTMLIFrameElement;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'yllir-atlas-open', path: 'characters/alia.md' },
        source: frame.contentWindow,
      }),
    );
    expect(navigate).toHaveBeenCalledWith('/doc/characters/alia.md');
    fixture.destroy();
  });

  it('keeps the viewer during an update over a built atlas, with the updating state and an Open button', async () => {
    const fixture = await create(status({ exists: true, built: true, pending: 2 }, { state: 'running', conversationId: 'c1', mode: 'update' }));
    expect(root(fixture).querySelector('iframe')).not.toBeNull();
    expect(root(fixture).textContent).not.toContain('The atlas is being prepared');
    expect(root(fixture).querySelector('.toolbar .badge')?.textContent?.trim()).toBe('Updating');
    expect(buttonLabeled(fixture, 'Place them')).toBeUndefined();
    expect(buttonLabeled(fixture, 'Open')).toBeDefined();
    buttonLabeled(fixture, 'Open')?.click();
    await settle(fixture);
    expect(root(fixture).querySelector('.atlas-panel')).not.toBeNull();
  });

  it('shows the preparing line for an update over an atlas that is not built yet', async () => {
    const fixture = await create(status({ exists: true, built: false }, { state: 'running', conversationId: 'c1', mode: 'update' }));
    expect(root(fixture).querySelector('iframe')).toBeNull();
    expect(root(fixture).textContent).toContain('The atlas is being prepared');
  });

  it('accepts only Markdown paths with no way up or absolute start', () => {
    expect(isAtlasDocPath('characters/alia.md')).toBe(true);
    expect(isAtlasDocPath('../secret.md')).toBe(false);
    expect(isAtlasDocPath('/etc/x.md')).toBe(false);
    expect(isAtlasDocPath('notes/a.txt')).toBe(false);
    expect(isAtlasDocPath(42)).toBe(false);
  });
});
