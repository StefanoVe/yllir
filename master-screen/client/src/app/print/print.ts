import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import {
  CircleCheck,
  CircleDashed,
  EllipsisVertical,
  Hammer,
  Images,
  Info,
  LoaderCircle,
  LucideAngularModule,
  Printer,
  RotateCcw,
  TriangleAlert,
  User,
} from 'lucide-angular';
import type { PrintCard, PrintSheetResult, PrintState, PrintStatus } from '@shared/types';
import { CallFailure } from '../encyclopedia/call-json';
import { I18n, type TranslationKey } from '../i18n';
import { PrintApiService, type PrintFormat, type PrintSheetsRequest } from './print-api.service';

export type PrintFilter = 'all' | PrintState | 'none';

export const PRINT_FILTERS: ReadonlyArray<{ value: PrintFilter; key: TranslationKey }> = [
  { value: 'all', key: 'print.filterAll' },
  { value: 'to-print', key: 'print.state.toPrint' },
  { value: 'printed', key: 'print.state.printed' },
  { value: 'reprint', key: 'print.state.reprint' },
  { value: 'none', key: 'print.state.none' },
];

export const MIN_COPIES = 1;
export const MAX_COPIES = 20;

/**
 * A copies number from a typed value, kept within 1..20 and rounded. Returns null when the text
 * is not a number at all (the input then keeps its previous value).
 */
export function clampCopies(raw: number | string): number | null {
  const value = typeof raw === 'string' ? (raw.trim() === '' ? NaN : Number(raw)) : raw;
  if (!Number.isFinite(value)) return null;
  return Math.min(MAX_COPIES, Math.max(MIN_COPIES, Math.round(value)));
}

export function matchesFilter(card: PrintCard, filter: PrintFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'none') return card.print === null;
  return card.print === filter;
}

/**
 * The body of POST /api/print/sheets for the selection. Cards keep the order of the list; only
 * personal cards carry copies (default 1).
 */
export function buildSheetsRequest(
  cards: readonly PrintCard[],
  selected: ReadonlySet<string>,
  copies: Readonly<Record<string, number>>,
  format: PrintFormat,
  cmyk: boolean,
): PrintSheetsRequest {
  const chosen = cards.filter((card) => selected.has(card.id));
  const personalCopies: Record<string, number> = {};
  for (const card of chosen) {
    if (card.personal) personalCopies[card.id] = copies[card.id] ?? MIN_COPIES;
  }
  return { ids: chosen.map((card) => card.id), format, cmyk, copies: personalCopies };
}

function isPrintState(value: string): value is PrintState {
  return value === 'to-print' || value === 'printed' || value === 'reprint';
}

function isFilter(value: string): value is PrintFilter {
  return PRINT_FILTERS.some((option) => option.value === value);
}

