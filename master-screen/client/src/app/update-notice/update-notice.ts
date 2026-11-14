import { Component, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { LucideAngularModule, ArrowUpCircle, LoaderCircle, TriangleAlert } from 'lucide-angular';
import { UpdateService } from '../core/update';
import { I18n, type TranslationKey } from '../i18n';

/** One block of the changelog: a run of plain lines, or a run of list items. */
export interface NewsGroup {
  list: boolean;
  items: string[];
}

/**
 * The changelog as plain text blocks. Each non-empty line is a paragraph; lines starting with "- " or "* "
 * are list items, and consecutive items share one list. Nothing is rendered as HTML.
 */
export function newsGroups(news: string | null): NewsGroup[] {
  const groups: NewsGroup[] = [];
  for (const raw of (news ?? '').split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const item = /^[-*](?:\s+(.*))?$/.exec(line);
    const list = item !== null;
    const text = item ? (item[1] ?? '').trim() : line;
    if (text === '') continue;
    const last = groups[groups.length - 1];
    if (last && last.list === list) last.items.push(text);
    else groups.push({ list, items: [text] });
  }
  return groups;
}

/**
 * The update notice at the top right of the window. While an update is offered it is a compact pill whose
 * panel (changelog, Update, Later) opens on hover, focus or click. When open sessions would be closed, "Update"
 * first asks the master to confirm in a card. The progress and failed states are cards too. It never blocks
 * the page: Escape closes the panel, or goes back from the confirmation.
 */
@Component({
  selector: 'ms-update-notice',
  imports: [LucideAngularModule],
  templateUrl: './update-notice.html',
  styleUrl: './update-notice.css',
})
export class UpdateNotice {
  readonly i18n = inject(I18n);
  readonly updates = inject(UpdateService);
  private readonly injector = inject(Injector);

  readonly icons = { ArrowUpCircle, LoaderCircle, TriangleAlert };
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');

  /** The panel is pinned open by a click or tap on the pill, until Escape, a second click or focus leaving. */
  readonly open = signal(false);
  /** Escape hides the panel even while hover or focus would show it; cleared when the pointer or focus leaves. */
  readonly dismissed = signal(false);

  readonly status = computed(() => this.updates.status());
  readonly visible = computed(() => {
    const status = this.status();
    if (!status) return false;
    if (status.state === 'available') return !status.snoozed;
    return status.state === 'updating' || status.state === 'restarting' || status.state === 'failed';
  });
  /** The confirmation step: only while an update is offered and open sessions would be closed. */
  readonly confirm = computed(() => this.status()?.state === 'available' && this.updates.confirming());
  /** The compact pill with its panel: an update is offered and no confirmation is asked. */
  readonly pill = computed(() => this.status()?.state === 'available' && !this.updates.confirming());
  readonly pillText = computed(() => {
    const version = this.status()?.version ?? null;
    return version ? this.i18n.t('update.pill', { version }) : this.i18n.t('update.title');
  });
  readonly sessions = computed(() => this.status()?.sessions ?? []);
  readonly news = computed(() => newsGroups(this.status()?.news ?? null));

  t(key: TranslationKey): string {
    return this.i18n.t(key);
  }

  /** Click or tap on the pill: pins the panel open, or closes it when it is pinned. */
  toggle(): void {
    this.dismissed.set(false);
    this.open.update((value) => !value);
  }

  /** Escape on the pill or the panel: closes the panel and keeps it closed until hover or focus leaves. */
  closePanel(): void {
    this.open.set(false);
    this.dismissed.set(true);
  }

  onPointerLeave(): void {
    this.dismissed.set(false);
  }

  /** Focus leaving the notice releases the pinned panel and the Escape dismissal. */
  onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    const host = event.currentTarget as HTMLElement;
    if (next && host.contains(next)) return;
    this.open.set(false);
    this.dismissed.set(false);
  }

  /** "Update": asks first when open sessions would be closed, otherwise starts at once. */
  ask(): void {
    this.updates.requestApply();
    if (this.updates.confirming()) {
      // The card changes content: move the focus to its heading so a keyboard user hears the question.
      afterNextRender(() => this.title()?.nativeElement.focus(), { injector: this.injector });
    }
  }

  /** "Confirm" of the list: the only call that closes the sessions and starts the update. */
  confirmApply(): void {
    void this.updates.apply(true);
  }

  cancel(): void {
    this.updates.cancelApply();
  }

  later(): void {
    void this.updates.snooze();
  }

  retry(): void {
    void this.updates.retry();
  }

  /** Escape in the confirmation goes back. The other states do not close on Escape. */
  onEscape(): void {
    if (this.confirm()) this.cancel();
  }
}
