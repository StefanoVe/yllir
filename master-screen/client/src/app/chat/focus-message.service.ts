import { Injectable, signal } from '@angular/core';

export interface FocusRequest {
  id: string;
  /** Increases on every request, so asking twice for the same message still triggers. */
  seq: number;
}

/** Asks the chat to scroll to and highlight one message (used by the changes panel). */
@Injectable({ providedIn: 'root' })
export class FocusMessageService {
  private seq = 0;
  readonly request = signal<FocusRequest | null>(null);

  focus(id: string): void {
    this.seq += 1;
    this.request.set({ id, seq: this.seq });
  }
}
