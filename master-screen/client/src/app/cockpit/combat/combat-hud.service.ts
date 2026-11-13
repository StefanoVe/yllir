import { DestroyRef, Injectable, computed, inject, signal } from "@angular/core";

/** The panels that float over the battle map. */
export type HudPanel = "initiative" | "turn" | "chat" | "music";

/** localStorage key of the panel state (JSON). */
export const HUD_STORAGE_KEY = "ms.combat.hud";
/** Time without pointer, touch or key activity after which the floating layer fades out. */
export const HUD_IDLE_MS = 4000;
const NARROW_QUERY = "(max-width: 899px)";
const WIDE_QUERY = "(min-width: 1200px)";

interface StoredHud {
  initiative: boolean;
  turn: boolean;
  chat: boolean;
  music: boolean;
  hidden: boolean;
}

function mediaQuery(query: string): MediaQueryList | null {
  return typeof globalThis.matchMedia === "function" ? globalThis.matchMedia(query) : null;
}

/** The stored state, or null when there is none or it cannot be read. */
function readStored(): StoredHud | null {
  try {
    const raw = globalThis.localStorage?.getItem(HUD_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Record<keyof StoredHud, unknown>>;
    const flags = ["initiative", "turn", "chat", "music", "hidden"] as const;
    if (!flags.every((key) => typeof value[key] === "boolean")) return null;
    return value as StoredHud;
  } catch {
    return null;
  }
}

/**
 * State of the floating panels over the battle map: which panels are open, whether they are
 * all hidden by hand, and whether they have faded out for lack of activity. Provided by the
 * combat overlay (not root), so one instance lives as long as the overlay.
 *
 * Below 900 px there is no auto-hide, and Turn and Chat are bottom sheets, one open at a time.
 * From 900 px up to 1199 px Turn and Chat are also exclusive; from 1200 px both may be open.
 */
@Injectable()
export class CombatHud {
  readonly initiative = signal(true);
  readonly turn = signal(true);
  readonly chat = signal(false);
  readonly music = signal(true);
  /** All floating panels hidden by hand (the H key or the header button). */
  readonly hidden = signal(false);
  /** Faded out after HUD_IDLE_MS without activity. Never true on narrow screens. */
  readonly idle = signal(false);
  /** Under 900 px. */
  readonly narrow = signal(false);
  /** 1200 px and up. */
  readonly wide = signal(false);
  /** True while the pointer or the keyboard focus is inside a panel. */
  readonly pinned = signal(false);
  /** Whether the floating layer is shown at all. */
  readonly visible = computed(() => !this.hidden() && !this.idle());

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const narrowQuery = mediaQuery(NARROW_QUERY);
    const wideQuery = mediaQuery(WIDE_QUERY);
    this.narrow.set(!!narrowQuery?.matches);
    this.wide.set(!!wideQuery?.matches);

    const stored = readStored();
    this.initiative.set(stored?.initiative ?? true);
    this.music.set(stored?.music ?? true);
    this.hidden.set(stored?.hidden ?? false);
    this.turn.set(stored?.turn ?? !this.narrow());
    this.chat.set(stored?.chat ?? false);
    if (!this.wide() && this.turn() && this.chat()) this.chat.set(false);

    const onNarrow = () => {
      this.narrow.set(!!narrowQuery?.matches);
      if (this.narrow()) {
        this.clearTimer();
        this.idle.set(false);
      }
    };
    const onWide = () => {
      this.wide.set(!!wideQuery?.matches);
      if (!this.wide() && this.turn() && this.chat()) {
        this.chat.set(false);
        this.save();
      }
    };
    narrowQuery?.addEventListener?.("change", onNarrow);
    wideQuery?.addEventListener?.("change", onWide);
    destroyRef.onDestroy(() => {
      this.clearTimer();
      narrowQuery?.removeEventListener?.("change", onNarrow);
      wideQuery?.removeEventListener?.("change", onWide);
    });
  }

  /** Any pointer, touch or key activity: shows the floating layer and restarts the idle timer. */
  activity(): void {
    this.idle.set(false);
    this.clearTimer();
    if (this.narrow() || this.pinned()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.pinned() && !this.narrow()) this.idle.set(true);
    }, HUD_IDLE_MS);
  }

  /** True while a panel holds the pointer or the focus: no auto-hide then. */
  pin(on: boolean): void {
    if (this.pinned() === on) return;
    this.pinned.set(on);
    if (on) {
      this.clearTimer();
      this.idle.set(false);
    } else {
      this.activity();
    }
  }

  /** Opens or folds a panel, keeping Turn and Chat exclusive below 1200 px. */
  toggle(panel: HudPanel): void {
    this.setPanel(panel, !this.panelSignal(panel)());
  }

  /** Forces the chat open or closed (used when the chat is needed, e.g. to find the map). */
  setChat(open: boolean): void {
    this.setPanel("chat", open);
  }

  /** Hides or shows every floating panel by hand. */
  toggleHidden(): void {
    this.hidden.update((value) => !value);
    this.save();
  }

  private setPanel(panel: HudPanel, open: boolean): void {
    this.panelSignal(panel).set(open);
    if (open && !this.wide() && (panel === "turn" || panel === "chat")) {
      (panel === "turn" ? this.chat : this.turn).set(false);
    }
    this.save();
  }

  private panelSignal(panel: HudPanel) {
    switch (panel) {
      case "initiative":
        return this.initiative;
      case "turn":
        return this.turn;
      case "chat":
        return this.chat;
      case "music":
        return this.music;
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private save(): void {
    const value: StoredHud = {
      initiative: this.initiative(),
      turn: this.turn(),
      chat: this.chat(),
      music: this.music(),
      hidden: this.hidden(),
    };
    try {
      globalThis.localStorage?.setItem(HUD_STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Storage is blocked or full: the panels still work for this visit.
    }
  }
}
