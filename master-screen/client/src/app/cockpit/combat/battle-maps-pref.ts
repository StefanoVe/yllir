import { Injectable, computed, inject } from "@angular/core";
import { SettingsService } from "../../core/settings.service";

export const SHOW_BATTLE_MAPS_KEY = "showBattleMaps";

/** Missing preference means on. */
export function readShowBattleMaps(raw: string | null): boolean {
  return raw !== "false";
}

/** The "show battle maps" setting of this campaign (combat.showMaps in the settings). Default on. */
@Injectable({ providedIn: "root" })
export class BattleMapPrefs {
  private readonly settings = inject(SettingsService);
  readonly showMaps = computed(() => this.settings.settings().combat.showMaps);

  set(on: boolean): void {
    this.settings.update({ combat: { showMaps: on } });
  }
}
