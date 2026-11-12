import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from "@angular/core";
import type { CombatantStats } from "@shared/types";
import type { Combatant } from "@shared/cockpit-types";
import { I18n } from "../../i18n";
import { BattleApi } from "./battle-api";
import { hpPercent, initials } from "./combat-model";

let nextId = 0;

/**
 * One combatant as a round token: initials, a small hit point bar for non-player
 * characters, and a tooltip on hover or focus. Player characters show name and
 * initiative only; the others load their stats from the battle endpoints.
 */
@Component({
  selector: "cockpit-combatant-chip",
  templateUrl: "./combatant-chip.html",
  styleUrl: "./combatant-chip.css",
})
export class CombatantChip {
  readonly i18n = inject(I18n);
  private readonly battle = inject(BattleApi);
  combatant = input.required<Combatant>();
  active = input(false);
  readonly tooltipId = `combat-tip-${nextId++}`;
  readonly open = signal(false);
  readonly statsState = signal<"loading" | "ready" | "error">("loading");
  readonly stats = signal<CombatantStats | null>(null);
  readonly initials = computed(() => initials(this.combatant().name));
  readonly isPc = computed(() => this.combatant().kind === "pc");
  readonly hp = computed(() =>
    hpPercent(this.combatant().hp, this.combatant().maxHp),
  );
  readonly label = computed(() => {
    const c = this.combatant();
    return this.i18n.t("combat.chip.label", {
      name: c.name,
      initiative:
        c.initiative === null || c.initiative === undefined
          ? this.i18n.t("combat.chip.noInitiative")
          : String(c.initiative),
    });
  });

  constructor() {
    // Hit points changed while the tooltip is open: fetch again (the cache decides).
    effect(() => {
      const c = this.combatant();
      void c.hp;
      untracked(() => {
        if (this.open() && !this.isPc()) void this.loadStats();
      });
    });
  }

  show(): void {
    this.open.set(true);
    if (!this.isPc()) void this.loadStats();
  }

  hide(): void {
    this.open.set(false);
  }

  private async loadStats(): Promise<void> {
    const c = this.combatant();
    this.statsState.set("loading");
    try {
      const value = await this.battle.stats(
        c.id,
        `${c.hp ?? ""}/${c.maxHp ?? ""}`,
      );
      this.stats.set(value);
      this.statsState.set("ready");
    } catch {
      this.statsState.set("error");
    }
  }
}
