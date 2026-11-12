import {
  AfterViewInit,
  Component,
  ElementRef,
  Injectable,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, Search, X } from 'lucide-angular';
import { ApiService } from '../core/api.service';
import { DocNavService, docUrl } from '../core/doc-nav.service';
import { ViewModeService } from '../core/view-mode.service';
import { I18n, type TranslationKey } from '../i18n';
import { SearchHitRow } from './search-hit';
import { SearchEntry, SearchQuery, entriesFor } from './search-query';

/** Open state of the command palette. The shell owns the overlay; anything can open it. */
@Injectable({ providedIn: 'root' })
export class PaletteController {
  readonly open = signal(false);

  show(): void {
    this.open.set(true);
  }

  hide(): void {
    this.open.set(false);
  }

  toggle(): void {
    this.open.update((value) => !value);
  }
}

/**
 * Command-palette overlay: a search box over the campaign documents. Arrow keys move, Enter
 * opens, Escape closes, Tab stays inside the dialog. Focus returns to where it was on close.
 */
@Component({
  selector: 'ms-palette',
  imports: [LucideAngularModule, SearchHitRow, RouterLink],
  templateUrl: './palette.html',
  styleUrl: './palette.css',
  host: {
    '(keydown)': 'onKeydown($event)',
  },
})
export class Palette implements AfterViewInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly view = inject(ViewModeService);
  private readonly nav = inject(DocNavService);
  private readonly router = inject(Router);
  private readonly palette = inject(PaletteController);
  private readonly i18n = inject(I18n);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly returnFocus = typeof document !== 'undefined' ? document.activeElement : null;

  readonly icons = { Search, X };
  readonly query = new SearchQuery(this.api, this.view);
  readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  readonly entries = computed<SearchEntry[]>(() =>
    entriesFor(this.query.text(), this.query.hits(), this.nav, this.query.titles()),
  );
  readonly active = signal(0);
  readonly cursor = computed(() => Math.min(this.active(), Math.max(0, this.entries().length - 1)));
  readonly listId = 'palette-list';

  ngAfterViewInit(): void {
    afterNextRender(() => this.input().nativeElement.focus(), { injector: this.injector });
  }

  ngOnDestroy(): void {
    this.query.dispose();
    if (this.returnFocus instanceof HTMLElement && this.returnFocus.isConnected) this.returnFocus.focus();
  }

  optionId(index: number): string {
    return `palette-option-${index}`;
  }

  label(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  onInput(value: string): void {
    this.active.set(0);
    this.query.type(value);
  }

  choose(index: number): void {
    const entry = this.entries()[index];
    if (!entry) return;
    this.palette.hide();
    void this.router.navigateByUrl(docUrl(entry.path));
  }

  close(): void {
    this.palette.hide();
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.entries().length;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      case 'ArrowDown':
        event.preventDefault();
        if (count > 0) this.active.set((this.cursor() + 1) % count);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (count > 0) this.active.set((this.cursor() - 1 + count) % count);
        return;
      case 'Home':
        if (event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        this.active.set(0);
        return;
      case 'End':
        if (event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        this.active.set(Math.max(0, count - 1));
        return;
      case 'Enter':
        if (count === 0) return;
        event.preventDefault();
        this.choose(this.cursor());
        return;
      case 'Tab':
        this.trapTab(event);
        return;
      default:
        return;
    }
  }

  /** Keeps Tab focus between the focusable controls of the dialog. */
  private trapTab(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('input, a[href], button:not([disabled])'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement;
    if (event.shiftKey && (current === first || !focusable.includes(current as HTMLElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || !focusable.includes(current as HTMLElement))) {
      event.preventDefault();
      first.focus();
    }
  }
}
