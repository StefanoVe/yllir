import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocResponse } from '@shared/types';
import type { SourceRef } from '@shared/cockpit-types';
import { DocumentsService } from '../support/documents.service';
import { DocumentModal } from './document-modal';

const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const sheets: SourceRef[] = [{ path: 'a.md' }, { path: 'b.md' }, { path: 'c.md' }];

describe('DocumentModal navigator', () => {
  let documents: { detail: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<DocumentModal>;
  let el: HTMLElement;

  beforeEach(() => {
    documents = {
      detail: vi.fn(async (path: string) => ({ path, title: path, blocks: [], masterOnly: false }) as unknown as DocResponse),
    };
    TestBed.configureTestingModule({
      imports: [DocumentModal],
      providers: [provideZonelessChangeDetection(), { provide: DocumentsService, useValue: documents }],
    });
    fixture = TestBed.createComponent(DocumentModal);
    el = fixture.nativeElement as HTMLElement;
  });

  async function show(source: SourceRef, siblings: SourceRef[]): Promise<void> {
    fixture.componentRef.setInput('source', source);
    fixture.componentRef.setInput('siblings', siblings);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
  }

  const buttons = () => ({
    prev: el.querySelector<HTMLButtonElement>('button[aria-label="Previous sheet"]'),
    next: el.querySelector<HTMLButtonElement>('button[aria-label="Next sheet"]'),
  });

  it('shows no navigator without siblings', async () => {
    await show({ path: 'b.md' }, []);
    expect(el.querySelector('.sheet-position')).toBeNull();
    expect(buttons().next).toBeNull();
  });

  it('shows the position and disables the ends of the list', async () => {
    await show({ path: 'a.md' }, sheets);
    expect(el.querySelector('.sheet-position')?.textContent?.trim()).toBe('1 / 3');
    expect(buttons().prev?.disabled).toBe(true);
    expect(buttons().next?.disabled).toBe(false);
  });

  it('replaces the shown sheet when next is clicked, without pushing history', async () => {
    await show({ path: 'a.md' }, sheets);
    buttons().next?.click();
    await flush();
    fixture.detectChanges();
    expect(documents.detail).toHaveBeenLastCalledWith('b.md');
    expect(el.querySelector('.sheet-position')?.textContent?.trim()).toBe('2 / 3');
    expect(el.querySelector('button[aria-label="Back to the previous document"]')).toBeNull();
  });

  it('walks the list with the arrow keys and leaves inputs alone', async () => {
    await show({ path: 'b.md' }, sheets);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await flush();
    expect(documents.detail).toHaveBeenLastCalledWith('c.md');

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await flush();
    expect(documents.detail).toHaveBeenLastCalledWith('c.md');
    input.remove();
  });
});
