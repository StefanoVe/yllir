import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ChevronDown,
  ChevronRight,
  EyeOff,
  FileSearch,
  Files,
  LayoutGrid,
  List,
  Lock,
  LucideAngularModule,
  Search,
  X,
} from 'lucide-angular';
import type { DocSummary } from '@shared/types';
import type { SourceRef } from '@shared/cockpit-types';
import { DocumentModal } from '../cockpit/modals/document-modal';
import { ApiService } from '../core/api.service';
import { I18n } from '../i18n';

export interface DocGroup {
  /** The category as the server sent it; empty for documents without one. */
  category: string;
  /** Heading shown for the group. */
  title: string;
  docs: DocSummary[];
}

/** One category chip: the category as the server sent it, and how many documents it holds. */
export interface CategoryChip {
  /** The category as the server sent it; empty for documents without one. */
  category: string;
  count: number;
}

/** A piece of a title: the part that matches the filter is marked with `hit`. */
export interface TextPart {
  text: string;
  hit: boolean;
}

/** A point on the screen, used to find the neighbour of a card. */
export interface Point {
  left: number;
  top: number;
}

/** The keys that move the focus between documents. */
export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export type DocsView = 'grid' | 'list';

/** How many documents the "Recently opened" section keeps. */
export const RECENT_MAX = 6;

/** The id of the "Recently opened" section in the list of open sections. */
export const RECENT_ID = '__recent__';

/** The first titles of a group and how many documents come after them, for a collapsed heading. */
export function previewTitles(
  docs: readonly DocSummary[],
  max = 3,
): { titles: string[]; more: number } {
  return {
    titles: docs.slice(0, max).map((doc) => doc.title),
    more: Math.max(0, docs.length - max),
  };
}

/** Lower-case form without accents, so that "perche" finds "Perché". */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * A readable heading for a category: dashes and underscores become spaces and the first letter is
 * capitalised. It is for display only; the server's category stays as it is.
 */
