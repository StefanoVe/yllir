import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocResponse, DocSummary } from '@shared/types';

import { DocumentModal } from '../cockpit/modals/document-modal';
import { DocumentsService } from '../cockpit/support/documents.service';
import { ApiService } from '../core/api.service';
import { Router } from '@angular/router';
import {
  DocumentsPage,
  RECENT_ID,
  categoryChips,
  groupDocuments,
  humanizeCategory,
  pickNeighbour,
  previewTitles,
  pushRecent,
  splitMatch,
} from './documents';

const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const docs: DocSummary[] = [
  {
    path: 'characters/rhea.md',
    title: 'Rhea',
    category: 'characters',
    masterOnly: false,
    hasMasterBlock: false,
  },
  {
    path: 'characters/aldo.md',
    title: 'Aldo',
    category: 'characters',
    masterOnly: true,
    hasMasterBlock: true,
  },
  {
    path: 'places/perche-tower.md',
    title: 'Perché tower',
    category: 'places',
    masterOnly: false,
    hasMasterBlock: false,
  },
  { path: 'seed.md', title: 'Seed', category: '', masterOnly: true, hasMasterBlock: false },
  {
    path: 'characters/zed.md',
    title: 'Zed',
    category: 'characters',
    masterOnly: false,
    hasMasterBlock: false,
  },
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
    expect(
      groupDocuments(docs, 'PERCHE', 'en', 'x').flatMap((group) =>
        group.docs.map((doc) => doc.path),
      ),
    ).toEqual(['places/perche-tower.md']);
    expect(groupDocuments(docs, 'places/', 'en', 'x')[0]!.docs).toHaveLength(1);
  });
});

describe('splitMatch', () => {
  const hits = (parts: { text: string; hit: boolean }[]) =>
    parts.filter((part) => part.hit).map((part) => part.text);

  it('marks the matching part of the text, ignoring case', () => {
    expect(splitMatch('Rhea of the Vale', 'RHE')).toEqual([
      { text: 'Rhe', hit: true },
      { text: 'a of the Vale', hit: false },
    ]);
  });

  it('ignores accents on both sides and keeps the original characters', () => {
    expect(splitMatch('Perché tower', 'perche')).toEqual([
      { text: 'Perché', hit: true },
      { text: ' tower', hit: false },
    ]);
    expect(splitMatch('Perche tower', 'Perché')).toEqual([
      { text: 'Perche', hit: true },
      { text: ' tower', hit: false },
    ]);
  });

  it('maps the match back over decomposed characters, whose folded text is shorter', () => {
    const decomposed = 'Cafe\u0301 bar';
    const parts = splitMatch(decomposed, 'cafe');
    expect(parts.map((part) => part.text).join('')).toBe(decomposed);
    expect(hits(parts)).toEqual(['Cafe\u0301']);
  });

  it('returns the whole text as a non-hit when nothing matches or the filter is empty', () => {
    expect(splitMatch('Rhea', 'zed')).toEqual([{ text: 'Rhea', hit: false }]);
    expect(splitMatch('Rhea', '')).toEqual([{ text: 'Rhea', hit: false }]);
    expect(splitMatch('Rhea', '   ')).toEqual([{ text: 'Rhea', hit: false }]);
    expect(splitMatch('', 'rhe')).toEqual([{ text: '', hit: false }]);
  });

  it('keeps the text intact when the match is at the start or the end', () => {
    expect(splitMatch('Rhea', 'rhea')).toEqual([{ text: 'Rhea', hit: true }]);
    expect(splitMatch('Old Rhea', 'rhea')).toEqual([
      { text: 'Old ', hit: false },
      { text: 'Rhea', hit: true },
    ]);
  });
});

