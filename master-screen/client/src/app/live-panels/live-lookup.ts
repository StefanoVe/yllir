import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { LucideAngularModule, EyeOff, GripVertical } from 'lucide-angular';
import { PrefsService } from '../core/prefs.service';
import { highlightSegments, type Segment } from '../search/highlight';
import { CompactDoc } from './compact-doc';
import { documentPayload, writeCardDrag } from './drag';
import { DocSearch } from './doc-search';
import { LiveActionsService } from './live-actions.service';
import { RECENTS_KEY, parseRecents, pushRecent, type RecentDoc } from './lookup-model';
import { PanelStrings } from './strings';

/**
 * Dock panel: search the documents, read one in place, drag it onto the table.
 * With an empty query it lists the recently opened documents.
 */
@Component({
  selector: 'ms-live-lookup',
  imports: [LucideAngularModule, CompactDoc],
  templateUrl: './live-lookup.html',
  styleUrl: './live-lookup.css',
})
export class LiveLookupComponent {
  private readonly actions = inject(LiveActionsService);
  private readonly prefs = inject(PrefsService);
  readonly s = inject(PanelStrings);

  readonly icons = { EyeOff, GripVertical };
  readonly query = new DocSearch((text) => this.actions.searchDocs(text).then((response) => response.hits));
  readonly selected = signal<string | null>(null);
  readonly recents = signal<RecentDoc[]>([]);
  readonly searching = computed(() => this.query.text().trim() !== '');

  constructor() {
    // Preferences are unavailable until the campaign slug is known; read the recents once it is.
    effect(() => {
      if (this.prefs.slug() === null) return;
      untracked(() => this.recents.set(parseRecents(this.prefs.get(RECENTS_KEY))));
    });
  }

  onInput(value: string): void {
    this.query.type(value);
  }

  open(path: string): void {
    this.selected.set(path);
  }

  close(): void {
    this.selected.set(null);
  }

  /** The document loaded in the compact view: it becomes the most recent entry. */
  recordOpened(entry: RecentDoc): void {
    const next = pushRecent(this.recents(), entry);
    this.recents.set(next);
    this.prefs.set(RECENTS_KEY, JSON.stringify(next));
  }

  segments(text: string): Segment[] {
    return highlightSegments(text, this.query.text());
  }

  onRowDragStart(event: DragEvent, path: string): void {
    writeCardDrag(event.dataTransfer, documentPayload(path));
  }
}
