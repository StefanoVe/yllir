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
import { Icon } from "../support/icon";
import { CockpitService } from "../cockpit.service";
import { I18n } from "../../i18n";
import { BattleApi } from "./battle-api";
import { CombatantChip } from "./combatant-chip";

/** Hit points after damage: never below zero. */
export function hpAfterDamage(hp: number, amount: number): number {
  return Math.max(0, hp - amount);
}

/** Hit points after healing: never above the maximum, when there is one. */
export function hpAfterHeal(hp: number, amount: number, maxHp?: number): number {
  return Math.min(hp + amount, maxHp ?? Infinity);
}

/** A whole amount of at least one, or null for anything else (empty, zero, text). */
export function parseAmount(raw: string): number | null {
  const value = Math.floor(Number(raw.trim().replace(",", ".")));
  return Number.isFinite(value) && value >= 1 ? value : null;
}

/**
 * One combatant in list mode: the chip, name, initiative and, for non-player characters,
 * hit points, conditions, phase, the stats and attacks always visible, and the master's
 * quick actions (damage, heal, defeat, remove). Player characters never load stats.
 */
@Component({
  selector: "cockpit-combatant-row",
  imports: [Icon, CombatantChip],
  templateUrl: "./combatant-row.html",
  styleUrl: "./combatant-row.css",
})
export class CombatantRow {
  readonly i18n = inject(I18n);
  private readonly api = inject(CockpitService);
  private readonly battle = inject(BattleApi);
  combatant = input.required<Combatant>();
  active = input(false);
  readonly statsState = signal<"loading" | "ready" | "error">("loading");
  readonly stats = signal<CombatantStats | null>(null);
  readonly amount = signal("");
  readonly error = signal("");
  private loadSeq = 0;

  readonly isPc = computed(() => this.combatant().kind === "pc");
  readonly defeated = computed(
    () => !this.isPc() && this.combatant().hp === 0,
  );
  readonly amountValue = computed(() => parseAmount(this.amount()));
  readonly canChangeHp = computed(
    () => this.combatant().hp !== undefined && this.amountValue() !== null,
  );
  readonly hpText = computed(() => {
    const c = this.combatant();
    const base = this.i18n.t("combat.chip.hp", {
      hp: c.hp ?? "—",
      max: c.maxHp ?? "—",
    });
    return c.tempHp ? `${base} +${c.tempHp}` : base;
  });
  /** Stats are cached by the battle API per key: the key changes with the hit points. */
  readonly statsKey = computed(() => {
    const c = this.combatant();
    return c.kind === "pc"
      ? null
      : `${c.hp ?? ""}/${c.maxHp ?? ""}/${c.tempHp ?? ""}`;
  });

  constructor() {
    effect(() => {
      const key = this.statsKey();
      untracked(() => {
        if (key !== null) void this.loadStats();
      });
    });
  }

  onAmount(event: Event): void {
    this.amount.set((event.target as HTMLInputElement).value);
  }

  damage(): void {
    const n = this.amountValue();
    const c = this.combatant();
    if (n === null || c.hp === undefined) return;
    void this.update({ hp: hpAfterDamage(c.hp, n) });
  }

  heal(): void {
    const n = this.amountValue();
    const c = this.combatant();
    if (n === null || c.hp === undefined) return;
    void this.update({ hp: hpAfterHeal(c.hp, n, c.maxHp) });
  }

  defeat(): void {
    const c = this.combatant();
    if (!confirm(this.i18n.t("combat.defeatConfirm", { name: c.name }))) return;
    void this.update({ hp: 0, phase: this.i18n.t("combat.defeatedPhase") });
  }

  remove(): void {
    const c = this.combatant();
    if (!confirm(this.i18n.t("combat.removeConfirm", { name: c.name }))) return;
    void this.send({ type: "combat.remove", id: c.id });
  }

  private update(patch: { hp?: number; phase?: string }): Promise<void> {
    return this.send({ type: "combat.update", id: this.combatant().id, patch });
  }

  private async send(
    action: Parameters<CockpitService["action"]>[0],
  ): Promise<void> {
    this.error.set("");
    try {
      await this.api.action(action);
    } catch {
      this.error.set(this.i18n.t("combat.error.update"));
    }
  }

  private async loadStats(): Promise<void> {
    const c = this.combatant();
    const seq = ++this.loadSeq;
    this.statsState.set("loading");
    try {
      const value = await this.battle.stats(
        c.id,
        `${c.hp ?? ""}/${c.maxHp ?? ""}/${c.tempHp ?? ""}`,
      );
      if (seq !== this.loadSeq) return;
      this.stats.set(value);
      this.statsState.set("ready");
    } catch {
      if (seq !== this.loadSeq) return;
      this.statsState.set("error");
    }
  }
}
