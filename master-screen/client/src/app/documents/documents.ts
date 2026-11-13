import { Component, ElementRef, HostListener, ViewChild, computed, inject, signal } from '@angular/core';
import { FileSearch, Files, LucideAngularModule, Lock, Search, X } from 'lucide-angular';
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
    if (needle !== '' && !foldText(doc.title).includes(needle) && !foldText(doc.path).includes(needle)) continue;
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
    groups.push({ category: '', title: noCategory, docs: sortByTitle(buckets.get('') ?? [], locale) });
  }
  return groups;
}

function sortByTitle(docs: DocSummary[], locale: string): DocSummary[] {
  return [...docs].sort((a, b) => a.title.localeCompare(b.title, locale) || a.path.localeCompare(b.path));
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

/**
 * The documents explorer (`/docs`): every campaign document, grouped by category, with a text filter
 * and category chips. A click (or Enter or Space on a row) opens the document in the popup, which
 * walks the documents in the order the master sees them.
 */
@Component({
  selector: 'ms-documents-page',
  imports: [DocumentModal, LucideAngularModule],
  templateUrl: './documents.html',
  styleUrl: './documents.css',
})
export class DocumentsPage {
  private readonly api = inject(ApiService);
  readonly s = inject(I18n);

  readonly icons = { FileSearch, Files, Lock, Search, X };
  /** Placeholder rows shown while the index loads. */
  readonly skeletonRows = [0, 1, 2, 3, 4, 5, 6, 7];

  readonly docs = signal<DocSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filter = signal('');
  /** The selected category, or null for all. An empty string selects the documents without one. */
  readonly category = signal<string | null>(null);
  /** The document shown in the popup, or null when none is open. */
  readonly opened = signal<SourceRef | null>(null);

  @ViewChild('filterField') private filterInput?: ElementRef<HTMLInputElement>;

  readonly chips = computed(() => categoryChips(this.docs()));
  readonly groups = computed(() => {
    const selected = this.category();
    const scope = selected === null ? this.docs() : this.docs().filter((doc) => doc.category === selected);
    return groupDocuments(scope, this.filter(), this.s.language(), this.s.t('documents.noCategory'));
  });
  /** The visible documents, flattened in the order they are shown: the popup's previous and next follow it. */
  readonly orderedSources = computed<SourceRef[]>(() =>
    this.groups().flatMap((group) => group.docs.map((doc) => ({ path: doc.path }))),
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
  }

  /** Clears the text filter and gives the focus back to the field. */
  clearFilter(): void {
    this.filter.set('');
    this.filterInput?.nativeElement.focus();
  }

  onFilterEscape(event: Event): void {
    if (this.filter() === '') return;
    event.preventDefault();
    this.clearFilter();
  }

  selectCategory(category: string | null): void {
    this.category.set(category);
  }

  /** Resets both the text filter and the category. */
  clearFilters(): void {
    this.filter.set('');
    this.category.set(null);
  }

  /** The readable heading of a category, for the chips and the group titles. */
  humanize(category: string): string {
    return humanizeCategory(category);
  }

  /** The first letter of a title, upper-cased, for the row avatar. */
  initialOf(title: string): string {
    return Array.from(title.trim())[0]?.toUpperCase() ?? '';
  }

  open(doc: DocSummary): void {
    this.opened.set({ path: doc.path });
  }

  /** The `/` key focuses the filter, unless the master is already typing or the popup is open. */
  @HostListener('document:keydown', ['$event'])
  onSlashKey(event: KeyboardEvent): void {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.opened() !== null || isTextEntry(event.target)) return;
    event.preventDefault();
    this.filterInput?.nativeElement.focus();
  }
}
