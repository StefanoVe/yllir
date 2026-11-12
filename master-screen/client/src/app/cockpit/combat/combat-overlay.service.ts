import { Injectable, inject, signal } from "@angular/core";
import { OverlayService } from "../support/overlay.service";
import type { FightCard } from "./combat-model";

const OVERLAY_ID = "combat";

/**
 * Open state of the combat overlay. The overlay shows the initiative step when no combat
 * is active and the battle view when one is. It opens by itself only when a combat starts
 * while the session is on screen, and stays closed once the master closes it.
 */
@Injectable({ providedIn: "root" })
export class CombatOverlayService {
  readonly open = signal(false);
  /** The card the master clicked the swords button on, if the overlay was opened from a card. */
  readonly clicked = signal<FightCard | null>(null);
  private readonly overlay = inject(OverlayService);
  private sessionId: string | null = null;
  private wasActive = false;

  openFor(card: FightCard): void {
    this.clicked.set(card);
    this.show();
  }

  close(): void {
    this.open.set(false);
    this.overlay.remove(OVERLAY_ID);
  }

  /** Called whenever the open session or its combat changes. */
  sync(sessionId: string | null, active: boolean): void {
    const previous = this.sessionId;
    const sameSession = sessionId === previous;
    this.sessionId = sessionId;
    if (!sameSession) {
      // Switching session never opens the overlay; it belongs to the session it was opened on.
      if (previous !== null) this.close();
      this.wasActive = active;
      return;
    }
    if (active && !this.wasActive) this.show();
    if (!active && this.wasActive) this.close();
    this.wasActive = active;
  }

  private show(): void {
    this.open.set(true);
    this.overlay.push(OVERLAY_ID);
  }
}
