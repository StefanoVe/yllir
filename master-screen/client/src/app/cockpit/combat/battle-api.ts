import { Injectable } from "@angular/core";
import type {
  BattleView,
  CombatantStats,
  CombatRules,
  LivePlayer,
} from "@shared/types";
import type { Cell } from "./combat-model";

/** Client of the battle endpoints (`/api/battle/*`). Stats are cached per combatant until its hit points change. */
@Injectable({ providedIn: "root" })
export class BattleApi {
  private readonly statsCache = new Map<
    string,
    { key: string; value: Promise<CombatantStats> }
  >();
  private rulesCache: Promise<CombatRules> | null = null;

  async players(): Promise<LivePlayer[]> {
    const value = await this.request<{ players: LivePlayer[] }>(
      "/api/battle/players",
    );
    return value.players;
  }

  battle(): Promise<BattleView | null> {
    return this.request<BattleView | null>("/api/battle");
  }

  /** Puts one combatant on a cell (or a fraction 0..1 when the map has no grid). */
  async place(combatantId: string, cell: Cell): Promise<void> {
    await this.request("/api/battle", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions: { [combatantId]: cell } }),
    });
  }

  /** `key` changes when the combatant's hit points change; a new key fetches again. */
  stats(combatantId: string, key: string): Promise<CombatantStats> {
    const cached = this.statsCache.get(combatantId);
    if (cached && cached.key === key) return cached.value;
    const value = this.request<CombatantStats>(
      `/api/battle/stats/${encodeURIComponent(combatantId)}`,
    );
    this.statsCache.set(combatantId, { key, value });
    value.catch(() => {
      if (this.statsCache.get(combatantId)?.value === value)
        this.statsCache.delete(combatantId);
    });
    return value;
  }

  /** Conditions and durations of the game system. Fetched once; a failed request is fetched again. */
  rules(): Promise<CombatRules> {
    if (!this.rulesCache) {
      const value = this.request<CombatRules>("/api/battle/rules");
      this.rulesCache = value;
      value.catch(() => {
        if (this.rulesCache === value) this.rulesCache = null;
      });
    }
    return this.rulesCache;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, { cache: "no-store", ...init });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = (payload as { error?: unknown } | null)?.error;
      throw new Error(
        typeof error === "string" ? error : `Request failed (${response.status}).`,
      );
    }
    return payload as T;
  }
}
