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
import type { CombatantStats } from "@shared/types";
import type { Combatant } from "@shared/cockpit-types";
import { I18n } from "../../i18n";
import { BattleApi } from "./battle-api";
import { groupActions, hpLow, hpPercent, initials, statsKey } from "./combat-model";

type Status = "loading" | "ready" | "error";

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

/**
 * What can be done now: the actions of the combatant whose turn it is, and the reactions and
 * other actions the others can take out of turn. Stats come from the battle API, so the cache
 * is shared with the chips and rows; player characters are never loaded. On narrow screens the
 * out-of-turn block starts folded.
 */
@Component({
  selector: "cockpit-turn-panel",
  templateUrl: "./turn-panel.html",
  styleUrl: "./turn-panel.css",
})
export class TurnPanel {
  readonly i18n = inject(I18n);
  private readonly battle = inject(BattleApi);
  combatants = input.required<Combatant[]>();
  activeId = input<string | null>(null);
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
      return { ...face, pc: true, status: "ready" as Status, groups: [] };
    const entry = this.entries()[a.id];
    const status: Status = entry?.status ?? "loading";
    const own = (entry?.stats?.actions ?? []).filter((x) => x.timing === "own_turn");
    return {
      ...face,
      pc: false,
      status,
      groups: groupActions(status === "ready" ? own : []),
    };
  });

  /** Everyone else who is not defeated, with their out-of-turn actions; those with none are left out once loaded. */
  readonly others = computed(() => {
    const activeId = this.activeId();
    return this.combatants()
      .filter((c) => c.kind !== "pc" && c.id !== activeId && c.hp !== 0)
      .map((c) => {
        const entry = this.entries()[c.id];
        const status: Status = entry?.status ?? "loading";
        const outOfTurn = (entry?.stats?.actions ?? []).filter(
          (x) => x.timing === "any_turn" || x.timing === "others_turns",
        );
        return {
          id: c.id,
          ...this.face(c),
          status,
          groups: groupActions(status === "ready" ? outOfTurn : []),
        };
      })
      .filter((o) => o.status !== "ready" || o.groups.length > 0);
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
      untracked(() => {
        for (const c of list) this.ensure(c);
      });
    });
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

  private ensure(c: Combatant): void {
    const key = statsKey(c);
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
