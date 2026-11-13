import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocResponse, DocSummary } from '@shared/types';
import { DocumentModal } from '../cockpit/modals/document-modal';
import { DocumentsService } from '../cockpit/support/documents.service';
import { ApiService } from '../core/api.service';
import { DocumentsPage, categoryChips, groupDocuments, humanizeCategory } from './documents';

const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const docs: DocSummary[] = [
  { path: 'characters/rhea.md', title: 'Rhea', category: 'characters', masterOnly: false, hasMasterBlock: false },
  { path: 'characters/aldo.md', title: 'Aldo', category: 'characters', masterOnly: true, hasMasterBlock: true },
  { path: 'places/perche-tower.md', title: 'Perché tower', category: 'places', masterOnly: false, hasMasterBlock: false },
  { path: 'seed.md', title: 'Seed', category: '', masterOnly: true, hasMasterBlock: false },
  { path: 'characters/zed.md', title: 'Zed', category: 'characters', masterOnly: false, hasMasterBlock: false },
];

describe('humanizeCategory', () => {
  it('turns dashes and underscores into spaces and capitalises the first letter', () => {
    expect(humanizeCategory('npc_allies-group')).toBe('Npc allies group');
    expect(humanizeCategory('places')).toBe('Places');
    expect(humanizeCategory('')).toBe('');
  });
});

describe('categoryChips', () => {
  it('counts each category in the order of first appearance and puts documents without one last', () => {
    expect(categoryChips(docs)).toEqual([
      { category: 'characters', count: 3 },
      { category: 'places', count: 1 },
      { category: '', count: 1 },
    ]);
  });
});

describe('groupDocuments', () => {
  it('groups by category in the order of first appearance, sorts titles, and puts no-category last', () => {
    const groups = groupDocuments(docs, '', 'en', 'Other documents');
    expect(groups.map((group) => group.title)).toEqual(['Characters', 'Places', 'Other documents']);
    expect(groups.map((group) => group.category)).toEqual(['characters', 'places', '']);
    expect(groups[0]!.docs.map((doc) => doc.title)).toEqual(['Aldo', 'Rhea', 'Zed']);
  });

  it('keeps the group order of the whole list when the first document of a category is filtered out', () => {
    const groups = groupDocuments(docs, 'zed', 'en', 'Other documents');
    expect(groups.map((group) => group.title)).toEqual(['Characters']);
  });

  it('matches the path as well as the title, ignoring case and accents', () => {
    expect(groupDocuments(docs, 'PERCHE', 'en', 'x').flatMap((group) => group.docs.map((doc) => doc.path))).toEqual([
      'places/perche-tower.md',
    ]);
    expect(groupDocuments(docs, 'places/', 'en', 'x')[0]!.docs).toHaveLength(1);
  });
});

