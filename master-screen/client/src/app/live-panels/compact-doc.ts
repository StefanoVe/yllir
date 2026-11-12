import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ArrowLeft, EyeOff, ExternalLink, GripVertical, LucideAngularModule } from 'lucide-angular';
import type { DocResponse } from '@shared/types';
import { docUrl, parseDocHref } from '../core/doc-nav.service';
import { DocBody } from '../reader/doc-body';
import { LiveActionsService } from './live-actions.service';
import { isPanelFailure } from './panel-http';
import { documentPayload, writeCardDrag } from './drag';
import { PanelStrings } from './strings';
import type { RecentDoc } from './lookup-model';

/**
 * A read-only view of one document inside a dock panel. It reuses the reader's body (server-sanitized
 * HTML, master blocks marked) and does not need the full reader route. Its handle drags the document
 * onto the table canvas.
 */
@Component({
  selector: 'ms-compact-doc',
  imports: [LucideAngularModule, RouterLink, DocBody],
  templateUrl: './compact-doc.html',
  styleUrl: './compact-doc.css',
})
export class CompactDoc {
  private readonly actions = inject(LiveActionsService);
  readonly s = inject(PanelStrings);

  readonly path = input.required<string>();
  readonly back = output<void>();
  /** A link inside the document asked to open another document in this panel. */
  readonly navigate = output<string>();
  /** The document loaded; the look-up panel records it as recent. */
  readonly opened = output<RecentDoc>();

  readonly icons = { ArrowLeft, EyeOff, ExternalLink, GripVertical };
  readonly doc = signal<DocResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private seq = 0;

  constructor() {
    effect(() => {
      const path = this.path();
      untracked(() => void this.load(path));
    });
  }

  fullPageLink(): string {
    return docUrl(this.path());
  }

  /** Links in the body: a document link stays in this panel, a web link opens in a new tab. */
  onBodyClick(event: MouseEvent): void {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const anchor = event.target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const href = anchor.getAttribute('href') ?? '';
    const target = parseDocHref(href);
    if (target) {
      event.preventDefault();
      this.navigate.emit(target.path);
    } else if (/^https?:/i.test(href)) {
      event.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  onHandleDragStart(event: DragEvent): void {
    writeCardDrag(event.dataTransfer, documentPayload(this.path()));
  }

  private async load(path: string): Promise<void> {
    const seq = ++this.seq;
    this.doc.set(null);
    this.error.set(null);
    if (path === '') return;
    this.loading.set(true);
    try {
      const doc = await this.actions.readDoc(path);
      if (seq !== this.seq) return;
      this.doc.set(doc);
      this.opened.emit({ path, title: doc.title });
    } catch (failure) {
      if (seq !== this.seq) return;
      this.error.set(isPanelFailure(failure) ? failure.error : this.s.text('panels.lookup.loadError'));
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }
}
