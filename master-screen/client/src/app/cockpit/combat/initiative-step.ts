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
  byInitiative,
  initials,
  parseInitiative,
} from "./combat-model";

interface CreatureState {
  checked: boolean;
  side: Side;
}

/**
 * A copy of a creature made in this step, before the fight. It has the same sheet as its source
 * (`sourceId`, a card of the board) and its own row, tick, side and initiative under `cardId`.
 */
interface CreatureCopy {
  cardId: string;
  sourceId: string;
  name: string;
}

/** A player character typed in this step, not listed by the battle API. */
interface AdHocPc {
  key: string;
  name: string;
}

/** One line of the order preview: a ticked participant and its initiative. */
export interface OrderItem {
  key: string;
  name: string;
  kind: "pc" | Side;
  initiative: number | null;
}

/**
 * Step 1 of the combat: who takes part and in what order. Confirm sends one `combat.start`
 * action; the overlay switches to the battle view when the combat becomes active.
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
  /** Player characters the master unticked. Every other player character is ticked. */
  readonly unticked = signal<Record<string, true>>({});
  readonly creatureState = signal<Record<string, CreatureState>>({});
  readonly adHocPcs = signal<AdHocPc[]>([]);
  /** Copies of creature rows made in this step, in creation order. */
  readonly copies = signal<CreatureCopy[]>([]);
  readonly newPcName = signal("");
  readonly busy = signal(false);
  readonly error = signal("");
  readonly initials = initials;
  private adHocCount = 0;
  private copySeq = 0;

  readonly pcRows = computed(() => {
    const listed = this.players().map((p) => ({
      key: `pc:${p.ref}`,
      name: p.name,
      path: p.ref,
    }));
    const typed = this.adHocPcs().map((p) => ({ key: p.key, name: p.name, path: "" }));
    const off = this.unticked();
    const all = this.initiatives();
    return [...listed, ...typed].map((row) => ({
      ...row,
      checked: !off[row.key],
      initiative: all[row.key] ?? "",
    }));
  });

  readonly creatureRows = computed(() => {
    const clicked = this.clicked();
    const others = this.cards().filter((c) => c.cardId !== clicked?.cardId);
    const cards = clicked ? [clicked, ...others] : others;
    const state = this.creatureState();
    const initiatives = this.initiatives();
    const copies = this.copies();
    const row = (cardId: string, name: string, path: string, copy: boolean) => {
      const key = `card:${cardId}`;
      return {
        key,
        cardId,
        name,
        path,
        copy,
        checked: state[cardId]?.checked ?? cardId === clicked?.cardId,
        side: state[cardId]?.side ?? ("enemy" as Side),
        initiative: initiatives[key] ?? "",
      };
    };
    // Each copy sits right after its source, in creation order.
    return cards.flatMap((card) => [
      row(card.cardId, card.name, card.path, false),
      ...copies
        .filter((copy) => copy.sourceId === card.cardId)
        .map((copy) => row(copy.cardId, copy.name, card.path, true)),
    ]);
  });

  readonly title = computed(() => {
    const clicked = this.clicked();
    return clicked
      ? this.i18n.t("combat.title", { name: clicked.name })
      : this.i18n.t("combat.titleDefault");
  });

  readonly payload = computed<Extract<CockpitAction, { type: "combat.start" }>>(() => {
    const pcs: PlayerRow[] = this.pcRows()
      .filter((row) => row.checked)
      .map(({ name, path, initiative }) => ({ name, path, initiative }));
    const creatures: CreatureRow[] = this.creatureRows();
    return buildCombatStart(this.title(), pcs, creatures);
  });

  /** Ticked participants in initiative order, missing initiative last. */
  readonly order = computed<OrderItem[]>(() => {
    const pcs: OrderItem[] = this.pcRows()
      .filter((row) => row.checked)
      .map((row) => ({
        key: row.key,
        name: row.name,
        kind: "pc",
        initiative: parseInitiative(row.initiative),
      }));
    const creatures: OrderItem[] = this.creatureRows()
      .filter((row) => row.checked)
      .map((row) => ({
        key: row.key,
        name: row.name,
        kind: row.side,
        initiative: parseInitiative(row.initiative),
      }));
    return byInitiative([...pcs, ...creatures]);
  });

  readonly canStart = computed(
    () => this.payload().participants.length > 0 && !this.busy(),
  );

  setInitiative(key: string, raw: string): void {
    this.initiatives.update((all) => ({ ...all, [key]: raw }));
  }

  togglePc(key: string, checked: boolean): void {
    this.unticked.update((all) => {
      const next = { ...all };
      if (checked) delete next[key];
      else next[key] = true;
      return next;
    });
  }

  toggle(cardId: string, checked: boolean): void {
    this.creatureState.update((all) => ({
      ...all,
      [cardId]: { checked, side: all[cardId]?.side ?? "enemy" },
    }));
  }

  setSide(cardId: string, side: Side): void {
    this.creatureState.update((all) => ({
      ...all,
      [cardId]: { checked: all[cardId]?.checked ?? this.clicked()?.cardId === cardId, side },
    }));
  }

  /**
   * Adds a copy of a ticked creature row right after its source. The copy takes the side of the
   * row it was made from, is ticked and has no initiative. Copies of a copy count as copies of
   * the original sheet. Names are the source name with 2, 3, ... (the original keeps its name).
   */
  duplicate(cardId: string): void {
    const row = this.creatureRows().find((r) => r.cardId === cardId);
    if (!row?.checked) return;
    const sourceId = this.copies().find((c) => c.cardId === cardId)?.sourceId ?? cardId;
    const source = this.cards().find((c) => c.cardId === sourceId);
    if (!source) return;
    const existing = this.copies().filter((c) => c.sourceId === sourceId);
    let number = existing.length + 2;
    while (existing.some((c) => c.name === `${source.name} ${number}`)) number += 1;
    this.copySeq += 1;
    const copyId = `${sourceId}#${this.copySeq}`;
    this.copies.update((list) => [
      ...list,
      { cardId: copyId, sourceId, name: `${source.name} ${number}` },
    ]);
    this.creatureState.update((all) => ({
      ...all,
      [copyId]: { checked: true, side: row.side },
    }));
  }

  /** Removes a copy made by duplicate(). The original rows cannot be removed. */
  removeCopy(cardId: string): void {
    if (!this.copies().some((c) => c.cardId === cardId)) return;
    this.copies.update((list) => list.filter((c) => c.cardId !== cardId));
    this.creatureState.update((all) => {
      const next = { ...all };
      delete next[cardId];
      return next;
    });
    this.initiatives.update((all) => {
      const next = { ...all };
      delete next[`card:${cardId}`];
      return next;
    });
  }

  /** Adds a player character typed by the master. Empty names are ignored. */
  addPc(): void {
    const name = this.newPcName().trim();
    if (!name) return;
    this.adHocCount += 1;
    const key = `pc:adhoc:${this.adHocCount}`;
    this.adHocPcs.update((list) => [...list, { key, name }]);
    this.newPcName.set("");
  }

  inputValue(event: Event): string {
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