export function humanizeCategory(category: string): string {
  const spaced = category.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The categories of the whole list, with their document counts, in the order they first appear.
 * Documents without a category form a last chip.
 */
export function categoryChips(docs: readonly DocSummary[]): CategoryChip[] {
  const counts = new Map<string, number>();
  for (const doc of docs) counts.set(doc.category, (counts.get(doc.category) ?? 0) + 1);
  const chips = [...counts].map(([category, count]) => ({ category, count }));
  return chips.sort((a, b) => Number(a.category === '') - Number(b.category === ''));
}

/**
 * The documents that match the filter, grouped by category. Groups keep the order in which their
 * category first appears in `docs` (the whole list, not only the matches). Inside a group the
 * documents are sorted by title in the campaign language. Documents without a category form a last
 * group titled `noCategory`. Groups with no match are left out. The filter matches the title or the
 * path, ignoring case and accents.
 */
export function groupDocuments(
  docs: readonly DocSummary[],
  filter: string,
  locale: string,
  noCategory: string,
): DocGroup[] {
  const needle = foldText(filter.trim());
  const order: string[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    if (doc.category !== '' && !seen.has(doc.category)) {
      seen.add(doc.category);
      order.push(doc.category);
    }
  }

  const buckets = new Map<string, DocSummary[]>();
  for (const doc of docs) {
    if (
      needle !== '' &&
      !foldText(doc.title).includes(needle) &&
      !foldText(doc.path).includes(needle)
    )
      continue;
    const bucket = buckets.get(doc.category) ?? [];
    bucket.push(doc);
    buckets.set(doc.category, bucket);
  }

  const groups: DocGroup[] = order
    .filter((category) => buckets.has(category))
    .map((category) => ({
      category,
      title: humanizeCategory(category),
      docs: sortByTitle(buckets.get(category) ?? [], locale),
    }));
  if (buckets.has('')) {
    groups.push({
      category: '',
      title: noCategory,
      docs: sortByTitle(buckets.get('') ?? [], locale),
    });
  }
  return groups;
}

function sortByTitle(docs: DocSummary[], locale: string): DocSummary[] {
  return [...docs].sort(
    (a, b) => a.title.localeCompare(b.title, locale) || a.path.localeCompare(b.path),
  );
}

/**
 * Splits a text where the filter matches, ignoring case and accents. The text is folded one
 * character at a time, so that a match is mapped back onto the original characters even when
 * folding changes the length of the string. No match, or an empty filter, gives the whole text
 * as one part that is not a hit.
 */
export function splitMatch(text: string, filter: string): TextPart[] {
  const needle = foldText(filter.trim());
  if (needle === '' || text === '') return [{ text, hit: false }];

  const chars = Array.from(text);
  const starts: number[] = [];
  let folded = '';
  for (const char of chars) {
    starts.push(folded.length);
    folded += foldText(char);
  }

  const at = folded.indexOf(needle);
  if (at < 0) return [{ text, hit: false }];
  const end = at + needle.length;

  const parts: TextPart[] = [];
  let previousHit = false;
  chars.forEach((char, index) => {
    const start = starts[index]!;
    // A character that folds to nothing (a loose accent) follows the character before it.
    const hit = foldText(char) === '' ? previousHit : start >= at && start < end;
    previousHit = hit;
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += char;
    else parts.push({ text: char, hit });
  });
  return parts;
}

/**
 * The card that the arrow keys go to. Left and right step through the list; up and down go to the
 * nearest card of the row above or below, by horizontal distance. Home and End go to the first and
 * last card. Returns `current` when there is no card in that direction.
 */
export function pickNeighbour(rects: Point[], current: number, key: NavKey): number {
  const last = rects.length - 1;
  if (current < 0 || current > last) return current;

  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'ArrowRight':
      return Math.min(current + 1, last);
    case 'ArrowLeft':
      return Math.max(current - 1, 0);
    case 'ArrowDown':
    case 'ArrowUp': {
      const from = rects[current]!;
      const below = key === 'ArrowDown';
      const candidates = rects
        .map((rect, index) => ({ rect, index }))
        .filter(({ rect }) => (below ? rect.top > from.top + 1 : rect.top < from.top - 1));
      if (candidates.length === 0) return current;

      const rowTop = below
        ? Math.min(...candidates.map(({ rect }) => rect.top))
        : Math.max(...candidates.map(({ rect }) => rect.top));
      let best = -1;
      let bestDistance = Infinity;
      for (const { rect, index } of candidates) {
        if (Math.abs(rect.top - rowTop) > 1) continue;
        const distance = Math.abs(rect.left - from.left);
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      }
      return best < 0 ? current : best;
    }
  }
}

/** The recent list with `path` at the front: no duplicates, at most `max` entries. */
export function pushRecent(list: string[], path: string, max = RECENT_MAX): string[] {
  return [path, ...list.filter((item) => item !== path)].slice(0, max);
}

/** Storage keys of the explorer. Every read and write goes through the helpers below. */
export const DOCS_STORAGE = {
  expanded: 'yllir.docs.expanded',
  view: 'yllir.docs.view',
  recent: 'yllir.docs.recent',
} as const;

/** Reads one stored value. Blocked or missing storage gives null, and the page still works. */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Writes one value. Blocked storage is ignored: the choice then lasts only for this page. */
function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage is not available (private window, blocked site data): nothing to keep.
  }
}

/** Reads a JSON array of strings; anything else gives an empty list. */
function readStoredList(key: string): string[] {
  const raw = readStored(key);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Text entry: keys typed here belong to the element, never to the page shortcuts. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(target.type);
  }
  return false;
}

const NAV_KEYS: readonly string[] = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
];

/**
 * The documents explorer (`/docs`): every campaign document, grouped by category, with a text filter
 * and category chips. A click (or Enter or Space on a card) opens the document in the popup, which
 * walks the documents in the order the master sees them. The filter and the category are kept in
 * the URL (`q` and `cat`), so going back from a document restores the search.
 */
