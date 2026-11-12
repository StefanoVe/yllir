import { Component, computed, input, output } from '@angular/core';
import { EyeOff, LucideAngularModule } from 'lucide-angular';
import { highlightSegments } from './highlight';
import type { SearchEntry } from './search-query';
import { inject } from '@angular/core';
import { I18n, type TranslationKey } from '../i18n';

/** One result row, used by the search page and the palette. Text is rendered as text, never as HTML. */
@Component({
  selector: 'ms-search-row',
  imports: [LucideAngularModule],
  host: {
    role: 'option',
    class: 'row',
    '[attr.id]': 'id()',
    '[attr.aria-selected]': 'selected()',
    '[class.selected]': 'selected()',
    '(click)': 'opened.emit()',
    '(mousemove)': 'hovered.emit()',
  },
  template: `
    <span class="row-main">
      <span class="row-title">
        @for (part of titleParts(); track $index) {
          @if (part.match) { <mark>{{ part.text }}</mark> } @else { {{ part.text }} }
        }
      </span>
      @if (entry().masterOnly) {
        <span class="row-master" [attr.title]="masterLabel()" [attr.aria-label]="masterLabel()" role="img">
          <lucide-angular [img]="icons.EyeOff" [size]="14" aria-hidden="true" />
        </span>
      }
    </span>
    <span class="row-path">{{ entry().path }}</span>
    @if (snippetParts().length > 0) {
      <span class="row-snippet">
        @for (part of snippetParts(); track $index) {
          @if (part.match) { <mark>{{ part.text }}</mark> } @else { {{ part.text }} }
        }
      </span>
    }
  `,
  styleUrl: './search-hit.css',
})
export class SearchHitRow {
  private readonly i18n = inject(I18n);
  readonly icons = { EyeOff };

  readonly entry = input.required<SearchEntry>();
  readonly query = input('');
  readonly id = input<string | null>(null);
  readonly selected = input(false);

  readonly opened = output<void>();
  readonly hovered = output<void>();

  readonly titleParts = computed(() => highlightSegments(this.entry().title, this.query()));
  readonly snippetParts = computed(() => highlightSegments(this.entry().snippet, this.query()));

  masterLabel(): string {
    return this.i18n.t('reader.masterOnly');
  }
}