describe('pickNeighbour', () => {
  // Three columns in the first row, two in the second: indices 0-2 on top, 3-4 below.
  const grid = [
    { left: 0, top: 0 },
    { left: 100, top: 0 },
    { left: 200, top: 0 },
    { left: 0, top: 100 },
    { left: 100, top: 100 },
  ];

  it('moves left and right through the list and stops at the ends', () => {
    expect(pickNeighbour(grid, 1, 'ArrowRight')).toBe(2);
    expect(pickNeighbour(grid, 1, 'ArrowLeft')).toBe(0);
    expect(pickNeighbour(grid, 4, 'ArrowRight')).toBe(4);
    expect(pickNeighbour(grid, 0, 'ArrowLeft')).toBe(0);
  });

  it('moves down to the nearest card of the next row by horizontal distance', () => {
    expect(pickNeighbour(grid, 1, 'ArrowDown')).toBe(4);
    expect(pickNeighbour(grid, 2, 'ArrowDown')).toBe(4);
    expect(pickNeighbour(grid, 0, 'ArrowDown')).toBe(3);
  });

  it('moves up to the nearest card of the row above', () => {
    expect(pickNeighbour(grid, 4, 'ArrowUp')).toBe(1);
    expect(pickNeighbour(grid, 3, 'ArrowUp')).toBe(0);
  });

  it('stays put when there is no row in that direction', () => {
    expect(pickNeighbour(grid, 4, 'ArrowDown')).toBe(4);
    expect(pickNeighbour(grid, 0, 'ArrowUp')).toBe(0);
  });

  it('goes to the first and last card with Home and End', () => {
    expect(pickNeighbour(grid, 3, 'Home')).toBe(0);
    expect(pickNeighbour(grid, 1, 'End')).toBe(4);
  });

  it('is a plain next and previous in a single column (list view)', () => {
    const list = [0, 1, 2].map((index) => ({ left: 0, top: index * 44 }));
    expect(pickNeighbour(list, 0, 'ArrowDown')).toBe(1);
    expect(pickNeighbour(list, 2, 'ArrowUp')).toBe(1);
  });

  it('returns the current index when there are no cards', () => {
    expect(pickNeighbour([], 0, 'ArrowDown')).toBe(0);
    expect(pickNeighbour(grid, -1, 'ArrowRight')).toBe(-1);
  });
});

describe('previewTitles', () => {
  const titles = (count: number): DocSummary[] =>
    Array.from({ length: count }, (_, index) => ({
      path: `places/p${index}.md`,
      title: `Place ${index}`,
      category: 'places',
      masterOnly: false,
      hasMasterBlock: false,
    }));

  it('gives no titles and no more for an empty group', () => {
    expect(previewTitles([])).toEqual({ titles: [], more: 0 });
  });

  it('gives all titles and no more for three documents or fewer', () => {
    expect(previewTitles(titles(3))).toEqual({
      titles: ['Place 0', 'Place 1', 'Place 2'],
      more: 0,
    });
    expect(previewTitles(titles(1))).toEqual({ titles: ['Place 0'], more: 0 });
  });

  it('gives the first three titles and counts the rest for more documents', () => {
    expect(previewTitles(titles(5))).toEqual({
      titles: ['Place 0', 'Place 1', 'Place 2'],
      more: 2,
    });
  });

  it('takes the number of titles to show from max', () => {
    expect(previewTitles(titles(5), 1)).toEqual({ titles: ['Place 0'], more: 4 });
  });
});

