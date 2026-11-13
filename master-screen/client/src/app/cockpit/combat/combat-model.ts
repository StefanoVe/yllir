import type { BattleView } from "@shared/types";
import type {
  BoardModuleView,
  CockpitAction,
  Combatant,
} from "@shared/cockpit-types";

/** A character or creature card on the board that can take part in a fight. */
export interface FightCard {
  cardId: string;
  name: string;
  path: string;
  kind: "npc" | "enemy";
}

export type Side = "enemy" | "ally";

export interface PlayerRow {
  name: string;
  path: string;
  initiative: string;
}

export interface CreatureRow {
  cardId: string;
  name: string;
  path: string;
  checked: boolean;
  side: Side;
  initiative: string;
}

export interface Grid {
  cols: number;
  rows: number;
}

export interface Cell {
  x: number;
  y: number;
}

/** Board cards that are characters or creatures with a sheet. */
export function fightCards(modules: BoardModuleView[]): FightCard[] {
  return modules
    .filter(
      (m) =>
        (m.kind === "npc" || m.kind === "enemy") && m.ref.type === "doc",
    )
    .map((m) => ({
      cardId: m.id,
      name: m.content.title,
      path: m.ref.type === "doc" ? m.ref.path : "",
      kind: m.kind as "npc" | "enemy",
    }));
}

/** Empty means "not rolled yet" (null). Accepts a decimal comma. */
export function parseInitiative(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function participant(
  name: string,
  kind: "pc" | Side,
  path: string,
  initiative: string,
): Omit<Combatant, "id"> {
  return {
    name,
    kind,
    initiative: parseInitiative(initiative),
    conditions: [],
    ...(path ? { source: { path } } : {}),
  };
}

/** The one cockpit action that starts a combat: player characters first, then the ticked creatures. */
export function buildCombatStart(
  title: string,
  players: PlayerRow[],
  creatures: CreatureRow[],
): Extract<CockpitAction, { type: "combat.start" }> {
  return {
    type: "combat.start",
    title,
    participants: [
      ...players.map((p) => participant(p.name, "pc", p.path, p.initiative)),
      ...creatures
        .filter((c) => c.checked)
        .map((c) => participant(c.name, c.side, c.path, c.initiative)),
    ],
  };
}

/** Initiative order: highest first, not rolled last, ties keep their order. */
export function byInitiative<T extends { initiative: number | null }>(
  list: T[],
): T[] {
  const rank = (item: T) => item.initiative ?? -Infinity;
  return [...list].sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    if (x === y) return 0;
    return x < y ? 1 : -1;
  });
}

/**
 * The next combatant to take the turn, in initiative order: the first one after the active
 * combatant, wrapping around. Defeated non-player characters are skipped. Without an active
 * combatant it is the first one. Null when nobody can take the turn.
 */
export function nextTurnId(
  participants: Combatant[],
  activeId: string | null,
): string | null {
  const order = byInitiative(participants);
  const count = order.length;
  if (count === 0) return null;
  const index = activeId === null ? -1 : order.findIndex((c) => c.id === activeId);
  for (let step = 1; step <= count; step++) {
    const candidate = order[(index + step) % count]!;
    if (candidate.kind !== "pc" && candidate.hp === 0) continue;
    return candidate.id;
  }
  return null;
}

/** Up to two letters for a token: first letters of the first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
}

export function gridOf(map: BattleView["map"] | undefined): Grid | null {
  return map?.cols && map?.rows ? { cols: map.cols, rows: map.rows } : null;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Maps a point given as fractions (0..1) of the map to a cell, or to a fraction when there is no grid. */
export function cellAt(fx: number, fy: number, grid: Grid | null): Cell {
  if (grid) {
    return {
      x: clamp(Math.floor(fx * grid.cols), 0, grid.cols - 1),
      y: clamp(Math.floor(fy * grid.rows), 0, grid.rows - 1),
    };
  }
  return {
    x: Math.round(clamp(fx, 0, 1) * 1000) / 1000,
    y: Math.round(clamp(fy, 0, 1) * 1000) / 1000,
  };
}

/** Centre of a placed chip, in percent of the map. */
export function percentAt(
  cell: Cell,
  grid: Grid | null,
): { left: number; top: number } {
  if (grid) {
    return {
      left: ((cell.x + 0.5) / grid.cols) * 100,
      top: ((cell.y + 0.5) / grid.rows) * 100,
    };
  }
  return { left: cell.x * 100, top: cell.y * 100 };
}

/** Arrow key moves one cell; only when the map has a grid. Null when the key does nothing. */
export function stepCell(
  cell: Cell,
  key: string,
  grid: Grid | null,
): Cell | null {
  if (!grid) return null;
  const delta: Record<string, Cell> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
  };
  const step = delta[key];
  if (!step) return null;
  return {
    x: clamp(cell.x + step.x, 0, grid.cols - 1),
    y: clamp(cell.y + step.y, 0, grid.rows - 1),
  };
}

/** Hit points as a percentage of the maximum, or null when they are not known. */
export function hpPercent(hp?: number, maxHp?: number): number | null {
  if (hp === undefined || !maxHp || maxHp <= 0) return null;
  return clamp(Math.round((hp / maxHp) * 100), 0, 100);
}
