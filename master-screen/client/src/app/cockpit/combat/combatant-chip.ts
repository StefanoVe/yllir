import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import type { CombatantStats } from "@shared/types";
import type { Combatant } from "@shared/cockpit-types";
import { I18n } from "../../i18n";
import { BattleApi } from "./battle-api";
import { hpPercent, initials, statsKey } from "./combat-model";
import { TOOLTIP_MARGIN, placeTooltip } from "./tooltip-placement";

let nextId = 0;

/**
 * One combatant as a round token: its portrait when the sheet has artwork (initials otherwise),
 * a small hit point bar for non-player characters, and a tooltip on hover or focus. Player
 * characters show name and initiative only and never load stats; the others load their stats
 * as soon as they render, so the portrait shows without a hover.
 */
@Component({
  selector: "cockpit-combatant-chip",
  templateUrl: "./combatant-chip.html",
  styleUrl: "./combatant-chip.css",
})
export class CombatantChip {
  readonly i18n = inject(I18n);
  private readonly battle = inject(BattleApi);
  /** Five segments for the small hit point bar of a token. */
  readonly ticks = [0, 1, 2, 3, 4];
  combatant = input.required<Combatant>();
  active = input(false);
  readonly tooltipId = `combat-tip-${nextId++}`;
  /** The token button and the stats tooltip, measured to place the tooltip. */
  private readonly tokenRef = viewChild<ElementRef<HTMLButtonElement>>("token");
  private readonly tipRef = viewChild<ElementRef<HTMLElement>>("tip");
  readonly open = signal(false);
  readonly statsState = signal<"loading" | "ready" | "error">("loading");
  readonly stats = signal<CombatantStats | null>(null);
  /** Artwork that failed to load: the initials show instead. */
  readonly failedImage = signal<string | null>(null);
  readonly key = computed(() => statsKey(this.combatant()));
  readonly isPc = computed(() => this.combatant().kind === "pc");
  /** A defeated non-player character: greyed on the map. */
  readonly defeated = computed(() => !this.isPc() && this.combatant().hp === 0);
  readonly image = computed(() => (this.isPc() ? null : (this.stats()?.image ?? null)));
  readonly showImage = computed(() => {
    const src = this.image();
    return src !== null && src !== this.failedImage();
  });
  readonly initials = computed(() => initials(this.combatant().name));
  readonly hp = computed(() =>
    hpPercent(this.combatant().hp, this.combatant().maxHp),
  );
  readonly label = computed(() => {
    const c = this.combatant();
    return this.i18n.t("combat.chip.label", {
      name: c.name,
      initiative:
        c.initiative === null || c.initiative === undefined
          ? this.i18n.t("combat.chip.noInitiative")
          : String(c.initiative),
    });
  });
  private loadSeq = 0;
  private listening = false;
  private readonly onDismiss = () => this.hide();

  constructor() {
    // Loads when the chip renders and again when its hit points change; the battle API cache decides.
    effect(() => {
      const key = this.key();
      untracked(() => {
        if (key !== null) void this.loadStats();
      });
    });
    // Places the tooltip once it renders, and again whenever its content can change size.
    afterRenderEffect(() => {
      this.open();
      this.combatant();
      this.statsState();
      this.stats();
      untracked(() => this.position());
    });
    inject(DestroyRef).onDestroy(() => this.listen(false));
  }

  show(): void {
    this.open.set(true);
    this.listen(true);
    if (!this.isPc()) void this.loadStats();
  }

  hide(): void {
    this.open.set(false);
    this.listen(false);
  }

  /** Closes the tooltip on scroll (any scroll container) and on resize, as the shared tooltip does. */
  private listen(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    if (on) {
      window.addEventListener("scroll", this.onDismiss, { capture: true, passive: true });
      window.addEventListener("resize", this.onDismiss);
    } else {
      window.removeEventListener("scroll", this.onDismiss, { capture: true });
      window.removeEventListener("resize", this.onDismiss);
    }
  }

  /** Measures the token and the tooltip, then sets the tooltip position and reveals it. */
  private position(): void {
    const tip = this.tipRef()?.nativeElement;
    const token = this.tokenRef()?.nativeElement;
    if (!tip || !token) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    tip.classList.remove("placed");
    tip.style.maxWidth = `${vw - 2 * TOOLTIP_MARGIN}px`;
    tip.style.maxHeight = `${vh - 2 * TOOLTIP_MARGIN}px`;
    tip.style.left = "0px";
    tip.style.top = "0px";
    const t = tip.getBoundingClientRect();
    const h = token.getBoundingClientRect();
    const spot = placeTooltip(
      { left: h.left, top: h.top, width: h.width, height: h.height },
      { width: t.width, height: t.height },
      { width: vw, height: vh },
    );
    tip.style.left = `${spot.left}px`;
    tip.style.top = `${spot.top}px`;
    tip.dataset["side"] = spot.side;
    tip.classList.add("placed");
  }

  private async loadStats(): Promise<void> {
    const c = this.combatant();
    const key = statsKey(c);
    if (key === null) return;
    const seq = ++this.loadSeq;
    this.statsState.set("loading");
    try {
      const value = await this.battle.stats(c.id, key);
      if (seq !== this.loadSeq) return;
      this.stats.set(value);
      this.statsState.set("ready");
    } catch {
      if (seq !== this.loadSeq) return;
      this.statsState.set("error");
    }
  }
}
