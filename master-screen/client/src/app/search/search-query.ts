import { signal } from '@angular/core';
import type { DocSummary, SearchHit } from '@shared/types';
import { ApiService, isApiFailure } from '../core/api.service';
import type { DocNavService } from '../core/doc-nav.service';
import type { ViewModeService } from '../core/view-mode.service';

export const SEARCH_DEBOUNCE_MS = 150;

/** One row of a result list: a search hit, or a favourite or recent document when the query is empty. */
export interface SearchEntry {
  path: string;
  title: string;
  masterOnly: boolean;
  snippet: string;
  group: 'hit' | 'favourite' | 'recent';
}

export function hitEntries(hits: readonly SearchHit[]): SearchEntry[] {
  return hits.map((hit) => ({
    path: hit.path,
    title: hit.title,
    masterOnly: hit.masterOnly,
    snippet: hit.snippet,
    group: 'hit',
  }));
}

/** Favourites first, then recents that are not already favourites. Titles come from the document list. */
export function browseEntries(
  favourites: readonly string[],
  recents: readonly string[],
  titles: ReadonlyMap<string, DocSummary>,
): SearchEntry[] {
  const entry = (path: string, group: SearchEntry['group']): SearchEntry => {
    const doc = titles.get(path);
    return { path, title: doc?.title || path, masterOnly: doc?.masterOnly ?? false, snippet: '', group };
  };
  return [
    ...favourites.map((path) => entry(path, 'favourite')),
    ...recents.filter((path) => !favourites.includes(path)).map((path) => entry(path, 'recent')),
  ];
}

export type SearchStatus = 'idle' | 'loading' | 'done' | 'error';

/**
 * Debounced, race-safe search for one screen (page or palette). Only the newest request may
 * change the results; older responses are dropped. Call dispose() when the screen closes.
 */
export class SearchQuery {
  readonly text = signal('');
  readonly hits = signal<SearchHit[]>([]);
  readonly status = signal<SearchStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly titles = signal<ReadonlyMap<string, DocSummary>>(new Map());

  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private searched = '';

  constructor(
    private readonly api: ApiService,
    private readonly view: ViewModeService,
  ) {
    void this.api
      .docs()
      .then((res) => this.titles.set(new Map(res.docs.map((doc) => [doc.path, doc]))))
      .catch(() => undefined);
  }

  /** The user typed: wait for a pause before asking the server. */
  type(raw: string): void {
    this.text.set(raw);
    this.clearTimer();
    const query = raw.trim();
    if (query === '') {
      this.cancelPending();
      this.hits.set([]);
      this.error.set(null);
      this.status.set('idle');
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  /** The view (players preview) changed: search again with the same words. */
  refresh(): void {
    if (this.searched !== '') void this.run(this.searched);
  }

  async run(query: string): Promise<void> {
    const id = ++this.seq;
    this.searched = query;
    this.status.set('loading');
    this.error.set(null);
    try {
      const res = await this.api.search(query, this.view.viewMode());
      if (id !== this.seq) return;
      this.hits.set(res.hits);
      this.status.set('done');
    } catch (failure) {
      if (id !== this.seq) return;
      this.hits.set([]);
      this.error.set(isApiFailure(failure) ? failure.error : null);
      this.status.set('error');
    }
  }

  dispose(): void {
    this.clearTimer();
    this.cancelPending();
  }

  private cancelPending(): void {
    this.seq++;
    this.searched = '';
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Entries shown for the current state: the hits for a query, the browse list when it is empty. */
export function entriesFor(query: string, hits: readonly SearchHit[], nav: DocNavService, titles: ReadonlyMap<string, DocSummary>): SearchEntry[] {
  if (query.trim() === '') return browseEntries(nav.favourites(), nav.recents(), titles);
  return hitEntries(hits);
}