describe('pushRecent', () => {
  it('puts the path at the front without duplicates', () => {
    expect(pushRecent(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(pushRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('keeps at most six paths by default and the number given otherwise', () => {
    const full = ['1', '2', '3', '4', '5', '6'];
    expect(pushRecent(full, 'x')).toEqual(['x', '1', '2', '3', '4', '5']);
    expect(pushRecent(['a', 'b', 'c'], 'd', 2)).toEqual(['d', 'a']);
  });
});

describe('DocumentsPage', () => {
  let api: { docs: ReturnType<typeof vi.fn> };
  let documents: { detail: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<DocumentsPage>;
  let el: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    api = { docs: vi.fn(async () => ({ docs })) };
    documents = {
      detail: vi.fn(
        async (path: string) =>
          ({ path, title: path, blocks: [], masterOnly: false }) as unknown as DocResponse,
      ),
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
    vi.restoreAllMocks();
    localStorage.clear();
  });

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(DocumentsPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
  }

  function rowTitles(): string[] {
    return [...el.querySelectorAll('button.doc .doc-title')].map(
      (node) => node.textContent?.trim() ?? '',
    );
  }

  /** Opens every group and the recent section with the toolbar button, as the master would. */
  function expandAllGroups(): void {
    const expand = [...el.querySelectorAll<HTMLButtonElement>('.tool-group button')].find(
      (item) => item.textContent?.trim() === 'Expand all',
    )!;
    expand.click();
    fixture.detectChanges();
  }

  function headings(): string[] {
    return [...el.querySelectorAll('h2.group-title .group-name')].map(
      (node) => node.textContent?.trim() ?? '',
    );
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
    expandAllGroups();
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
    expandAllGroups();
    const rows = [...el.querySelectorAll<HTMLButtonElement>('button.doc')];
    expect(rows.every((row) => row.type === 'button')).toBe(true);
    const aldo = rows.find((row) => row.textContent?.includes('Aldo'))!;
    expect(aldo.querySelector('.lock .sr-only')?.textContent?.trim()).toBe('Master only');
    expect(aldo.getAttribute('title')).toBe('Aldo — characters/aldo.md');
    expect(aldo.textContent).not.toContain('characters/aldo.md');
    expect(
      rows.find((row) => row.textContent?.includes('Rhea'))?.querySelector('.lock'),
    ).toBeNull();
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
    expandAllGroups();
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
    expect(
      chips.map((item) =>
        [...item.querySelectorAll('span')].map((span) => span.textContent).join(' '),
      ),
    ).toEqual(['All 5', 'Characters 3', 'Places 1', 'Other documents 1']);
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
    expandAllGroups();
    chip('places').click();
    type('zzz');
    expect(el.querySelector('p.state')?.textContent).toContain('No document matches');
    const reset = [...el.querySelectorAll<HTMLButtonElement>('.state-block button')].find(
      (button) => button.textContent?.includes('Clear filters'),
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
    const rhea = [...el.querySelectorAll<HTMLButtonElement>('button.doc')].find((row) =>
      row.textContent?.includes('Rhea'),
    )!;
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
    expandAllGroups();
    expect(rowTitles()).toHaveLength(5);
  });

  function cardTitle(button: Element): string {
    return button.querySelector('.doc-title')?.textContent?.trim() ?? '';
  }

  function groupToggle(title: string): HTMLButtonElement {
    return [...el.querySelectorAll<HTMLButtonElement>('button.group-toggle')].find((button) =>
      button.textContent?.includes(title),
    )!;
  }

  function viewButton(label: string): HTMLButtonElement {
    return el.querySelector<HTMLButtonElement>(`.view-toggle button[aria-label="${label}"]`)!;
  }

  it('highlights the matching part of the titles while a filter is typed', async () => {
    await create();
    type('rhe');
    const marks = [...el.querySelectorAll<HTMLElement>('button.doc mark.hit')];
    expect(marks.map((mark) => mark.textContent)).toEqual(['Rhe']);
    expect(marks[0]!.closest('button.doc')?.textContent).toContain('Rhea');
  });

  it('starts with every group closed and no document list, the recent section included', async () => {
    localStorage.setItem('yllir.docs.recent', JSON.stringify(['seed.md']));
    await create();
    expect(localStorage.getItem('yllir.docs.expanded')).toBeNull();
    expect(el.querySelectorAll('button.group-toggle[aria-expanded="true"]')).toHaveLength(0);
    expect(el.querySelectorAll('button.group-toggle[aria-expanded="false"]')).toHaveLength(4);
    expect(el.querySelectorAll('ul.docs')).toHaveLength(0);
    expect(el.querySelectorAll('button.doc')).toHaveLength(0);
  });

  it('shows the first titles and a count of the rest in a closed heading only', async () => {
    const crowd: DocSummary[] = [
      ...docs,
      {
        path: 'characters/bo.md',
        title: 'Bo',
        category: 'characters',
        masterOnly: false,
        hasMasterBlock: false,
      },
    ];
    api.docs.mockResolvedValueOnce({ docs: crowd });
    await create();
    const preview = (title: string) =>
      groupToggle(title)
        .querySelector('.group-preview')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim() ?? null;
    expect(preview('Characters')).toBe('Aldo, Bo, Rhea +1');
    expect(preview('Places')).toBe('Perché tower');
    expect(preview('Other documents')).toBe('Seed');
    expect(
      groupToggle('Characters').querySelector('.group-preview')?.getAttribute('aria-hidden'),
    ).toBe('true');

    groupToggle('Characters').click();
    fixture.detectChanges();
    expect(preview('Characters')).toBeNull();
    expect(groupToggle('Characters').textContent).not.toContain('Aldo, Bo');
    expect(el.querySelectorAll('.group-preview')).toHaveLength(2);
  });

  it('opens a group from its heading, remembers it, and closes it again', async () => {
    await create();
    const toggle = groupToggle('Characters');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(groupToggle('Characters').getAttribute('aria-expanded')).toBe('true');
    expect(rowTitles()).toEqual(['Aldo', 'Rhea', 'Zed']);
    expect(JSON.parse(localStorage.getItem('yllir.docs.expanded')!)).toEqual(['characters']);

    await create();
    expect(groupToggle('Characters').getAttribute('aria-expanded')).toBe('true');
    expect(rowTitles()).toEqual(['Aldo', 'Rhea', 'Zed']);

    groupToggle('Characters').click();
    fixture.detectChanges();
    expect(rowTitles()).toEqual([]);
    expect(localStorage.getItem('yllir.docs.expanded')).toBe('[]');
  });

  it('always shows the groups open while a text filter is active, and ignores their toggles', async () => {
    await create();
    type('rhea');
    expect(groupToggle('Characters').getAttribute('aria-expanded')).toBe('true');
    expect(rowTitles()).toEqual(['Rhea']);

    groupToggle('Characters').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toEqual([]);
    expect(localStorage.getItem('yllir.docs.expanded')).toBeNull();

    type('');
    expect(groupToggle('Characters').getAttribute('aria-expanded')).toBe('false');
  });

  it('collapses and expands all groups with the toolbar buttons', async () => {
    await create();
    const button = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('.tool-group button')].find(
        (item) => item.textContent?.trim() === label,
      )!;
    button('Expand all').click();
    fixture.detectChanges();
    expect([...fixture.componentInstance.expanded()].sort()).toEqual(
      ['', RECENT_ID, 'characters', 'places'].sort(),
    );
    expect(rowTitles()).toHaveLength(5);
    expect(el.querySelectorAll('button.group-toggle[aria-expanded="false"]')).toHaveLength(0);

    button('Collapse all').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toEqual([]);
    expect(rowTitles()).toEqual([]);
    expect(el.querySelectorAll('button.group-toggle[aria-expanded="true"]')).toHaveLength(0);
  });

  it('opens every group when the text filter matches documents in all of them', async () => {
    await create();
    type('e');
    const toggles = [...el.querySelectorAll<HTMLButtonElement>('button.group-toggle')];
    expect(toggles).toHaveLength(3);
    expect(toggles.map((toggle) => toggle.getAttribute('aria-expanded'))).toEqual([
      'true',
      'true',
      'true',
    ]);
    expect(rowTitles()).toEqual(['Aldo', 'Rhea', 'Zed', 'Perché tower', 'Seed']);
  });

  it('shows a group open when a category chip is selected, without storing that choice', async () => {
    await create();
    chip('places').click();
    fixture.detectChanges();
    expect(groupToggle('Places').getAttribute('aria-expanded')).toBe('true');
    expect(rowTitles()).toEqual(['Perché tower']);
    expect(localStorage.getItem('yllir.docs.expanded')).toBeNull();

    groupToggle('Places').click();
    fixture.detectChanges();
    expect(groupToggle('Places').getAttribute('aria-expanded')).toBe('true');
    expect(localStorage.getItem('yllir.docs.expanded')).toBeNull();
  });

  it('shows the only group left by a filter open, without storing that choice', async () => {
    await create();
    type('perche');
    expect(groupToggle('Places').getAttribute('aria-expanded')).toBe('true');
    expect(rowTitles()).toEqual(['Perché tower']);
    expect(localStorage.getItem('yllir.docs.expanded')).toBeNull();
  });

  it('shows the only group of the whole list open on its own', async () => {
    api.docs.mockResolvedValueOnce({ docs: docs.filter((doc) => doc.category === 'characters') });
    await create();
    expect(headings()).toEqual(['Characters']);
    expect(groupToggle('Characters').getAttribute('aria-expanded')).toBe('true');
    expect(rowTitles()).toEqual(['Aldo', 'Rhea', 'Zed']);
    expect(localStorage.getItem('yllir.docs.expanded')).toBeNull();
  });

  it('shows the recent section closed by default and opens it from its heading', async () => {
    localStorage.setItem('yllir.docs.recent', JSON.stringify(['seed.md']));
    await create();
    const recentToggle = el.querySelector<HTMLButtonElement>('section.recent button.group-toggle')!;
    expect(recentToggle.getAttribute('aria-expanded')).toBe('false');
    expect(recentToggle.getAttribute('aria-label')).toBe('Show or hide Recently opened');
    expect(el.querySelector('section.recent ul')).toBeNull();

    recentToggle.click();
    fixture.detectChanges();
    expect(
      el.querySelector('section.recent button.group-toggle')?.getAttribute('aria-expanded'),
    ).toBe('true');
    expect([...el.querySelectorAll('section.recent button.doc')].map(cardTitle)).toEqual(['Seed']);
    expect(JSON.parse(localStorage.getItem('yllir.docs.expanded')!)).toEqual([RECENT_ID]);
  });

  it('works when the browser storage is blocked or holds damaged values', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await create();
    expect(rowTitles()).toHaveLength(0);
    groupToggle('Characters').click();
    fixture.detectChanges();
    expect(rowTitles()).toEqual(['Aldo', 'Rhea', 'Zed']);
    groupToggle('Characters').click();
    fixture.detectChanges();
    expect(rowTitles()).toEqual([]);
  });

  it('ignores damaged stored values instead of failing', async () => {
    localStorage.setItem('yllir.docs.expanded', '{not json');
    localStorage.setItem('yllir.docs.view', 'sideways');
    localStorage.setItem('yllir.docs.recent', '"oops"');
    await create();
    expect(rowTitles()).toHaveLength(0);
    expect(groupToggle('Characters').getAttribute('aria-expanded')).toBe('false');
    expect(viewButton('Grid view').getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('section.recent')).toBeNull();

    localStorage.setItem('yllir.docs.expanded', JSON.stringify(['characters', 42, null]));
    await create();
    expect(rowTitles()).toEqual(['Aldo', 'Rhea', 'Zed']);
  });

  it('does not open a group from an old collapsed setting', async () => {
    localStorage.setItem('yllir.docs.collapsed', JSON.stringify([]));
    await create();
    expect(rowTitles()).toHaveLength(0);
    expect(groupToggle('Characters').getAttribute('aria-expanded')).toBe('false');
  });

  it('switches between grid and list, and remembers the choice', async () => {
    await create();
    expandAllGroups();
    expect(viewButton('Grid view').getAttribute('aria-pressed')).toBe('true');
    expect(viewButton('List view').getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector('ul.docs.is-list')).toBeNull();

    viewButton('List view').click();
    fixture.detectChanges();
    expect(viewButton('List view').getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('ul.docs.is-list')).not.toBeNull();
    expect(localStorage.getItem('yllir.docs.view')).toBe('list');
    expect(rowTitles()).toHaveLength(5);

    await create();
    expandAllGroups();
    expect(viewButton('List view').getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('ul.docs.is-list')).not.toBeNull();
  });

  it('shows the recently opened documents first, and only while nothing narrows the list', async () => {
    await create();
    expandAllGroups();
    const rhea = [...el.querySelectorAll<HTMLButtonElement>('button.doc')].find((row) =>
      row.textContent?.includes('Rhea'),
    )!;
    rhea.click();
    fixture.detectChanges();
    await flush();
    fixture.componentInstance.opened.set(null);
    fixture.detectChanges();

    expect(JSON.parse(localStorage.getItem('yllir.docs.recent')!)).toEqual(['characters/rhea.md']);
    const recent = el.querySelector<HTMLElement>('section.recent')!;
    expect(recent.querySelector('h2')?.textContent).toContain('Recently opened');
    expect([...recent.querySelectorAll('button.doc')].map(cardTitle)).toEqual(['Rhea']);

    type('zed');
    expect(el.querySelector('section.recent')).toBeNull();
    type('');
    expect(el.querySelector('section.recent')).not.toBeNull();
    chip('places').click();
    fixture.detectChanges();
    expect(el.querySelector('section.recent')).toBeNull();
  });

  it('lists only the recent documents that still exist in the index', async () => {
    localStorage.setItem('yllir.docs.recent', JSON.stringify(['gone/old.md', 'seed.md']));
    localStorage.setItem('yllir.docs.expanded', JSON.stringify([RECENT_ID]));
    await create();
    const recent = el.querySelector<HTMLElement>('section.recent')!;
    expect([...recent.querySelectorAll('button.doc')].map(cardTitle)).toEqual(['Seed']);
  });

  it('keeps the filter and the category in the URL, replaced in place, and restores them on load', async () => {
    await create();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');
    type('perche');
    chip('places').click();
    fixture.detectChanges();
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: { q: 'perche', cat: 'places' },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );

    fixture.destroy();
    await router.navigateByUrl('/?q=rhea&cat=characters');
    await create();
    expect(fixture.componentInstance.filter()).toBe('rhea');
    expect(fixture.componentInstance.category()).toBe('characters');
    expect(rowTitles()).toEqual(['Rhea']);
  });

  it('does not throw when the URL cannot be updated (no routes in the test router)', async () => {
    await create();
    expandAllGroups();
    expect(() => {
      type('rhea');
      fixture.componentInstance.clearFilters();
      fixture.detectChanges();
    }).not.toThrow();
    await flush();
    expect(rowTitles()).toHaveLength(5);
  });

  it('shows the "/" key hint only while the filter is empty and not focused', async () => {
    await create();
    const input = el.querySelector<HTMLInputElement>('input.field')!;
    expect(el.querySelector('kbd.kbd')?.textContent).toBe('/');

    input.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(el.querySelector('kbd.kbd')).toBeNull();

    input.dispatchEvent(new Event('blur'));
    type('x');
    expect(el.querySelector('kbd.kbd')).toBeNull();
  });

  it('moves the focus between cards with the arrow keys, Home and End', async () => {
    await create();
    expandAllGroups();
    const cards = [...el.querySelectorAll<HTMLButtonElement>('button.doc')];
    cards[0]!.focus();

    const right = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    cards[0]!.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cards[1]);

    cards[1]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(cards[cards.length - 1]);

    cards[cards.length - 1]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
    );
    expect(document.activeElement).toBe(cards[0]);
  });

  it('leaves keys alone that are not navigation keys', async () => {
    await create();
    expandAllGroups();
    const card = el.querySelector<HTMLButtonElement>('button.doc')!;
    card.focus();
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    card.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('moves from the search field into the list with ArrowDown and leaves the caret alone otherwise', async () => {
    await create();
    expandAllGroups();
    const input = el.querySelector<HTMLInputElement>('input.field')!;
    input.focus();
    const left = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(left);
    expect(left.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);

    const down = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el.querySelector('button.doc'));
  });
});
