import { Component, ElementRef, Injector, afterNextRender, computed, inject, viewChild } from '@angular/core';
import { LucideAngularModule, LoaderCircle, TriangleAlert } from 'lucide-angular';
import { UpdateService } from '../core/update';
import { I18n, type TranslationKey } from '../i18n';

/**
 * The first lines of the news as plain text: list marks dropped, blank lines skipped, at most two lines
 * joined by a space. The card clamps what is left; nothing is rendered as HTML.
 */
export function newsPreview(news: string | null): string {
  if (!news) return '';
  return news
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter((line) => line !== '')
    .slice(0, 2)
    .join(' ');
}

/**
 * The update card at the top right of the window. It is shown when an update is ready and not postponed,
 * and while the update runs or has failed. It never blocks the page: Escape means "Later" (or goes back
 * from the confirmation). When open sessions would be closed, "Update" first asks the master to confirm.
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

  readonly icons = { LoaderCircle, TriangleAlert };
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');

  readonly status = computed(() => this.updates.status());
  readonly visible = computed(() => {
    const status = this.status();
    if (!status) return false;
    if (status.state === 'available') return !status.snoozed;
    return status.state === 'updating' || status.state === 'restarting' || status.state === 'failed';
  });
  /** The confirmation step: only while an update is offered and open sessions would be closed. */
  readonly confirm = computed(() => this.status()?.state === 'available' && this.updates.confirming());
  readonly sessions = computed(() => this.status()?.sessions ?? []);
  readonly preview = computed(() => newsPreview(this.status()?.news ?? null));

  t(key: TranslationKey): string {
    return this.i18n.t(key);
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

  /** Escape: back from the confirmation, otherwise "Later" (only while an update is offered). */
  onEscape(): void {
    if (this.status()?.state !== 'available') return;
    if (this.confirm()) this.cancel();
    else this.later();
  }
}
