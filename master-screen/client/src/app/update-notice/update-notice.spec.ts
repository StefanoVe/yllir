import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenSession, UpdateStatus } from '@shared/types';
import { UpdateService } from '../core/update';
import { UpdateNotice, newsGroups } from './update-notice';

const SESSIONS: OpenSession[] = [
  { kind: 'live', id: 'l1', title: 'Tavolo del martedì' },
  { kind: 'chat', id: 'c1', title: 'Chat' },
];

function status(partial: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    state: 'available',
    version: '0.68.0',
    news: 'Better search.\nThe search finds more.\n\n- New cards\n- Fixed the map',
    snoozed: false,
    canApply: true,
    blockedReason: null,
    sessions: [],
    ...partial,
  };
}

describe('newsGroups', () => {
  it('turns each non-empty line into a paragraph and "- " or "* " lines into list items', () => {
    expect(newsGroups('Better search.\nThe search finds more.\n\n- New cards\n* Fixed the map\n- ')).toEqual([
      { list: false, items: ['Better search.', 'The search finds more.'] },
      { list: true, items: ['New cards', 'Fixed the map'] },
    ]);
  });

  it('keeps html-looking text as plain text', () => {
    expect(newsGroups('<b>bold</b>')).toEqual([{ list: false, items: ['<b>bold</b>'] }]);
  });

  it('is empty when there is no news', () => {
    expect(newsGroups(null)).toEqual([]);
    expect(newsGroups('  \n - \n ')).toEqual([]);
  });
});

