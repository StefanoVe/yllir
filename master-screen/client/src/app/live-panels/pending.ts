import { signal } from '@angular/core';

/** Safety net: a busy control is released after this long even if no new snapshot arrived. */
export const BUSY_FALLBACK_MS = 5000;

/**
 * Busy and error state of the controls of one panel. A control is busy from the click until the
 * `snapshot` input changes (settle), or until its call fails (fail shows the message next to it).
 * There are no optimistic updates: nothing is shown as done before the server confirmed it.
 */
export class PendingControls {
  private readonly busy = signal<ReadonlySet<string>>(new Set());
  private readonly failures = signal<ReadonlyMap<string, string>>(new Map());
  private timer: ReturnType<typeof setTimeout> | null = null;

  isBusy(key: string): boolean {
    return this.busy().has(key);
  }

  errorFor(key: string): string | null {
    return this.failures().get(key) ?? null;
  }

  /** The first error among the keys that start with `prefix` (one row of a list, for example). */
  errorWithPrefix(prefix: string): string | null {
    for (const [key, message] of this.failures()) {
      if (key.startsWith(prefix)) return message;
    }
    return null;
  }

  busyWithPrefix(prefix: string): boolean {
    for (const key of this.busy()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  /** Marks a control busy and clears its old error. Returns false when that control is already busy. */
  start(key: string): boolean {
    if (this.busy().has(key)) return false;
    this.failures.update((map) => {
      const next = new Map(map);
      next.delete(key);
      return next;
    });
    this.busy.update((set) => new Set(set).add(key));
    this.clearTimer();
    this.timer = setTimeout(() => this.settle(), BUSY_FALLBACK_MS);
    return true;
  }

  /** The call failed: the control is free again and the plain-language message stays next to it. */
  fail(key: string, message: string): void {
    this.busy.update((set) => {
      const next = new Set(set);
      next.delete(key);
      return next;
    });
    this.failures.update((map) => new Map(map).set(key, message));
  }

  /** A new snapshot arrived: every busy control is free. */
  settle(): void {
    this.clearTimer();
    if (this.busy().size > 0) this.busy.set(new Set());
  }

  dispose(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
