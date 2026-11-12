import { Component, computed, inject, input, signal } from "@angular/core";
import type { CockpitAction } from "@shared/cockpit-types";
import type { LivePlayer } from "@shared/types";
import { CockpitService } from "../cockpit.service";
import { I18n } from "../../i18n";
import {
  type CreatureRow,
  type FightCard,
  type PlayerRow,
  type Side,
  buildCombatStart,
} from "./combat-model";

interface CreatureState {
  checked: boolean;
  side: Side;
}

/**
 * Step 1 of the combat: the initiative of every player character and of the creatures.
 * Confirm sends one `combat.start` action; the overlay switches to the battle view when the
 * combat becomes active.
 */
@Component({
  selector: "cockpit-initiative-step",
  templateUrl: "./initiative-step.html",
  styleUrl: "./initiative-step.css",
})
export class InitiativeStep {
  readonly i18n = inject(I18n);
  private readonly api = inject(CockpitService);
  players = input<LivePlayer[]>([]);
  /** Every character and creature card on the board. */
  cards = input<FightCard[]>([]);
  /** The card the master clicked, always listed first and ticked. */
  clicked = input<FightCard | null>(null);
  readonly initiatives = signal<Record<string, string>>({});
  readonly creatureState = signal<Record<string, CreatureState>>({});
  readonly busy = signal(false);
  readonly error = signal("");

  readonly pcRows = computed(() =>
    this.players().map((p) => ({
      key: `pc:${p.ref}`,
      name: p.name,
      path: p.ref,
      initiative: this.initiatives()[`pc:${p.ref}`] ?? "",
    })),
  );

  readonly creatureRows = computed(() => {
    const clicked = this.clicked();
    const others = this.cards().filter((c) => c.cardId !== clicked?.cardId);
    const cards = clicked ? [clicked, ...others] : others;
    const state = this.creatureState();
    return cards.map((card) => {
      const key = `card:${card.cardId}`;
      return {
        key,
        cardId: card.cardId,
        name: card.name,
        path: card.path,
        checked: state[card.cardId]?.checked ?? card.cardId === clicked?.cardId,
        side: state[card.cardId]?.side ?? ("enemy" as Side),
        initiative: this.initiatives()[key] ?? "",
      };
    });
  });

  readonly title = computed(() => {
    const clicked = this.clicked();
    return clicked
      ? this.i18n.t("combat.title", { name: clicked.name })
      : this.i18n.t("combat.titleDefault");
  });

  readonly payload = computed<Extract<CockpitAction, { type: "combat.start" }>>(() => {
    const pcs: PlayerRow[] = this.pcRows().map(({ name, path, initiative }) => ({
      name,
      path,
      initiative,
    }));
    const creatures: CreatureRow[] = this.creatureRows();
    return buildCombatStart(this.title(), pcs, creatures);
  });

  readonly canStart = computed(
    () => this.payload().participants.length > 0 && !this.busy(),
  );

  setInitiative(key: string, raw: string): void {
    this.initiatives.update((all) => ({ ...all, [key]: raw }));
  }

  toggle(cardId: string, checked: boolean): void {
    this.creatureState.update((all) => ({
      ...all,
      [cardId]: { checked, side: all[cardId]?.side ?? "enemy" },
    }));
  }

  toggleSide(cardId: string): void {
    this.creatureState.update((all) => {
      const current = all[cardId];
      const side: Side = current?.side === "ally" ? "enemy" : "ally";
      return {
        ...all,
        [cardId]: { checked: current?.checked ?? this.clicked()?.cardId === cardId, side },
      };
    });
  }

  sideLabel(side: Side): string {
    return side === "ally" ? this.i18n.t("combat.side.ally") : this.i18n.t("combat.side.enemy");
  }

  initiativeValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  checkedValue(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  async start(): Promise<void> {
    if (!this.canStart()) return;
    this.busy.set(true);
    this.error.set("");
    try {
      await this.api.action(this.payload());
    } catch {
      this.error.set(this.i18n.t("combat.error.start"));
    } finally {
      this.busy.set(false);
    }
  }
}
