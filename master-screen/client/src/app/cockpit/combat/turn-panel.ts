import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import type { ActionCard, CardAction, CombatantStats } from "@shared/types";
import type { Combatant } from "@shared/cockpit-types";
import { I18n, type TranslationKey } from "../../i18n";
import { BattleApi } from "./battle-api";
import {
  cardGroups,
  groupActions,
  hpLow,
  hpPercent,
  initials,
  statsKey,
  type ActionGroup,
} from "./combat-model";

type Status = "loading" | "ready" | "error";
type ParserAction = CombatantStats["actions"][number];
type Timing = CardAction["timing"];

interface StatsEntry {
  status: Status;
  stats: CombatantStats | null;
}

/** The portrait, name and hit points of a combatant as the panel shows them. */
interface Face {
  name: string;
  initials: string;
  image: string | null;
  hp?: number;
  maxHp?: number;
  hpPct: number | null;
  low: boolean;
  hpLabel: string;
}

/** A group of the action card, by cost, with its label in the campaign language. */
interface CostGroup {
  cost: CardAction["cost"];
  label: string;
  actions: CardAction[];
}

/**
 * What a combatant can do at one moment: the action card when the agent wrote one (`hasCard`),
 * otherwise the deterministic parser actions (`basic`). `pending` while the card is being written.
 */
interface Read {
  status: Status;
  pending: boolean;
  hasCard: boolean;
  basic: boolean;
  cardGroups: CostGroup[];
  groups: ActionGroup<ParserAction>[];
  traits: Array<{ name: string; text: string }>;
}

const COST_KEYS: Record<CardAction["cost"], TranslationKey> = {
  action: "combat.cost.action",
  bonus: "combat.cost.bonus",
  movement: "combat.cost.movement",
  free: "combat.cost.free",
  reaction: "combat.cost.reaction",
  legendary: "combat.cost.legendary",
};

/**
 * What can be done now: the actions of the combatant whose turn it is, and the reactions and
 * other actions the others can take out of turn. The action card (written by the agent from the
 * sheet) is shown when it exists; the parser actions are the basic fallback while it is pending
 * or missing. Stats come from the battle API, so the cache is shared with the chips and rows;
 * player characters are never loaded. On narrow screens the out-of-turn block starts folded.
 */
@Component({
  selector: "cockpit-turn-panel",
  imports: [NgTemplateOutlet],
  templateUrl: "./turn-panel.html",
  styleUrl: "./turn-panel.css",
})
export class TurnPanel {
  readonly i18n = inject(I18n);
  private readonly battle = inject(BattleApi);
  combatants = input.required<Combatant[]>();
  activeId = input<string | null>(null);
  /** Combatants whose sheet is being interpreted into an action card right now. */
  pending = input<readonly string[]>([]);
  readonly entries = signal<Record<string, StatsEntry>>({});
  /** The key of the stats last asked for each combatant: an answer for an older key is dropped. */
  private readonly requested = new Map<string, string>();
  /** Portrait that failed to load: the initials show instead. */
  readonly failed = signal<string | null>(null);
  /** Whether the screen is wide enough for the out-of-turn block to start open. */
  readonly wide = signal(true);

  readonly active = computed(
    () => this.combatants().find((c) => c.id === this.activeId()) ?? null,
  );

  /** The active combatant: its own-turn actions, or nothing for a player character. */
  readonly now = computed(() => {
    const a = this.active();
    if (!a) return null;
    const face = this.face(a);
    if (a.kind === "pc")
      return {
        ...face,
        pc: true,
        status: "ready" as Status,
        pending: false,
        hasCard: false,
        basic: false,
        cardGroups: [] as CostGroup[],
        groups: [] as ActionGroup<ParserAction>[],
        traits: [] as Array<{ name: string; text: string }>,
      };
    return { ...face, pc: false, ...this.read(a, ["own_turn"]) };
  });

  /** Everyone else who is not defeated, with their out-of-turn actions; those with none are left out once loaded. */
  readonly others = computed(() => {
    const activeId = this.activeId();
    return this.combatants()
      .filter((c) => c.kind !== "pc" && c.id !== activeId && c.hp !== 0)
      .map((c) => ({
        id: c.id,
        ...this.face(c),
        ...this.read(c, ["any_turn", "others_turns"]),
      }))
      .filter(
        (o) =>
          o.status !== "ready" ||
          o.groups.length > 0 ||
          o.cardGroups.length > 0 ||
          (o.pending && !o.hasCard),
      );
  });

