import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from "@angular/core";
import type { BattleView, LivePlayer } from "@shared/types";
import type { SourceRef } from "@shared/cockpit-types";
import { Icon } from "../support/icon";
import { CockpitService } from "../cockpit.service";
import { OverlayService } from "../support/overlay.service";
import { Chat } from "../chat/chat";
import { I18n } from "../../i18n";
import { BattleApi } from "./battle-api";
import { BattleMapPrefs } from "./battle-maps-pref";
import { CombatOverlayService } from "./combat-overlay.service";
import { fightCards } from "./combat-model";
import { InitiativeStep } from "./initiative-step";
import { BattleBoard } from "./battle-board";

/**
 * Full-screen combat overlay with the table chat floating on the right. Without a combat
 * it shows the initiative step; with one, the battle view. Hosted once by the cockpit.
 */
@Component({
  selector: "cockpit-combat-overlay",
  imports: [Icon, Chat, InitiativeStep, BattleBoard],
  templateUrl: "./combat-overlay.html",
  styleUrl: "./combat-overlay.css",
})
export class CombatOverlay {
  readonly svc = inject(CombatOverlayService);
  readonly api = inject(CockpitService);
  readonly i18n = inject(I18n);
  readonly prefs = inject(BattleMapPrefs);
  private readonly battleApi = inject(BattleApi);
  private readonly overlay = inject(OverlayService);
  readonly players = signal<LivePlayer[]>([]);
  readonly battle = signal<BattleView | null>(null);
  readonly error = signal("");
  readonly chatOpen = signal(true);
  readonly combat = computed(() => this.api.session()?.state.combat ?? null);
  readonly cards = computed(() =>
    fightCards(this.api.session()?.state.board.modules ?? []),
  );
  readonly revision = computed(() => this.api.session()?.revision ?? 0);
  readonly title = computed(() => {
    const combat = this.combat();
    if (combat) return combat.title;
    const clicked = this.svc.clicked();
    return clicked
      ? this.i18n.t("combat.title", { name: clicked.name })
      : this.i18n.t("combat.titleDefault");
  });
  readonly openSource = (source: SourceRef) => {
    // The document modal lives under the overlay: close the overlay, then open the document.
    this.svc.close();
    window.dispatchEvent(new CustomEvent("cockpit-open", { detail: source }));
  };

  constructor() {
    effect(() => {
      const session = this.api.session();
      const active = !!session?.state.combat;
      untracked(() => this.svc.sync(session?.id ?? null, active));
    });
    // Opening the overlay or any cockpit state change refetches the players and the battle view.
    effect(() => {
      const open = this.svc.open();
      this.revision();
      untracked(() => {
        if (open) void this.load();
      });
    });
  }

  @HostListener("document:keydown.escape")
  escape(): void {
    if (this.svc.open() && this.overlay.isTop("combat")) this.close();
  }

  close(): void {
    this.svc.close();
  }

  async load(): Promise<void> {
    const [players, battle] = await Promise.allSettled([
      this.battleApi.players(),
      this.battleApi.battle(),
    ]);
    if (players.status === "fulfilled") this.players.set(players.value);
    if (battle.status === "fulfilled") this.battle.set(battle.value);
    this.error.set(
      players.status === "rejected" || battle.status === "rejected"
        ? this.i18n.t("combat.error.load")
        : "",
    );
  }

  async endCombat(): Promise<void> {
    if (!confirm(this.i18n.t("combat.endConfirm"))) return;
    try {
      await this.api.action({ type: "combat.end" });
    } catch {
      this.error.set(this.i18n.t("combat.error.end"));
    }
  }

  /** Asks the agent, in the campaign language, to find and set the battle map of the place. */
  async findMap(): Promise<void> {
    this.chatOpen.set(true);
    try {
      await this.api.send(this.i18n.t("combat.map.findPrompt"), crypto.randomUUID());
    } catch (error) {
      this.api.chatError.set(String(error));
    }
  }
}
