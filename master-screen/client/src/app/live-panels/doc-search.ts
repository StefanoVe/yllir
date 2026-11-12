import { signal } from '@angular/core';
import type { SearchHit } from '@shared/types';

export const DOC_SEARCH_DEBOUNCE_MS = 150;

export type DocSearchStatus = 'idle' | 'loading' | 'done' | 'error';

/**
 * Debounced, stale-safe document search for one panel. Only the newest request may change the hits;
 * an older response that arrives later is dropped. Call dispose() when the panel is destroyed.
 */
export class DocSearch {
  readonly text = signal('');
  readonly hits = signal<SearchHit[]>([]);
  readonly status = signal<DocSearchStatus>('idle');
  readonly error = signal<string | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor(
    private readonly search: (query: string) => Promise<SearchHit[]>,
    private readonly debounceMs = DOC_SEARCH_DEBOUNCE_MS,
  ) {}

  /** The user typed: wait for a pause, then ask. An empty query clears the results at once. */
  type(raw: string): void {
    this.text.set(raw);
    this.clearTimer();
    this.seq++;
    const query = raw.trim();
    if (query === '') {
      this.hits.set([]);
      this.error.set(null);
      this.status.set('idle');
      return;
    }
    this.status.set('loading');
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(query);
    }, this.debounceMs);
  }

  async run(query: string): Promise<void> {
    const id = ++this.seq;
    this.status.set('loading');
    this.error.set(null);
    try {
      const found = await this.search(query);
      if (id !== this.seq) return;
      this.hits.set(found);
      this.status.set('done');
    } catch (failure) {
      if (id !== this.seq) return;
      this.hits.set([]);
      this.error.set(typeof (failure as { error?: unknown })?.error === 'string' ? (failure as { error: string }).error : null);
      this.status.set('error');
    }
  }

  dispose(): void {
    this.clearTimer();
    this.seq++;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
