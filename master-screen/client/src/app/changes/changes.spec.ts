import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeGroup, ChangesResponse } from '@shared/types';
import { ApiService } from '../core/api.service';
import { LiveService } from '../core/live.service';
import { Changes } from './changes';

class FakeLive {
  readonly resync$ = new Subject<void>().asObservable();
  readonly connected = signal(true);
  on() {
    return new Subject<unknown>().asObservable();
  }
}

const AT = new Date().toISOString();

function group(id: string, extra: Partial<ChangeGroup> = {}): ChangeGroup {
  return {
    id,
    at: AT,
    summary: `Summary ${id}`,
    files: [{ path: 'characters/alia.md', status: 'modified' }],
    undone: false,
    isUndo: false,
    ...extra,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Changes', () => {
  let fixture: ComponentFixture<Changes>;
  let api: { changes: ReturnType<typeof vi.fn>; changeDiff: ReturnType<typeof vi.fn>; undo: ReturnType<typeof vi.fn> };

  function render(groups: ChangeGroup[], compact = false): void {
    api.changes.mockResolvedValue({ groups } satisfies ChangesResponse);
    fixture = TestBed.createComponent(Changes);
    fixture.componentRef.setInput('compact', compact);
    fixture.detectChanges();
  }

  async function settle(): Promise<void> {
    await flush();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function undoButtons(): HTMLButtonElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button[aria-label="Undo this change"]'),
    );
  }

  beforeEach(() => {
    api = {
      changes: vi.fn(),
      changeDiff: vi.fn(),
      undo: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [Changes],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: LiveService, useValue: new FakeLive() },
      ],
    });
  });

  it('offers undo only on the newest group that is neither undone nor an undo', async () => {
    render([
      group('a', { isUndo: true }),
      group('b', { undone: true }),
      group('c'),
      group('d'),
    ]);
    await settle();

    const buttons = undoButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest('[data-group-id]')?.getAttribute('data-group-id')).toBe('c');
    const undoMark = (fixture.nativeElement as HTMLElement).querySelector('[data-group-id="a"] .undo-mark');
    expect(undoMark).not.toBeNull();
    expect(undoButtons().some((b) => b.closest('[data-group-id="b"]'))).toBe(false);
  });

  it('asks for confirmation and then undoes exactly that group', async () => {
    render([group('c')]);
    api.undo.mockResolvedValue({ ok: true, message: 'Undone: Summary c', groupId: 'c' });
    await settle();

    undoButtons()[0].click();
    await settle();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Undo this change?');
    expect(api.undo).not.toHaveBeenCalled();

    const yes = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.confirm button'))[0];
    yes.click();
    await settle();
    expect(api.undo).toHaveBeenCalledWith('c');
    expect((fixture.nativeElement as HTMLElement).querySelector('.notice-text')?.textContent).toContain('Undone: Summary c');
  });

  it('shows only the summary line when compact', async () => {
    render([group('c')], true);
    await settle();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.summary')?.textContent).toContain('Summary c');
    expect(root.querySelector('.file-toggle')).toBeNull();
    expect(undoButtons()).toHaveLength(0);
  });

  it('fetches a group diff once and reuses it for other files of that group', async () => {
    render([group('c', { files: [{ path: 'a.md', status: 'modified' }, { path: 'b.md', status: 'added' }] })]);
    api.changeDiff.mockResolvedValue({ id: 'c', files: [] });
    await settle();
    const root = fixture.nativeElement as HTMLElement;
    const toggles = root.querySelectorAll<HTMLButtonElement>('.file-toggle');
    toggles[0].click();
    await settle();
    toggles[1].click();
    await settle();
    expect(api.changeDiff).toHaveBeenCalledTimes(1);
    expect(api.changeDiff).toHaveBeenCalledWith('c');
  });
});
