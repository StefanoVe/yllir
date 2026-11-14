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
import { hpPercent, initials, statsKey } from "./combat-model";

let nextId = 0;

/**
 * One combatant as a round token: its portrait when the sheet has artwork (initials otherwise),
 * a small hit point bar for non-player characters, and a tooltip on hover or focus. Player
 * characters show name and initiative only and never load stats; the others load their stats
 * as soon as they render, so the portrait shows without a hover.
 */
@Component({
  selector: "cockpit-combatant-chip",
  templateUrl: "./combatant-chip.html",
  styleUrl: "./combatant-chip.css",
})
export class CombatantChip {
  readonly i18n = inject(I18n);
  private readonly battle = inject(BattleApi);
  /** Five segments for the small hit point bar of a token. */
  readonly ticks = [0, 1, 2, 3, 4];
  combatant = input.required<Combatant>();
  active = input(false);
  readonly tooltipId = `combat-tip-${nextId++}`;
  readonly open = signal(false);
  readonly statsState = signal<"loading" | "ready" | "error">("loading");
  readonly stats = signal<CombatantStats | null>(null);
  /** Artwork that failed to load: the initials show instead. */
  readonly failedImage = signal<string | null>(null);
  readonly key = computed(() => statsKey(this.combatant()));
  readonly isPc = computed(() => this.combatant().kind === "pc");
  /** A defeated non-player character: greyed on the map. */
  readonly defeated = computed(() => !this.isPc() && this.combatant().hp === 0);
  readonly image = computed(() => (this.isPc() ? null : (this.stats()?.image ?? null)));
  readonly showImage = computed(() => {
    const src = this.image();
    return src !== null && src !== this.failedImage();
  });
  readonly initials = computed(() => initials(this.combatant().name));
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
  private loadSeq = 0;

  constructor() {
    // Loads when the chip renders and again when its hit points change; the battle API cache decides.
    effect(() => {
      const key = this.key();
      untracked(() => {
        if (key !== null) void this.loadStats();
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
    const key = statsKey(c);
    if (key === null) return;
    const seq = ++this.loadSeq;
    this.statsState.set("loading");
    try {
      const value = await this.battle.stats(c.id, key);
      if (seq !== this.loadSeq) return;
      this.stats.set(value);
      this.statsState.set("ready");
    } catch {
      if (seq !== this.loadSeq) return;
      this.statsState.set("error");
    }
  }
}
