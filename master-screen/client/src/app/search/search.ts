import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { DocNavService, docUrl } from '../core/doc-nav.service';
import { ViewModeService } from '../core/view-mode.service';
import { I18n, type TranslationKey } from '../i18n';
import { SearchHitRow } from './search-hit';
import { SearchEntry, SearchQuery, entriesFor } from './search-query';

/** Full-page search: the same results as the palette, on a page of their own. */
@Component({
  selector: 'ms-search',
  imports: [SearchHitRow],
  templateUrl: './search.html',
  styleUrl: './search.css',
})
export class Search {
  private readonly api = inject(ApiService);
  private readonly view = inject(ViewModeService);
  private readonly nav = inject(DocNavService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);

  readonly query = new SearchQuery(this.api, this.view);
  readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  readonly active = signal(0);
  readonly listId = 'search-list';

  readonly entries = computed<SearchEntry[]>(() =>
    entriesFor(this.query.text(), this.query.hits(), this.nav, this.query.titles()),
  );
  readonly cursor = computed(() => Math.min(this.active(), Math.max(0, this.entries().length - 1)));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.query.dispose());
    // Players preview switched: the same words may match different text, so search again.
    effect(() => {
      this.view.viewMode();
      untracked(() => this.query.refresh());
    });
  }

  label(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  optionId(index: number): string {
    return `search-option-${index}`;
  }

  onInput(value: string): void {
    this.active.set(0);
    this.query.type(value);
  }

  open(index: number): void {
    const entry = this.entries()[index];
    if (!entry) return;
    void this.router.navigateByUrl(docUrl(entry.path));
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.entries().length;
    if (event.key === 'ArrowDown' && count > 0) {
      event.preventDefault();
      this.active.set((this.cursor() + 1) % count);
    } else if (event.key === 'ArrowUp' && count > 0) {
      event.preventDefault();
      this.active.set((this.cursor() - 1 + count) % count);
    } else if (event.key === 'Enter' && count > 0) {
      event.preventDefault();
      this.open(this.cursor());
    }
  }
}
