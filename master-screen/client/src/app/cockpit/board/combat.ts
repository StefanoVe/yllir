import { Component, computed, inject, input, output } from "@angular/core";
import { Icon } from "../support/icon";
import { ConfirmButton } from "../support/confirm-button";
import { I18n } from "../../i18n";
import { TooltipDirective } from "../../core/tooltip.directive";
import type { Combat, Combatant, CockpitAction } from "@shared/cockpit-types";

/** Hit points are drawn as this many segments. */
export const HP_SEGMENTS = 10;

/** One condition on a row: its name and its duration as shown ("2 t"), empty when unknown. */
export interface ConditionTag {
  label: string;
  duration: string;
}

/** Filled segments of the hit point bar: true for a segment that is still filled. */
export function hpSegments(p: Combatant): boolean[] {
  if (!p.maxHp || p.hp === undefined) return [];
  const ratio = Math.min(Math.max(p.hp / p.maxHp, 0), 1);
  const filled = Math.round(ratio * HP_SEGMENTS);
  return Array.from({ length: HP_SEGMENTS }, (_, i) => i < filled);
}

/** Extra outlined segments for temporary hit points. */
export function tempSegments(p: Combatant): number[] {
  if (!p.maxHp || !p.tempHp) return [];
  const count = Math.min(
    HP_SEGMENTS,
    Math.max(1, Math.ceil((p.tempHp / p.maxHp) * HP_SEGMENTS)),
  );
  return Array.from({ length: count }, (_, i) => i);
}

export function conditionTags(p: Combatant): ConditionTag[] {
  return p.conditions.map((label) => {
    const detail = p.conditionDetails?.find((d) => d.id === label);
    const duration =
      detail?.rounds !== undefined
        ? `${detail.rounds} t`
        : (detail?.duration ?? "");
    return { label, duration };
  });
}

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
  imports: [Icon, ConfirmButton, TooltipDirective],
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
  readonly hpSegments = hpSegments;
  readonly tempSegments = tempSegments;
  readonly conditionTags = conditionTags;
  /** Down: at zero hit points. Shown struck through with a cross. */
  isDown(p: Combatant) {
    return p.hp === 0;
  }
  next() {
    this.action.emit({ type: "combat.turn", ...nextCombatTurn(this.combat()) });
  }
  end() {
    this.action.emit({ type: "combat.end" });
  }
}