/** The print list (`/print`): cards, states, selection, copies, sheets and card images. */
@Component({
  selector: 'ms-print-page',
  imports: [LucideAngularModule],
  templateUrl: './print.html',
  styleUrl: './print.css',
})
export class PrintPage {
  private readonly api = inject(PrintApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly i18n = inject(I18n);

  readonly icons = {
    CircleCheck,
    CircleDashed,
    EllipsisVertical,
    Hammer,
    Images,
    Info,
    LoaderCircle,
    Printer,
    RotateCcw,
    TriangleAlert,
    User,
  };
  readonly filterOptions = PRINT_FILTERS;
  readonly minCopies = MIN_COPIES;
  readonly maxCopies = MAX_COPIES;

  /** The server's view of the cards. Only ever replaced by a server answer. */
  readonly status = signal<PrintStatus | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly filter = signal<PrintFilter>('all');
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly copies = signal<Readonly<Record<string, number>>>({});
  readonly format = signal<PrintFormat>('5x7');
  readonly cmyk = signal(false);
  /** The card whose actions are open. */
  readonly menuId = signal<string | null>(null);
  /** The card waiting for the "printed" confirmation. */
  readonly confirmId = signal<string | null>(null);
  /** The card with a request running (state or image). */
  readonly busyId = signal<string | null>(null);
  readonly cardError = signal<Readonly<Record<string, string>>>({});
  readonly making = signal(false);
  readonly sheetError = signal<string | null>(null);
  readonly sheetResult = signal<PrintSheetResult | null>(null);

  readonly cards = computed(() => this.status()?.cards ?? []);
  readonly visible = computed(() => this.cards().filter((card) => matchesFilter(card, this.filter())));
  readonly selectedCount = computed(() => this.selected().size);
  readonly enabled = computed(() => this.status()?.enabled === true);
  readonly pdfSrc = computed<SafeResourceUrl | null>(() => {
    const url = this.sheetResult()?.fileUrl ?? null;
    // Only the server's own sheet files are shown inline.
    return url !== null && url.startsWith('/api/print/files/') ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  constructor() {
    void this.load();
  }

  t(key: TranslationKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }

  /** GET /api/print. The first answer sets the format and CMYK defaults. */
  async load(): Promise<void> {
    try {
      const next = await this.api.status();
      if (this.status() === null) {
        this.format.set(next.format);
        this.cmyk.set(next.cmyk);
      }
      this.status.set(next);
      this.loadError.set(null);
    } catch (failure) {
      this.loadError.set(this.messageOf(failure));
    }
  }

  @HostListener('keydown.escape')
  closeMenu(): void {
    this.menuId.set(null);
    this.confirmId.set(null);
  }

  emptyText(): string {
    return this.cards().length === 0 ? this.t('print.empty') : this.t('print.noMatch');
  }

  onFilter(raw: string): void {
    if (isFilter(raw)) this.filter.set(raw);
  }

  onFormat(raw: string): void {
    if (raw === '5x7' || raw === 'a4') this.format.set(raw);
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggle(id: string): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Adds every card on screen to the selection. Cards hidden by the filter keep their state. */
  selectShown(): void {
    this.selected.update((current) => new Set([...current, ...this.visible().map((card) => card.id)]));
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  toggleMenu(id: string): void {
    if (this.menuId() === id) {
      this.closeMenu();
      return;
    }
    this.confirmId.set(null);
    this.menuId.set(id);
  }

  copyCount(id: string): number {
    return this.copies()[id] ?? MIN_COPIES;
  }

  /** Reads the copies typed by the master. Out of range values are kept within 1..20; text that is not a number is ignored. */
  onCopies(id: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = clampCopies(input.value);
    if (value === null) {
      input.value = String(this.copyCount(id));
      return;
    }
    this.copies.update((current) => ({ ...current, [id]: value }));
    input.value = String(value);
  }

  stateValue(id: string): string {
    return this.cards().find((card) => card.id === id)?.print ?? '';
  }

  /**
   * Picking a state asks the server. "Printed" waits for the inline confirmation first, because
   * only the master can say that a card has been printed. The select goes back to the saved
   * value until the server has answered.
   */
  onStateChange(card: PrintCard, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    if (!isPrintState(value)) {
      select.value = this.stateValue(card.id);
      return;
    }
    if (value === 'printed' && card.print !== 'printed') {
      select.value = this.stateValue(card.id);
      this.confirmId.set(card.id);
      return;
    }
    void this.setState(card.id, value, select);
  }

  confirmPrinted(card: PrintCard): void {
    this.confirmId.set(null);
    void this.setState(card.id, 'printed');
  }

  cancelPrinted(): void {
    this.confirmId.set(null);
  }

  /** POST /api/print/state. The chip changes only with the server's answer. */
  async setState(id: string, state: PrintState, select?: HTMLSelectElement): Promise<void> {
    this.busyId.set(id);
    this.setCardError(id, null);
    try {
      this.status.set(await this.api.setState(id, state));
    } catch (failure) {
      this.setCardError(id, this.messageOf(failure));
    } finally {
      this.busyId.set(null);
      if (select) select.value = this.stateValue(id);
    }
  }

  /** POST /api/print/render with the node renderer. Failures (for example the Photoshop message) show on the card. */
  async makeImage(card: PrintCard): Promise<void> {
    if (this.busyId() !== null) return;
    this.busyId.set(card.id);
    this.setCardError(card.id, null);
    try {
      this.status.set(await this.api.render(card.id, 'node'));
    } catch (failure) {
      this.setCardError(card.id, this.messageOf(failure));
    } finally {
      this.busyId.set(null);
    }
  }

  /** POST /api/print/sheets for the selection. */
  async makeSheets(): Promise<void> {
    const body = buildSheetsRequest(this.cards(), this.selected(), this.copies(), this.format(), this.cmyk());
    if (body.ids.length === 0 || this.making()) return;
    this.making.set(true);
    this.sheetError.set(null);
    this.sheetResult.set(null);
    try {
      this.sheetResult.set(await this.api.sheets(body));
    } catch (failure) {
      this.sheetError.set(this.messageOf(failure));
    } finally {
      this.making.set(false);
    }
  }

  stateIcon(state: PrintState | null) {
    if (state === 'printed') return this.icons.CircleCheck;
    if (state === 'reprint') return this.icons.RotateCcw;
    if (state === 'to-print') return this.icons.Printer;
    return this.icons.CircleDashed;
  }

  /** The state as words, next to the icon. */
  stateText(state: PrintState | null): string {
    if (state === 'printed') return this.t('print.state.printed');
    if (state === 'reprint') return this.t('print.state.reprint');
    if (state === 'to-print') return this.t('print.state.toPrint');
    return this.t('print.state.none');
  }

  pagesText(count: number): string {
    return this.t(count === 1 ? 'print.pages.one' : 'print.pages.other', { count });
  }

  excludedText(count: number): string {
    return this.t(count === 1 ? 'print.excludedCount.one' : 'print.excludedCount.other', { count });
  }

  /** Excluded items come with a card id: show the card's title when it is on the list. */
  excludedLine(item: { id: string; reason: string }): string {
    const card = this.cards().find((entry) => entry.id === item.id);
    return this.t('print.excludedLine', { card: card?.title ?? item.id, reason: item.reason });
  }

  private setCardError(id: string, message: string | null): void {
    this.cardError.update((current) => {
      const next = { ...current };
      if (message === null) delete next[id];
      else next[id] = message;
      return next;
    });
  }

  private messageOf(failure: unknown): string {
    if (failure instanceof CallFailure || failure instanceof Error) return failure.message;
    return this.t('errors.generic');
  }
}