  constructor() {
    const query =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(min-width: 900px)")
        : null;
    if (query) {
      this.wide.set(query.matches);
      const onChange = (event: MediaQueryListEvent) => this.wide.set(event.matches);
      query.addEventListener("change", onChange);
      inject(DestroyRef).onDestroy(() => query.removeEventListener("change", onChange));
    }
    effect(() => {
      const list = this.combatants();
      const pending = this.pending();
      untracked(() => {
        for (const c of list) this.ensure(c, pending.includes(c.id));
      });
    });
  }

  /** Label of an action cost group in the campaign language. */
  costLabel(cost: CardAction["cost"]): string {
    return this.i18n.t(COST_KEYS[cost]);
  }

  /** To-hit bonus with its sign always shown, e.g. "+5 to hit". */
  toHitLabel(bonus: number): string {
    const value = bonus >= 0 ? `+${bonus}` : `${bonus}`;
    return this.i18n.t("combat.card.toHit", { value });
  }

  saveLabel(save: NonNullable<CardAction["save"]>): string {
    return this.i18n.t("combat.card.save", { ability: save.ability, dc: save.dc });
  }

  /** The save chip's tooltip: the save, then what happens on a success when the card says so. */
  saveTitle(save: NonNullable<CardAction["save"]>): string {
    const label = this.saveLabel(save);
    if (!save.onSuccess) return label;
    return `${label}. ${this.i18n.t("combat.card.onSuccess", { text: save.onSuccess })}`;
  }

  rechargeLabel(recharge: string): string {
    return this.i18n.t("combat.card.recharge", { n: recharge });
  }

  triggerLabel(trigger: string): string {
    return this.i18n.t("combat.card.trigger", { text: trigger });
  }

  /** Name, portrait (from the stats already loaded for the panel) and hit points of a combatant. */
  private face(c: Combatant): Face {
    const image = c.kind === "pc" ? null : (this.entries()[c.id]?.stats?.image ?? null);
    const failed = this.failed();
    return {
      name: c.name,
      initials: initials(c.name),
      image: image !== null && image !== failed ? image : null,
      hp: c.hp,
      maxHp: c.maxHp,
      hpPct: hpPercent(c.hp, c.maxHp),
      low: hpLow(c.hp, c.maxHp),
      hpLabel: this.i18n.t("combat.chip.hp", { hp: c.hp ?? "—", max: c.maxHp ?? "—" }),
    };
  }

  /**
   * The card of a combatant for the given timings when one is ready, else the parser actions
   * with those timings. Nothing is shown while the stats load.
   */
  private read(c: Combatant, timings: Timing[]): Read {
    const entry = this.entries()[c.id];
    const status: Status = entry?.status ?? "loading";
    const stats = status === "ready" ? (entry?.stats ?? null) : null;
    const pending = this.pending().includes(c.id);
    const card: ActionCard | null =
      stats?.source === "agent" && stats.card ? stats.card : null;
    if (card) {
      return {
        status,
        pending,
        hasCard: true,
        basic: false,
        cardGroups: cardGroups(card, timings).map((group) => ({
          ...group,
          label: this.costLabel(group.cost),
        })),
        groups: [],
        traits: card.traits ?? [],
      };
    }
    const parser = (stats?.actions ?? []).filter((x) => timings.includes(x.timing));
    return {
      status,
      pending,
      hasCard: false,
      basic: status === "ready",
      cardGroups: [],
      groups: groupActions(parser),
      traits: [],
    };
  }

  private ensure(c: Combatant, pending: boolean): void {
    const key = statsKey(c, pending);
    if (key === null || this.requested.get(c.id) === key) return;
    this.requested.set(c.id, key);
    const previous = this.entries()[c.id];
    this.put(c.id, { status: "loading", stats: previous?.stats ?? null });
    this.battle.stats(c.id, key).then(
      (stats) => {
        if (this.requested.get(c.id) === key) this.put(c.id, { status: "ready", stats });
      },
      () => {
        if (this.requested.get(c.id) === key) this.put(c.id, { status: "error", stats: null });
      },
    );
  }

  private put(id: string, entry: StatsEntry): void {
    this.entries.update((all) => ({ ...all, [id]: entry }));
  }
}
