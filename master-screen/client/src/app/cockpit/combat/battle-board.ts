import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import type { BattleView, CombatRules } from "@shared/types";
import type { Combatant } from "@shared/cockpit-types";
import { Icon } from "../support/icon";
import { DocumentsService } from "../support/documents.service";
import { I18n } from "../../i18n";
import { CombatantChip } from "./combatant-chip";
import { CombatantRow } from "./combatant-row";
import {
  type Cell,
  type Grid,
  byInitiative,
  cellAt,
  gridOf,
  initials,
  percentAt,
  stepCell,
} from "./combat-model";
import { BattleApi } from "./battle-api";

interface Drag {
  id: string;
  cx: number;
  cy: number;
  cell: Cell | null;
}

let nextBoardId = 0;

/**
 * The inner grid lines of a map as one SVG path, in a viewBox of one unit per cell. The lines
 * sit on the cell borders; the outer frame is the map's own border, so it is not drawn.
 */
export function gridLinesOf(grid: Grid): { viewBox: string; d: string } {
  const parts: string[] = [];
  for (let x = 1; x < grid.cols; x++) parts.push(`M${x} 0V${grid.rows}`);
  for (let y = 1; y < grid.rows; y++) parts.push(`M0 ${y}H${grid.cols}`);
  return { viewBox: `0 0 ${grid.cols} ${grid.rows}`, d: parts.join(" ") };
}

/**
 * The battle view: the battle map with a grid and draggable chips, filling its host, or the
 * combatants in initiative order when there is no map or the preference is off. The turn and
 * the other floating panels are the overlay's. Chips move by drag and drop or with the arrow
 * keys (grid only); every move is saved with PUT /api/battle.
 */
@Component({
  selector: "cockpit-battle-board",
  imports: [Icon, CombatantChip, CombatantRow],
  templateUrl: "./battle-board.html",
  styleUrl: "./battle-board.css",
})
export class BattleBoard {
  readonly i18n = inject(I18n);
  private readonly api = inject(BattleApi);
  private readonly documents = inject(DocumentsService);
  combatants = input.required<Combatant[]>();
  battle = input<BattleView | null>(null);
  showMaps = input(true);
  activeId = input<string | null>(null);
  rules = input<CombatRules | null>(null);
  findMap = output<void>();
  readonly positions = signal<Record<string, Cell>>({});
  readonly moveError = signal("");
  readonly drag = signal<Drag | null>(null);
  private readonly mapFrame = viewChild<ElementRef<HTMLElement>>("mapFrame");
  /** Id of the visually hidden text that describes how to move the chips. */
  readonly keysId = `battle-map-keys-${nextBoardId++}`;
  /** Width over height of the loaded map image, once it has loaded. */
  readonly mapRatio = signal<number | null>(null);

  readonly hasMap = computed(() => !!this.battle()?.map?.ref && this.showMaps());
  readonly grid = computed(() => gridOf(this.battle()?.map));
  /** The grid lines as one path in a viewBox of cells; null when the map has no grid. */
  readonly gridLines = computed(() => {
    const g = this.grid();
    return g ? gridLinesOf(g) : null;
  });
  /**
   * The aspect ratio the map box takes: the image's own once it has loaded, else the grid's
   * columns over rows. Empty means no ratio is known yet, and the stylesheet's fallback applies.
   */
  readonly ratioCss = computed(() => {
    const ratio = this.mapRatio();
    if (ratio) return String(ratio);
    const grid = this.grid();
    return grid ? String(grid.cols / grid.rows) : "";
  });
  readonly mapUrl = computed(() => {
    const map = this.battle()?.map;
    const ref = map?.plain ?? map?.ref;
    return ref ? this.documents.asset(ref) : "";
  });
  readonly placed = computed(() =>
    this.combatants().filter((c) => this.positions()[c.id]),
  );
  readonly tray = computed(() =>
    this.combatants().filter((c) => !this.positions()[c.id]),
  );
  readonly ordered = computed(() => byInitiative(this.combatants()));
  readonly dragged = computed(() => {
    const d = this.drag();
    return d ? this.combatants().find((c) => c.id === d.id) ?? null : null;
  });

  constructor() {
    // The server's positions replace the local copy whenever a new battle view arrives.
    effect(() => {
      const battle = this.battle();
      untracked(() => this.positions.set({ ...(battle?.positions ?? {}) }));
    });
  }

  percent(cell: Cell) {
    return percentAt(cell, this.grid());
  }

  /** Remembers the image's own proportions, so the map box keeps them at any size. */
  onMapLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.naturalWidth > 0 && img.naturalHeight > 0)
      this.mapRatio.set(img.naturalWidth / img.naturalHeight);
  }

  sideOf(c: Combatant): string {
    return c.kind;
  }

  ghostInitials(c: Combatant): string {
    return initials(c.name);
  }

  pointerDown(event: PointerEvent, c: Combatant): void {
    if (!this.hasMap() || event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
    this.drag.set({
      id: c.id,
      cx: event.clientX,
      cy: event.clientY,
      cell: this.cellFor(event.clientX, event.clientY),
    });
  }

  pointerMove(event: PointerEvent): void {
    const d = this.drag();
    if (!d) return;
    this.drag.set({
      ...d,
      cx: event.clientX,
      cy: event.clientY,
      cell: this.cellFor(event.clientX, event.clientY),
    });
  }

  pointerUp(): void {
    const d = this.drag();
    this.drag.set(null);
    if (d?.cell) void this.place(d.id, d.cell);
  }

  pointerCancel(): void {
    this.drag.set(null);
  }

  key(event: KeyboardEvent, c: Combatant): void {
    const current = this.positions()[c.id];
    if (!current) return;
    const next = stepCell(current, event.key, this.grid());
    if (!next) return;
    event.preventDefault();
    void this.place(c.id, next);
  }

  /** Saves one move. The chip moves at once and goes back when the server refuses. */
  async place(id: string, cell: Cell): Promise<void> {
    const previous = this.positions()[id];
    if (previous && previous.x === cell.x && previous.y === cell.y) return;
    this.positions.update((all) => ({ ...all, [id]: cell }));
    this.moveError.set("");
    try {
      await this.api.place(id, cell);
    } catch {
      this.positions.update((all) => {
        const next = { ...all };
        if (previous) next[id] = previous;
        else delete next[id];
        return next;
      });
      this.moveError.set(this.i18n.t("combat.error.move"));
    }
  }

  private cellFor(clientX: number, clientY: number): Cell | null {
    const el = this.mapFrame()?.nativeElement;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    return cellAt(fx, fy, this.grid());
  }
}