describe('UpdateNotice', () => {
  let fixture: ComponentFixture<UpdateNotice>;
  let fake: {
    status: ReturnType<typeof signal<UpdateStatus | null>>;
    confirming: ReturnType<typeof signal<boolean>>;
    reopenNotice: ReturnType<typeof signal<boolean>>;
    actionError: ReturnType<typeof signal<string | null>>;
    requestApply: ReturnType<typeof vi.fn>;
    apply: ReturnType<typeof vi.fn>;
    cancelApply: ReturnType<typeof vi.fn>;
    snooze: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    fake = {
      status: signal<UpdateStatus | null>(status()),
      confirming: signal(false),
      reopenNotice: signal(false),
      actionError: signal<string | null>(null),
      requestApply: vi.fn(),
      apply: vi.fn(),
      cancelApply: vi.fn(),
      snooze: vi.fn(),
      retry: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [UpdateNotice],
      providers: [provideZonelessChangeDetection(), { provide: UpdateService, useValue: fake }],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function render(): HTMLElement {
    fixture = TestBed.createComponent(UpdateNotice);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function refresh(): void {
    fixture.detectChanges();
  }

  function pill(root: HTMLElement): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>('.tip-pill');
  }

  function panel(root: HTMLElement): HTMLElement | null {
    return root.querySelector<HTMLElement>('.tip-panel');
  }

  function card(root: HTMLElement): HTMLElement | null {
    return root.querySelector<HTMLElement>('.notice:not(.tip)');
  }

  function button(root: HTMLElement, label: string): HTMLButtonElement | undefined {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === label);
  }

  it('shows the pill with the version and the panel closed', () => {
    const root = render();
    expect(pill(root)?.textContent?.trim()).toBe('New version 0.68.0 available');
    expect(pill(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(pill(root)?.getAttribute('aria-controls')).toBe('update-notice-panel');
    expect(panel(root)?.id).toBe('update-notice-panel');
    expect(root.querySelector('.tip')?.classList.contains('open')).toBe(false);
  });

  it('falls back to the old title when the version is not known', () => {
    fake.status.set(status({ version: null }));
    expect(pill(render())?.textContent?.trim()).toBe('Update available');
  });

  it('puts the changelog and both buttons in the panel, and opens it on click', () => {
    const root = render();
    const body = panel(root);
    expect(body?.querySelector('.news')?.textContent).toContain('Better search.');
    expect([...body!.querySelectorAll('.news-line')].map((p) => p.textContent?.trim())).toEqual([
      'Better search.',
      'The search finds more.',
    ]);
    expect([...body!.querySelectorAll('.news-list li')].map((li) => li.textContent?.trim())).toEqual(['New cards', 'Fixed the map']);
    expect(button(root, 'Update')).toBeDefined();
    expect(button(root, 'Later')).toBeDefined();

    pill(root)?.click();
    refresh();
    expect(root.querySelector('.tip')?.classList.contains('open')).toBe(true);
    expect(pill(root)?.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows a short sentence when there is no news', () => {
    fake.status.set(status({ news: null }));
    const root = render();
    expect(panel(root)?.textContent).toContain('No details for this version.');
    expect(panel(root)?.querySelector('.news-line')).toBeNull();
  });

  it('shows the action error in the panel as an alert', () => {
    fake.actionError.set('The server refused the update.');
    const root = render();
    expect(panel(root)?.querySelector('[role="alert"]')?.textContent).toContain('The server refused the update.');
  });

  it('Escape closes the open panel and does not postpone the update', () => {
    const root = render();
    pill(root)?.click();
    refresh();
    pill(root)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    refresh();
    expect(root.querySelector('.tip')?.classList.contains('open')).toBe(false);
    expect(root.querySelector('.tip')?.classList.contains('dismissed')).toBe(true);
    expect(pill(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(fake.snooze).not.toHaveBeenCalled();
  });

  it('Update calls requestApply, and the list is shown when open sessions would close', () => {
    const root = render();
    button(root, 'Update')?.click();
    expect(fake.requestApply).toHaveBeenCalledTimes(1);
    expect(fake.apply).not.toHaveBeenCalled();

    fake.status.set(status({ sessions: SESSIONS }));
    fake.confirming.set(true);
    refresh();
    expect(card(root)?.getAttribute('role')).toBe('dialog');
    expect(pill(root)).toBeNull();
    expect(card(root)?.textContent).toContain('The update will close these sessions:');
    expect([...root.querySelectorAll('.notice-sessions li')].map((li) => li.textContent)).toEqual(['Tavolo del martedì', 'Chat']);
    expect(fake.apply).not.toHaveBeenCalled();

    button(root, 'Close the sessions and update')?.click();
    expect(fake.apply).toHaveBeenCalledWith(true);
  });

  it('Later calls snooze', () => {
    const root = render();
    button(root, 'Later')?.click();
    expect(fake.snooze).toHaveBeenCalledTimes(1);
    expect(fake.requestApply).not.toHaveBeenCalled();
  });

  it('Cancel in the confirmation goes back without calling the API', () => {
    fake.status.set(status({ sessions: SESSIONS }));
    fake.confirming.set(true);
    const root = render();
    button(root, 'Cancel')?.click();
    expect(fake.cancelApply).toHaveBeenCalledTimes(1);
    expect(fake.apply).not.toHaveBeenCalled();
  });

  it('Escape in the confirmation goes back, and does not postpone', () => {
    fake.status.set(status({ sessions: SESSIONS }));
    fake.confirming.set(true);
    const root = render();
    card(root)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fake.cancelApply).toHaveBeenCalledTimes(1);
    expect(fake.snooze).not.toHaveBeenCalled();
  });

  it('stays hidden once the master said later, and when nothing is ready', () => {
    fake.status.set(status({ snoozed: true }));
    expect(render().querySelector('.notice')).toBeNull();

    fake.status.set(status({ state: 'idle', news: null, version: null }));
    refresh();
    expect(fixture.nativeElement.querySelector('.notice')).toBeNull();
  });

  it('keeps the card out of the page when the state is offline', () => {
    fake.status.set(status({ state: 'offline', news: null }));
    expect(render().querySelector('.notice')).toBeNull();
  });

  it('shows the progress line while updating, and the reopen notice when the service raises it', () => {
    fake.status.set(status({ state: 'updating' }));
    const root = render();
    expect(root.querySelector('[role="status"]')?.textContent).toContain('Updating, it takes a few seconds');
    expect(pill(root)).toBeNull();
    expect(button(root, 'Update')).toBeUndefined();

    fake.status.set(status({ state: 'restarting' }));
    fake.reopenNotice.set(true);
    refresh();
    expect(root.textContent).toContain('Almost done, reopening');
    expect(root.textContent).toContain('close this window and open Yllir again');
  });

  it('on failure shows the sentence as an alert, and Try again retries', () => {
    fake.status.set(status({ state: 'failed' }));
    const root = render();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('The update did not work. Nothing has changed.');
    button(root, 'Try again')?.click();
    expect(fake.retry).toHaveBeenCalledTimes(1);
    expect(fake.apply).not.toHaveBeenCalled();
  });
});
