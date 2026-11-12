import { Injectable, computed, signal } from "@angular/core";

/** Stack of open overlays: only the top one reacts to Escape and navigation keys. */
@Injectable({ providedIn: "root" })
export class OverlayService {
  private readonly stack = signal<string[]>([]);
  readonly top = computed(() => this.stack().at(-1) ?? null);

  push(id: string) {
    this.stack.update((ids) => [...ids.filter((item) => item !== id), id]);
  }

  remove(id: string) {
    this.stack.update((ids) => ids.filter((item) => item !== id));
  }

  isTop(id: string): boolean {
    return this.top() === id;
  }
}