describe('DocumentsPage', () => {
  let api: { docs: ReturnType<typeof vi.fn> };
  let documents: { detail: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<DocumentsPage>;
  let el: HTMLElement;

  beforeEach(() => {
    api = { docs: vi.fn(async () => ({ docs })) };
    documents = {
      detail: vi.fn(async (path: string) => ({ path, title: path, blocks: [], masterOnly: false }) as unknown as DocResponse),
    };
    TestBed.configureTestingModule({
      imports: [DocumentsPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: DocumentsService, useValue: documents },
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
  });

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(DocumentsPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
  }

  function rowTitles(): string[] {
    return [...el.querySelectorAll('button.doc .doc-title')].map((node) => node.textContent?.trim() ?? '');
  }

  function headings(): string[] {
    return [...el.querySelectorAll('h2.group-title .group-name')].map((node) => node.textContent?.trim() ?? '');
  }

  function chip(category: string): HTMLButtonElement {
    return el.querySelector<HTMLButtonElement>(`button.chip[data-category="${category}"]`)!;
  }

  function type(value: string): void {
    const input = el.querySelector<HTMLInputElement>('input.field')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('loads the index once and shows the documents grouped by category', async () => {
    await create();
    expect(api.docs).toHaveBeenCalledTimes(1);
    expect(headings()).toEqual(['Characters', 'Places', 'Other documents']);
    expect(rowTitles()).toEqual(['Aldo', 'Rhea', 'Zed', 'Perché tower', 'Seed']);
  });

  it('shows the count of visible and total documents in the toolbar', async () => {
    await create();
    expect(el.querySelector('.count')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('5 / 5');
    type('perche');
    expect(el.querySelector('.count')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 / 5');
  });

  it('marks master-only documents with a lock and puts the path only in the tooltip', async () => {
    await create();
    const rows = [...el.querySelectorAll<HTMLButtonElement>('button.doc')];
    expect(rows.every((row) => row.type === 'button')).toBe(true);
    const aldo = rows.find((row) => row.textContent?.includes('Aldo'))!;
    expect(aldo.querySelector('.lock .sr-only')?.textContent?.trim()).toBe('Master only');
    expect(aldo.getAttribute('title')).toBe('Aldo — characters/aldo.md');
    expect(aldo.textContent).not.toContain('characters/aldo.md');
    expect(rows.find((row) => row.textContent?.includes('Rhea'))?.querySelector('.lock')).toBeNull();
  });

  it('filters the rows, ignoring accents', async () => {
    await create();
    type('perche');
    expect(rowTitles()).toEqual(['Perché tower']);
    type('nothing like this');
    expect(el.querySelector('p.state')?.textContent).toContain('No document matches');
    expect(el.querySelectorAll('h2.group-title')).toHaveLength(0);
  });

  it('shows a clear button only while the filter is not empty, and it empties the filter', async () => {
    await create();
    expect(el.querySelector('button.clear')).toBeNull();
    type('rhea');
    const clear = el.querySelector<HTMLButtonElement>('button.clear')!;
    expect(clear.getAttribute('aria-label')).toBe('Clear filter');
    clear.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.filter()).toBe('');
    expect(rowTitles()).toHaveLength(5);
    expect(el.querySelector('button.clear')).toBeNull();
  });

  it('clears the filter with Escape while the filter has focus', async () => {
    await create();
    type('rhea');
    const input = el.querySelector<HTMLInputElement>('input.field')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.filter()).toBe('');
  });

  it('focuses the filter with "/" when nothing is being typed, and leaves a typed "/" alone', async () => {
    await create();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    expect(document.activeElement).toBe(el.querySelector('input.field'));

    const input = el.querySelector<HTMLInputElement>('input.field')!;
    const typed = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    input.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
  });

  it('narrows the list to one category with its chip and combines that with the text filter', async () => {
    await create();
    const chips = [...el.querySelectorAll<HTMLButtonElement>('button.chip')];
    expect(chips.map((item) => [...item.querySelectorAll('span')].map((span) => span.textContent).join(' '))).toEqual([
      'All 5',
      'Characters 3',
      'Places 1',
      'Other documents 1',
    ]);
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true');

    chip('characters').click();
    fixture.detectChanges();
    expect(chip('characters').getAttribute('aria-pressed')).toBe('true');
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('false');
    expect(rowTitles()).toEqual(['Aldo', 'Rhea', 'Zed']);

    type('zed');
    expect(rowTitles()).toEqual(['Zed']);
    type('perche');
    expect(rowTitles()).toEqual([]);
    expect(el.querySelector('p.state')?.textContent).toContain('No document matches');
  });

  it('keeps the popup order equal to the visible order when a chip is selected', async () => {
    await create();
    chip('characters').click();
    fixture.detectChanges();
    const shown = [...el.querySelectorAll<HTMLButtonElement>('button.doc')].map(
      (row) => row.getAttribute('title')!.split(' — ')[1],
    );
    expect(fixture.componentInstance.orderedSources().map((source) => source.path)).toEqual(shown);
  });

  it('clears the text and the category together from the no-results state', async () => {
    await create();
    chip('places').click();
    type('zzz');
    expect(el.querySelector('p.state')?.textContent).toContain('No document matches');
    const reset = [...el.querySelectorAll<HTMLButtonElement>('.state-block button')].find((button) =>
      button.textContent?.includes('Clear filters'),
    )!;
    reset.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.filter()).toBe('');
    expect(fixture.componentInstance.category()).toBeNull();
    expect(rowTitles()).toHaveLength(5);
  });

  it('opens the clicked document in the popup, with the visible documents as its siblings', async () => {
    await create();
    type('characters/');
    const rhea = [...el.querySelectorAll<HTMLButtonElement>('button.doc')].find((row) => row.textContent?.includes('Rhea'))!;
    rhea.click();
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    expect(fixture.componentInstance.opened()).toEqual({ path: 'characters/rhea.md' });
    expect(documents.detail).toHaveBeenCalledWith('characters/rhea.md');
    const modal = fixture.debugElement.query(By.directive(DocumentModal));
    expect(modal).not.toBeNull();
    const siblings = (modal.componentInstance as DocumentModal).siblings().map((item) => item.path);
    expect(siblings).toEqual(['characters/aldo.md', 'characters/rhea.md', 'characters/zed.md']);
  });

  it('shows placeholder rows with a status message while the index loads', async () => {
    api.docs.mockReturnValueOnce(new Promise(() => undefined));
    fixture = TestBed.createComponent(DocumentsPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    const status = el.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Loading');
    expect(el.querySelectorAll('li.skeleton-row')).toHaveLength(8);
  });

  it('shows the empty state when the campaign has no documents', async () => {
    api.docs.mockResolvedValueOnce({ docs: [] });
    await create();
    expect(el.querySelector('p.state')?.textContent).toContain('There are no documents yet.');
    expect(el.querySelectorAll('button.doc')).toHaveLength(0);
    expect(el.querySelector('.chips')).toBeNull();
  });

  it('shows a plain-language error with a retry button that reloads the list', async () => {
    api.docs.mockRejectedValueOnce(new Error('offline'));
    await create();
    const alert = el.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('could not be loaded');
    expect(el.querySelectorAll('button.doc')).toHaveLength(0);

    const retry = alert.querySelector<HTMLButtonElement>('button')!;
    expect(retry.textContent?.trim()).toBe('Try again');
    retry.click();
    await flush();
    fixture.detectChanges();
    expect(api.docs).toHaveBeenCalledTimes(2);
    expect(rowTitles()).toHaveLength(5);
  });
});
