import { Injectable, computed, inject, signal } from "@angular/core";
import { PrefsService } from "../../core/prefs.service";

export const SHOW_BATTLE_MAPS_KEY = "showBattleMaps";

/** Missing preference means on. */
export function readShowBattleMaps(raw: string | null): boolean {
  return raw !== "false";
}

/** The "show battle maps" preference of this campaign (Settings). Default on. */
@Injectable({ providedIn: "root" })
export class BattleMapPrefs {
  private readonly prefs = inject(PrefsService);
  private readonly version = signal(0);
  readonly showMaps = computed(() => {
    this.prefs.slug();
    this.version();
    return readShowBattleMaps(this.prefs.get(SHOW_BATTLE_MAPS_KEY));
  });

  set(on: boolean): void {
    this.prefs.set(SHOW_BATTLE_MAPS_KEY, on ? "true" : "false");
    this.version.update((value) => value + 1);
  }
}
