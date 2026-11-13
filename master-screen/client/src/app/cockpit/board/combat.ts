import { Component, computed, inject, input, output } from "@angular/core";
import { Icon } from "../support/icon";
import { ConfirmButton } from "../support/confirm-button";
import { I18n } from "../../i18n";
import type { Combat, CockpitAction } from "@shared/cockpit-types";
export function nextCombatTurn(combat: Combat) {
  const sorted = [...combat.participants].sort(
    (a, b) => (b.initiative ?? -999) - (a.initiative ?? -999),
  );
  const next = sorted.findIndex((p) => p.id === combat.activeId) + 1;
  return {
    activeId: sorted[next % Math.max(sorted.length, 1)]?.id || null,
    round: next >= sorted.length ? combat.round + 1 : combat.round,
  };
}
@Component({
  selector: "cockpit-combat",
  standalone: true,
  imports: [Icon, ConfirmButton],
  templateUrl: "./combat.html",
  styleUrl: "./combat.css",
})
export class CombatView {
  combat = input.required<Combat>();
  readonly i18n = inject(I18n);
  action = output<CockpitAction>();
  hasConditions = computed(() =>
    this.combat().participants.some((p) => p.conditions.length),
  );
  hasPhases = computed(() => this.combat().participants.some((p) => p.phase));
  next() {
    this.action.emit({ type: "combat.turn", ...nextCombatTurn(this.combat()) });
  }
  end() {
    this.action.emit({ type: "combat.end" });
  }
}
