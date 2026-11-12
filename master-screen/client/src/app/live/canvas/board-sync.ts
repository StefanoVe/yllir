import type { Board } from '@shared/types';
import { isLiveFailure } from '../live-types';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'conflict' | 'error';

export interface BoardSyncOptions {
  /** Sends the whole board. Resolves with the server's board; rejects with a LiveFailure (409 carries the current board). */
  put: (board: Board) => Promise<Board>;
  /** Called with the board the server holds, after a save or after a conflict. */
  onServer: (board: Board, reason: 'saved' | 'conflict') => void;
  onStatus?: (status: SaveStatus) => void;
  debounceMs?: number;
}

/**
 * Debounced, revision-checked saves of the board. Edits are local until the
 * debounce ends; then the whole board goes up with the last revision the server
 * confirmed. A 409 adopts the server's board. Only one save is in flight at a time.
 */
export class BoardSync {
  private pending: Board | null = null;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private base: number;
  private current: SaveStatus = 'saved';
  private readonly debounceMs: number;

  constructor(
    private readonly options: BoardSyncOptions,
    revision: number,
  ) {
    this.base = revision;
    this.debounceMs = options.debounceMs ?? 400;
  }

  get status(): SaveStatus {
    return this.current;
  }

  /** True while an edit waits for the debounce or a save is in flight. Server boards must not replace the local copy then. */
  get dirty(): boolean {
    return this.pending !== null || this.inFlight;
  }

  get revision(): number {
    return this.base;
  }

  /** Adopts the server revision, but only when nothing local is waiting to be saved. */
  rebase(revision: number): void {
    if (!this.dirty) this.base = revision;
  }

  schedule(board: Board): void {
    this.pending = board;
    this.setStatus('pending');
    this.arm();
  }

  /** Sends the pending edit now (used on leaving the canvas and on retry). */
  async flush(): Promise<void> {
    this.clearTimer();
    await this.send();
  }

  private arm(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.send();
    }, this.debounceMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async send(): Promise<void> {
    if (this.inFlight || this.pending === null) return;
    const board = this.pending;
    this.pending = null;
    this.inFlight = true;
    this.setStatus('saving');
    try {
      const saved = await this.options.put({ ...board, revision: this.base });
      this.inFlight = false;
      this.base = saved.revision;
      if (this.pending !== null) {
        // Edits arrived while saving: send them after the debounce, from the new base.
        this.setStatus('pending');
        this.arm();
        return;
      }
      this.setStatus('saved');
      this.options.onServer(saved, 'saved');
    } catch (failure) {
      this.inFlight = false;
      if (isLiveFailure(failure) && failure.status === 409 && failure.board) {
        this.base = failure.board.revision;
        this.pending = null;
        this.setStatus('conflict');
        this.options.onServer(failure.board, 'conflict');
        return;
      }
      // Keep the edit so a retry (next edit or flush) sends it again.
      if (this.pending === null) this.pending = board;
      this.setStatus('error');
    }
  }

  private setStatus(status: SaveStatus): void {
    if (this.current === status) return;
    this.current = status;
    this.options.onStatus?.(status);
  }
}
