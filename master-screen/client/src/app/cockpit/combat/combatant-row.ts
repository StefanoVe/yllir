import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from "@angular/core";
import type { CombatantStats, CombatRules } from "@shared/types";
import type { Combatant } from "@shared/cockpit-types";
import { Icon } from "../support/icon";
import { CockpitService } from "../cockpit.service";
import { I18n } from "../../i18n";
import { BattleApi } from "./battle-api";
import { CombatantChip } from "./combatant-chip";
import { ConfirmButton } from "../support/confirm-button";
import {
  type Translate,
  conditionLabel,
  conditionSummary,
  hpLow,
  hpPercent,
  statsKey,
} from "./combat-model";

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

/** Rounds of a condition: a whole number of at least one, or null. */
export function parseRounds(raw: string): number | null {
  return parseAmount(raw);
}

/**
 * One combatant in list mode: the portrait (or the chip), name, initiative and, for non-player
 * characters, hit points with their bar, conditions with their duration, phase and the master's
 * quick actions (damage, heal, defeat, remove) on the main line; the stats and attacks sit in a
 * lighter block under it. Player characters never load stats.
 */
@Component({
  selector: "cockpit-combatant-row",
  imports: [Icon, CombatantChip, ConfirmButton],
  templateUrl: "./combatant-row.html",
  styleUrl: "./combatant-row.css",
})
export class CombatantRow {
  readonly i18n = inject(I18n);
  private readonly api = inject(CockpitService);
  private readonly battle = inject(BattleApi);
  combatant = input.required<Combatant>();
  active = input(false);
  /** Conditions and durations of the game system, loaded once by the overlay. */
  rules = input<CombatRules | null>(null);
  readonly statsState = signal<"loading" | "ready" | "error">("loading");
  readonly stats = signal<CombatantStats | null>(null);
  readonly amount = signal("");
  readonly error = signal("");
  readonly portraitFailed = signal<string | null>(null);
  readonly newCondition = signal("");
  readonly newDuration = signal("");
  readonly newRounds = signal(1);
  /** The add-condition controls are folded until the "+ Condition" button opens them. */
  readonly addOpen = signal(false);
  private loadSeq = 0;
  private readonly t: Translate = (key, params) => this.i18n.t(key, params);

  readonly isPc = computed(() => this.combatant().kind === "pc");
  readonly defeated = computed(
    () => !this.isPc() && this.combatant().hp === 0,
  );
  readonly amountValue = computed(() => parseAmount(this.amount()));
  /** Hit points as a percentage of the maximum, or null when unknown: the hp bar is hidden then. */
  readonly hpPct = computed(() => hpPercent(this.combatant().hp, this.combatant().maxHp));
  /** At a quarter of the maximum or below: the hp bar turns warn. */
  readonly low = computed(() => hpLow(this.combatant().hp, this.combatant().maxHp));
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
  readonly key = computed(() => statsKey(this.combatant()));
  readonly portrait = computed(() => {
    const src = this.isPc() ? null : (this.stats()?.image ?? null);
    return src !== null && src !== this.portraitFailed() ? src : null;
  });
  readonly pills = computed(() => {
    const c = this.combatant();
    const rules = this.rules();
    return c.conditions.map((id) => ({
      id,
      label: conditionLabel(id, rules),
      text: conditionSummary(
        id,
        c.conditionDetails?.find((d) => d.id === id),
        rules,
        this.t,
      ),
    }));
  });
  /**
   * The stat lines without initiative: the row already shows it on its sub-line. Matched by the
   * label in the campaign language, or by the English and Italian names.
   */
  readonly lines = computed(() => {
    const own = this.i18n.t("combat.stats.initiative").toLowerCase();
    return (this.stats()?.lines ?? []).filter((line) => {
      const label = line.label.trim().toLowerCase();
      return label !== own && label !== "initiative" && label !== "iniziativa";
    });
  });
  readonly durations = computed(() => this.rules()?.durations ?? []);
  /** Conditions the combatant does not have yet. */
  readonly addable = computed(() => {
    const have = this.combatant().conditions;
    return (this.rules()?.conditions ?? []).filter((c) => !have.includes(c.id));
  });
  readonly conditionChoice = computed(() => {
    const list = this.addable();
    const chosen = this.newCondition();
    return list.some((c) => c.id === chosen) ? chosen : (list[0]?.id ?? "");
  });
  /** The chosen duration, else until_removed when the rules have it, else the first. */
  readonly durationChoice = computed(() => {
    const list = this.durations();
    const chosen = this.newDuration();
    if (list.some((d) => d.id === chosen)) return chosen;
    return (list.find((d) => d.id === "until_removed") ?? list[0])?.id ?? "";
  });
  readonly roundsChosen = computed(() => this.durationChoice() === "rounds");

  constructor() {
    effect(() => {
      const key = this.key();
      untracked(() => {
        if (key !== null) void this.loadStats();
      });
    });
  }

  onAmount(event: Event): void {
    this.amount.set((event.target as HTMLInputElement).value);
  }

  pickCondition(event: Event): void {
    this.newCondition.set((event.target as HTMLSelectElement).value);
  }

  pickDuration(event: Event): void {
    this.newDuration.set((event.target as HTMLSelectElement).value);
  }

  pickRounds(event: Event): void {
    const rounds = parseRounds((event.target as HTMLInputElement).value);
    if (rounds !== null) this.newRounds.set(rounds);
  }

  toggleAdd(): void {
    this.addOpen.update((open) => !open);
  }

  /** Escape folds the add-condition controls. Without them open the key goes on (it closes the overlay). */
  escapeAdd(event: Event): void {
    if (!this.addOpen()) return;
    event.stopPropagation();
    this.addOpen.set(false);
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
    void this.update({ hp: 0, phase: this.i18n.t("combat.defeatedPhase") });
  }

  remove(): void {
    void this.send({ type: "combat.remove", id: this.combatant().id });
  }

  /** Adds the chosen condition; the rounds count only goes with the rounds duration. */
  addCondition(): void {
    const condition = this.conditionChoice();
    if (!condition) return;
    const duration = this.durationChoice();
    void this.send({
      type: "combat.condition",
      id: this.combatant().id,
      condition,
      ...(duration ? { duration } : {}),
      ...(duration === "rounds" ? { rounds: this.newRounds() } : {}),
    });
    this.newCondition.set("");
    this.addOpen.set(false);
  }

  removeCondition(condition: string): void {
    void this.send({
      type: "combat.condition",
      id: this.combatant().id,
      condition,
      remove: true,
    });
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
