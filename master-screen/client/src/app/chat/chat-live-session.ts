import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LiveService } from '../core/live.service';

/**
 * Whether a live session is open, for the chat header link to the live table.
 * Reads GET /api/live on start, on every `live` event and after every reconnect.
 */
@Injectable({ providedIn: 'root' })
export class ChatLiveSession {
  private readonly live = inject(LiveService);
  readonly open = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.live.on('live').pipe(takeUntilDestroyed(destroyRef)).subscribe(() => void this.load());
    this.live.resync$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => void this.load());
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const response = await fetch('/api/live', { cache: 'no-store' });
      if (!response.ok) return;
      const snapshot = (await response.json()) as { session?: unknown } | null;
      this.open.set((snapshot?.session ?? null) !== null);
    } catch {
      // Keep the last known state; the link is only a convenience.
    }
  }
}
