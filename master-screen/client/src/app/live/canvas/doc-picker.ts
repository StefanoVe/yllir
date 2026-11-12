import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, output, signal, viewChild } from '@angular/core';
import type { SearchHit } from '@shared/types';
import { LiveApi } from '../live-api.service';
import { LiveStrings } from '../strings';

const SEARCH_DEBOUNCE_MS = 200;

/** Small search popover: type, move with the arrow keys, Enter picks, Escape closes. Uses GET /api/search. */
@Component({
  selector: 'ms-live-doc-picker',
  templateUrl: './doc-picker.html',
  styleUrl: './doc-picker.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveDocPicker {
  readonly picked = output<string>();
  readonly closed = output<void>();

  readonly s = inject(LiveStrings);
  private readonly api = inject(LiveApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('field');

  readonly query = signal('');
  readonly hits = signal<SearchHit[]>([]);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly active = signal(0);
  readonly searched = signal(false);
  readonly hasActive = computed(() => this.hits().length > 0);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor() {
    afterNextRender(() => this.input().nativeElement.focus());
    this.destroyRef.onDestroy(() => {
      if (this.timer !== null) clearTimeout(this.timer);
    });
  }

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.search(value), SEARCH_DEBOUNCE_MS);
  }

  async search(value: string): Promise<void> {
    const text = value.trim();
    const seq = (this.seq += 1);
    if (text === '') {
      this.hits.set([]);
      this.searched.set(false);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.failed.set(false);
    try {
      const result = await this.api.search(text);
      if (seq !== this.seq) return;
      this.hits.set(result.hits);
      this.active.set(0);
      this.searched.set(true);
    } catch {
      if (seq !== this.seq) return;
      this.hits.set([]);
      this.failed.set(true);
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }

  onKey(event: KeyboardEvent): void {
    const count = this.hits().length;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit();
    } else if (event.key === 'ArrowDown' && count > 0) {
      event.preventDefault();
      this.active.set((this.active() + 1) % count);
    } else if (event.key === 'ArrowUp' && count > 0) {
      event.preventDefault();
      this.active.set((this.active() - 1 + count) % count);
    } else if (event.key === 'Enter' && count > 0) {
      event.preventDefault();
      this.pick(this.active());
    }
  }

  pick(index: number): void {
    const hit = this.hits()[index];
    if (hit) this.picked.emit(hit.path);
  }
}
