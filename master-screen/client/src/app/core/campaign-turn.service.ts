import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Turn } from '@shared/types';
import { nextCampaignTurn } from '../chat/conversations';
import { ApiService } from './api.service';
import { LiveService } from './live.service';

/**
 * The queued or running turn of the whole campaign, whatever its conversation. It is loaded from
 * `GET /api/chats` and then kept up to date by the live `turn` events, so any screen can show it.
 * A failed load is swallowed: the screens that use it simply show nothing.
 */
@Injectable({ providedIn: 'root' })
export class CampaignTurnService {
  private readonly api = inject(ApiService);
  private readonly live = inject(LiveService);

  private readonly current = signal<Turn | null>(null);
  readonly turn = this.current.asReadonly();

  /** Count of turn events. A list fetched before the latest event does not overwrite that event. */
  private turnEvents = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.live
      .on('turn')
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((turn) => {
        this.turnEvents += 1;
        this.current.update((running) => nextCampaignTurn(running, turn));
      });
    this.live
      .on('conversations')
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => void this.load());
    this.live.resync$.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => void this.load());
    void this.load();
  }

  /** Loads the campaign's turn from the conversation list. Failures are ignored. */
  async load(): Promise<void> {
    const seen = this.turnEvents;
    try {
      const list = await this.api.conversations();
      if (seen === this.turnEvents) this.current.set(list.turn);
    } catch {
      // The indicator stays as it is: a missing turn is not an error the master can act on.
    }
  }
}