@Component({
  selector: 'ms-documents-page',
  imports: [DocumentModal, LucideAngularModule, NgTemplateOutlet],
  templateUrl: './documents.html',
  styleUrl: './documents.css',
})
export class DocumentsPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly s = inject(I18n);

  readonly icons = {
    ChevronDown,
    ChevronRight,
    EyeOff,
    FileSearch,
    Files,
    LayoutGrid,
    List,
    Lock,
    Search,
    X,
  };
  /** Placeholder cards shown while the index loads. */
  readonly skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];

  readonly docs = signal<DocSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** The text filter. Restored once from the `q` query parameter. */
  readonly filter = signal(this.route.snapshot.queryParamMap.get('q') ?? '');
  /** The selected category, or null for all. An empty string selects the documents without one. */
  readonly category = signal<string | null>(
    this.route.snapshot.queryParamMap.has('cat')
      ? this.route.snapshot.queryParamMap.get('cat')
      : null,
  );
  /** The document shown in the popup, or null when none is open. */
  readonly opened = signal<SourceRef | null>(null);
  /** Whether the filter field has the focus; the `/` hint hides while it does. */
  readonly filterFocused = signal(false);
  /** The category names whose groups are open, plus RECENT_ID for the recent section. Empty means all closed. Stored per browser. */
  readonly expanded = signal<string[]>(readStoredList(DOCS_STORAGE.expanded));
  /** Grid of cards or a list of rows. Stored per browser; grid by default. */
  readonly view = signal<DocsView>(readStored(DOCS_STORAGE.view) === 'list' ? 'list' : 'grid');
  /** The paths of the documents opened most recently, newest first. Stored per browser. */
  readonly recent = signal<string[]>(readStoredList(DOCS_STORAGE.recent).slice(0, RECENT_MAX));

  @ViewChild('filterField') private filterInput?: ElementRef<HTMLInputElement>;

  readonly chips = computed(() => categoryChips(this.docs()));
  readonly groups = computed(() => {
    const selected = this.category();
    const scope =
      selected === null ? this.docs() : this.docs().filter((doc) => doc.category === selected);
    return groupDocuments(
      scope,
      this.filter(),
      this.s.language(),
      this.s.t('documents.noCategory'),
    );
  });
  /** The visible documents, flattened in the order they are shown: the popup's previous and next follow it. */
  readonly orderedSources = computed<SourceRef[]>(() =>
    this.groups().flatMap((group) => group.docs.map((doc) => ({ path: doc.path }))),
  );
  /** The recent documents that still exist in the index. */
  readonly recentDocs = computed<DocSummary[]>(() => {
    const byPath = new Map(this.docs().map((doc) => [doc.path, doc] as const));
    return this.recent()
      .map((path) => byPath.get(path))
      .filter((doc): doc is DocSummary => doc !== undefined);
  });
  /** The recent section shows only when nothing narrows the list. */
  readonly showRecent = computed(
    () => this.filter().trim() === '' && this.category() === null && this.recentDocs().length > 0,
  );

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.docs.set((await this.api.docs()).docs);
    } catch {
      this.error.set(this.s.t('documents.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  onFilter(value: string): void {
    this.filter.set(value);
    this.syncUrl();
  }

  /** Clears the text filter and gives the focus back to the field. */
  clearFilter(): void {
    this.filter.set('');
    this.syncUrl();
    this.filterInput?.nativeElement.focus();
  }

  onFilterEscape(event: Event): void {
    if (this.filter() === '') return;
    event.preventDefault();
    this.clearFilter();
  }

  selectCategory(category: string | null): void {
    this.category.set(category);
    this.syncUrl();
  }

  /** Resets both the text filter and the category. */
  clearFilters(): void {
    this.filter.set('');
    this.category.set(null);
    this.syncUrl();
  }

  /** The readable heading of a category, for the chips and the group titles. */
  humanize(category: string): string {
    return humanizeCategory(category);
  }

  /** The first letter of a title, upper-cased, for the card mark. */
  initialOf(title: string): string {
    return Array.from(title.trim())[0]?.toUpperCase() ?? '';
  }

  /** The title split into the parts the filter matches, for the highlight. */
  highlight(title: string): TextPart[] {
    return splitMatch(title, this.filter());
  }

  /**
   * The folder part of a path below the category, shown under the card when there is one. A file
   * directly in the category gives an empty string.
   */
  subfolderPath(doc: DocSummary): string {
    const prefix = doc.category === '' ? '' : `${doc.category}/`;
    const rest =
      prefix !== '' && doc.path.startsWith(prefix) ? doc.path.slice(prefix.length) : doc.path;
    return rest.includes('/') ? rest : '';
  }

  /**
   * Whether a group is shown closed. Every group starts closed. A text filter, a selected category or
   * a single group left on the screen shows it open without storing anything.
   */
  isCollapsed(group: DocGroup): boolean {
    if (this.isAutoOpen()) return false;
    return !this.expanded().includes(group.category);
  }

  /** The title and the first documents of a group, shown in its collapsed heading. */
  previewOf(group: DocGroup): { titles: string[]; more: number } {
    return previewTitles(group.docs);
  }

  /** Whether the recent section is open. */
  isRecentOpen(): boolean {
    return this.expanded().includes(RECENT_ID);
  }

  /** Opens or closes one group. Ignored while the screen shows it open on its own. */
  toggleGroup(group: DocGroup): void {
    if (this.isAutoOpen()) return;
    this.toggleId(group.category);
  }

  toggleRecent(): void {
    this.toggleId(RECENT_ID);
  }

  collapseAll(): void {
    this.setExpanded([]);
  }

  expandAll(): void {
    this.setExpanded([RECENT_ID, ...this.chips().map((chip) => chip.category)]);
  }

  setView(view: DocsView): void {
    this.view.set(view);
    writeStored(DOCS_STORAGE.view, view);
  }

  open(doc: DocSummary): void {
    this.recent.set(pushRecent(this.recent(), doc.path));
    writeStored(DOCS_STORAGE.recent, JSON.stringify(this.recent()));
    this.opened.set({ path: doc.path });
  }

  /** Arrow keys, Home and End move between the cards; ArrowDown from the field enters the list. */
  @HostListener('keydown', ['$event'])
  onNavigationKey(event: KeyboardEvent): void {
    if (!NAV_KEYS.includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const field = this.filterInput?.nativeElement;
    const buttons = this.cardButtons();

    if (field !== undefined && event.target === field) {
      if (event.key !== 'ArrowDown' || buttons.length === 0) return;
      event.preventDefault();
      buttons[0]!.focus();
      return;
    }

    const current = buttons.findIndex((button) => button === event.target);
    if (current < 0) return;
    event.preventDefault();
    const rects = buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { left: box.left, top: box.top };
    });
    const next = pickNeighbour(rects, current, event.key as NavKey);
    buttons[next]?.focus();
  }

  /** The `/` key focuses the filter, unless the master is already typing or the popup is open. */
  @HostListener('document:keydown', ['$event'])
  onSlashKey(event: KeyboardEvent): void {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.opened() !== null || isTextEntry(event.target)) return;
    event.preventDefault();
    this.filterInput?.nativeElement.focus();
  }

  /** A text filter, a selected category, or a single group left: the groups show open without a choice. */
  private isAutoOpen(): boolean {
    return this.filter().trim() !== '' || this.category() !== null || this.groups().length === 1;
  }

  private toggleId(id: string): void {
    const current = this.expanded();
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    this.setExpanded(next);
  }

  private setExpanded(list: string[]): void {
    this.expanded.set(list);
    writeStored(DOCS_STORAGE.expanded, JSON.stringify(list));
  }

  /** The document cards on the screen, in the order they are shown. */
  private cardButtons(): HTMLButtonElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('button.doc'));
  }

  /**
   * The URL carries the filter and the category, replaced in place so that each keystroke does not
   * add a history entry. Going back from a document returns to the same search.
   */
  private syncUrl(): void {
    const q = this.filter().trim();
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { q: q === '' ? null : q, cat: this.category() },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .catch(() => false);
  }
}
