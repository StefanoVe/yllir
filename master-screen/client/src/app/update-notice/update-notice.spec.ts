import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenSession, UpdateStatus } from '@shared/types';
import { UpdateService } from '../core/update';
import { UpdateNotice, newsPreview } from './update-notice';

const SESSIONS: OpenSession[] = [
  { kind: 'live', id: 'l1', title: 'Tavolo del martedì' },
  { kind: 'chat', id: 'c1', title: 'Chat' },
];

function status(partial: Partial<UpdateStatus> = {}): UpdateStatus {
  return { state: 'available', news: 'Better search.\nThe search finds more.\n\n- New cards\n- Fixed the map', snoozed: false, canApply: true, blockedReason: null, sessions: [], ...partial };
}

describe('newsPreview', () => {
  it('keeps the first two lines of text, without list marks, as one plain line', () => {
    expect(newsPreview('Better search.\nThe search finds more.\n\n- New cards')).toBe('Better search. The search finds more.');
    expect(newsPreview('- First\n- Second\n- Third')).toBe('First Second');
  });

  it('is empty when there is no news', () => {
    expect(newsPreview(null)).toBe('');
    expect(newsPreview('  \n ')).toBe('');
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

  function card(root: HTMLElement): HTMLElement | null {
    return root.querySelector<HTMLElement>('.notice');
  }

  function button(root: HTMLElement, label: string): HTMLButtonElement | undefined {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === label);
  }

  function refresh(): void {
    fixture.detectChanges();
  }

  it('shows the card when an update is ready and not postponed', () => {
    const root = render();
    expect(card(root)).not.toBeNull();
    expect(card(root)?.querySelector('h2')?.textContent?.trim()).toBe('Update available');
    expect(card(root)?.textContent).toContain('Better search. The search finds more.');
  });

  it('stays hidden once the master said later, and when nothing is ready', () => {
    fake.status.set(status({ snoozed: true }));
    expect(card(render())).toBeNull();

    fake.status.set(status({ state: 'idle', news: null }));
    refresh();
    expect(card(fixture.nativeElement as HTMLElement)).toBeNull();
  });

  it('Update without open sessions asks the service to apply, with no list', () => {
    const root = render();
    button(root, 'Update')?.click();
    expect(fake.requestApply).toHaveBeenCalledTimes(1);
    expect(card(root)?.querySelector('.notice-sessions')).toBeNull();
  });

  it('with open sessions the card switches to the list, and the API is not called until Close the sessions and update', () => {
    fake.status.set(status({ sessions: SESSIONS }));
    const root = render();
    button(root, 'Update')?.click();
    expect(fake.requestApply).toHaveBeenCalledTimes(1);
    expect(fake.apply).not.toHaveBeenCalled();

    // The service turns the confirmation on; the card follows.
    fake.confirming.set(true);
    refresh();
    expect(card(root)?.getAttribute('role')).toBe('dialog');
    expect(card(root)?.textContent).toContain('The update will close these sessions:');
    expect([...root.querySelectorAll('.notice-sessions li')].map((li) => li.textContent)).toEqual(['Tavolo del martedì', 'Chat']);
    expect(fake.apply).not.toHaveBeenCalled();

    button(root, 'Close the sessions and update')?.click();
    expect(fake.apply).toHaveBeenCalledWith(true);
  });

  it('Cancel in the confirmation goes back without calling the API', () => {
    fake.status.set(status({ sessions: SESSIONS }));
    fake.confirming.set(true);
    const root = render();
    button(root, 'Cancel')?.click();
    expect(fake.cancelApply).toHaveBeenCalledTimes(1);
    expect(fake.apply).not.toHaveBeenCalled();
  });

  it('Escape means later, and from the confirmation it goes back', () => {
    const root = render();
    card(root)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fake.snooze).toHaveBeenCalledTimes(1);

    fake.status.set(status({ sessions: SESSIONS }));
    fake.confirming.set(true);
    refresh();
    card(root)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fake.cancelApply).toHaveBeenCalledTimes(1);
    expect(fake.snooze).toHaveBeenCalledTimes(1);
  });

  it('shows the progress line while updating, and the reopen notice when the service raises it', () => {
    fake.status.set(status({ state: 'updating' }));
    const root = render();
    expect(root.querySelector('[role="status"]')?.textContent).toContain('Updating, it takes a few seconds');
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

  it('keeps the card out of the page when the state is offline', () => {
    fake.status.set(status({ state: 'offline', news: null }));
    expect(card(render())).toBeNull();
  });
});
