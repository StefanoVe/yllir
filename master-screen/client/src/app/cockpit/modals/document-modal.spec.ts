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

describe('DocumentModal reader', () => {
  let documents: { detail: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<DocumentModal>;
  let el: HTMLElement;

  const docOf = (path: string, extra: Partial<DocResponse> = {}): DocResponse =>
    ({ path, title: path, blocks: [], masterOnly: false, headings: [], backlinks: [], ...extra }) as DocResponse;

  function setup(detail: (path: string) => Promise<DocResponse>) {
    documents = { detail: vi.fn(detail) };
    TestBed.configureTestingModule({
      imports: [DocumentModal],
      providers: [provideZonelessChangeDetection(), { provide: DocumentsService, useValue: documents }],
    });
    fixture = TestBed.createComponent(DocumentModal);
    el = fixture.nativeElement as HTMLElement;
  }

  async function open(source: SourceRef, siblings: SourceRef[] = []): Promise<void> {
    fixture.componentRef.setInput('source', source);
    fixture.componentRef.setInput('siblings', siblings);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
  }

  const heading = (id: string, level: number) => ({ id, level, text: `Heading ${id}` });

  it('shows the first folder as the eyebrow', async () => {
    setup(async (path) => docOf(path));
    await open({ path: 'Items/Magic-Swords/x.md' });
    expect(el.querySelector('.eyebrow')?.textContent?.trim()).toBe('Items');
  });

  it('shows no eyebrow for a file at the root', async () => {
    setup(async (path) => docOf(path));
    await open({ path: 'x.md' });
    expect(el.querySelector('.eyebrow')).toBeNull();
  });

  it('renders the outline rail with three or more level 2 and 3 headings', async () => {
    setup(async (path) =>
      docOf(path, { headings: [heading('a', 1), heading('b', 2), heading('c', 3), heading('d', 2)] }),
    );
    await open({ path: 'Places/p.md' });
    expect(el.querySelectorAll('.doc-outline .outline-link').length).toBe(3);
  });

  it('hides the outline rail with fewer than three such headings', async () => {
    setup(async (path) => docOf(path, { headings: [heading('a', 2), heading('b', 3)] }));
    await open({ path: 'Places/p.md' });
    expect(el.querySelector('.doc-outline')).toBeNull();
  });

  it('scrolls to an outline entry through goTo and highlights it', async () => {
    setup(async (path) =>
      docOf(path, { headings: [heading('a', 2), heading('b', 2), heading('c', 3)] }),
    );
    await open({ path: 'Places/p.md' });
    const goTo = vi.spyOn(fixture.componentInstance, 'goTo');
    el.querySelectorAll<HTMLButtonElement>('.doc-outline .outline-link')[1]!.click();
    fixture.detectChanges();
    expect(goTo).toHaveBeenCalledWith('b');
    expect(fixture.componentInstance.activeHeading()).toBe('b');
    expect(el.querySelector('.outline-link.active')?.textContent?.trim()).toBe('Heading b');
  });

  it('renders backlinks and opens one inside the modal', async () => {
    setup(async (path) =>
      docOf(path, { backlinks: [{ path: 'Places/y.md', title: 'Y' }] }),
    );
    await open({ path: 'Items/x.md' });
    const chip = el.querySelector<HTMLButtonElement>('.backlink-chip');
    expect(chip?.textContent?.trim()).toBe('Y');
    expect(chip?.getAttribute('title')).toBe('Places/y.md');
    chip?.click();
    await flush();
    expect(documents.detail).toHaveBeenLastCalledWith('Places/y.md');
  });

  it('shows the master-only badge for a master-only document', async () => {
    setup(async (path) => docOf(path, { masterOnly: true }));
    await open({ path: 'Secrets/s.md' });
    expect(el.querySelector('.master-pill')?.textContent?.trim()).toBe('Master only');
    expect(el.querySelector('.master-banner')).not.toBeNull();
  });

  it('shows the skeleton and aria-busy until the document resolves', async () => {
    let resolve: (doc: DocResponse) => void = () => {};
    setup(() => new Promise<DocResponse>((r) => (resolve = r)));
    fixture.componentRef.setInput('source', { path: 'a.md' });
    fixture.componentRef.setInput('siblings', []);
    fixture.detectChanges();
    fixture.detectChanges();
    expect(el.querySelector('.doc-skeleton')).not.toBeNull();
    expect(el.querySelector('.modal-body')?.getAttribute('aria-busy')).toBe('true');

    resolve(docOf('a.md'));
    await flush();
    fixture.detectChanges();
    expect(el.querySelector('.doc-skeleton')).toBeNull();
    expect(el.querySelector('.modal-body')?.getAttribute('aria-busy')).toBeNull();
  });
});
