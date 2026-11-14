import {
  Component,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from "@angular/core";
import { MusicMini } from "../../music/music-mini";
import type { BattleView, CombatRules, LivePlayer } from "@shared/types";
import type { Combat, CombatNotice, Combatant, SourceRef } from "@shared/cockpit-types";
import { Icon } from "../support/icon";
import { ConfirmButton } from "../support/confirm-button";
import { CockpitService } from "../cockpit.service";
import { OverlayService } from "../support/overlay.service";
import { Chat } from "../chat/chat";
import { ChatSource } from "../chat/chat-source";
import { I18n } from "../../i18n";
import { BattleApi } from "./battle-api";
import { BattleMapPrefs } from "./battle-maps-pref";
import { CombatOverlayService } from "./combat-overlay.service";
import { CombatChatService } from "./combat-chat.service";
import {
  byInitiative,
  fightCards,
  hpLow,
  hpPercent,
  initials,
  nextTurnId,
  noticeText,
} from "./combat-model";
import { InitiativeStep } from "./initiative-step";
import { BattleBoard } from "./battle-board";
import { TurnPanel } from "./turn-panel";
import { CombatHud } from "./combat-hud.service";
import { TooltipDirective } from "../../core/tooltip.directive";

/** True when the focus is in a field that takes typed text, where the H key must not hide the panels. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/**
 * Full-screen combat overlay: the battle map fills it, and the initiative, turn, chat and music
 * panels float over the map with their own toggles. Without a combat it shows the initiative
 * step; with one, the battle view. Hosted once by the cockpit.
 */
@Component({
  selector: "cockpit-combat-overlay",
  imports: [Icon, ConfirmButton, Chat, InitiativeStep, BattleBoard, TurnPanel, MusicMini, TooltipDirective],
  templateUrl: "./combat-overlay.html",
  styleUrl: "./combat-overlay.css",
  providers: [
    CombatChatService,
    { provide: ChatSource, useExisting: CombatChatService },
    CombatHud,
  ],
})
export class CombatOverlay implements OnDestroy {
  readonly svc = inject(CombatOverlayService);
  readonly api = inject(CockpitService);
  readonly combatChat = inject(CombatChatService);
  readonly i18n = inject(I18n);
  readonly prefs = inject(BattleMapPrefs);
  /** Ten segments for the hit point bar of an initiative row. */
  readonly ticks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  private readonly battleApi = inject(BattleApi);
  private readonly overlay = inject(OverlayService);
  /** The combat thread being created, so that a second caller waits for it instead of creating another. */
  private ensuring: Promise<void> | null = null;
  /** The table and whether it had a combat the last time the session was seen. */
  private seenSession: { tableId: string | null; active: boolean } | null = null;
  /** True once the combat on screen was handled: either it was already running when first seen, or its start was acted on. */
  private combatHandled = false;
  readonly players = signal<LivePlayer[]>([]);
  readonly battle = signal<BattleView | null>(null);
  readonly rules = signal<CombatRules | null>(null);
  readonly error = signal("");
  readonly hud = inject(CombatHud);
  /** Floating panels that hold the pointer (by panel name) or the keyboard focus. */
  private readonly pointerIn = new Set<string>();
  private readonly focusIn = new Set<string>();
  readonly noticesOpen = signal(false);
  /** The `at` of the newest notice when the overlay opened: only later notices are announced. */
  private readonly noticeMark = signal("");
  readonly combat = computed(() => this.api.session()?.state.combat ?? null);
  readonly cards = computed(() =>
    fightCards(this.api.session()?.state.board.modules ?? []),
  );
  /** The combatant who takes the turn next, or null when nobody can. */
  readonly nextId = computed(() => {
    const c = this.combat();
    return c ? nextTurnId(c.participants, c.activeId) : null;
  });
  /** Every participant in initiative order: the strip's tiles. */
  readonly order = computed(() => byInitiative(this.combat()?.participants ?? []));
  readonly initials = initials;
  readonly hpLow = (c: Combatant) => hpLow(c.hp, c.maxHp);
  readonly hpPct = (c: Combatant) => hpPercent(c.hp, c.maxHp);
  readonly newest = computed<CombatNotice | null>(() => this.combat()?.notices.at(-1) ?? null);
  /**
   * The notice shown in the header: the newest one that is not a turn change, since the strip
   * already shows whose turn it is. Null when there is none, and then the header has no pill.
   */
  readonly pillNotice = computed<CombatNotice | null>(
    () => [...(this.combat()?.notices ?? [])].reverse().find((n) => n.kind !== "turn") ?? null,
  );
  /** The last ten notices, newest first. */
  readonly recentNotices = computed(() => [...(this.combat()?.notices ?? [])].reverse().slice(0, 10));
  /** The newest notice, only when it came after the overlay opened. */
  readonly announced = computed(() => {
    const n = this.newest();
    return n && n.at > this.noticeMark() ? this.noticeLine(n) : "";
  });
  readonly title = computed(() => {
    const combat = this.combat();
    if (combat) return combat.title;
    const clicked = this.svc.clicked();
    return clicked
      ? this.i18n.t("combat.title", { name: clicked.name })
      : this.i18n.t("combat.titleDefault");
  });
  readonly openSource = (source: SourceRef) => {
    // The document modal lives under the overlay: close the overlay, then open the document.
    this.svc.close();
    window.dispatchEvent(new CustomEvent("cockpit-open", { detail: source }));
  };

  constructor() {
    effect(() => {
      const session = this.api.session();
      const active = !!session?.state.combat;
      untracked(() => this.svc.sync(session?.id ?? null, active));
    });
    // While the overlay is open, the combat chat follows the thread of the active combat.
    effect(() => {
      if (!this.svc.open()) return;
      const session = this.api.session();
      const tableId = session?.id ?? null;
      const threadId = this.combat()?.threadId ?? null;
      const active = !!this.combat();
      untracked(() => {
        if (!threadId && active && tableId)
          void this.ensureCombatThread(tableId).catch((error: unknown) => this.error.set(String(error)));
        else
          this.combatChat
            .bind(tableId, threadId)
            .catch((error: unknown) => this.error.set(String(error)));
      });
    });
    // A combat that starts while the table is on screen gets its battle map looked for once,
    // whether or not a map is set. A combat already running when the table was first seen does not.
    effect(() => {
      const session = this.api.session();
      const tableId = session?.id ?? null;
      const combat = session?.state.combat ?? null;
      untracked(() => this.observeCombatStart(tableId, combat));
    });
    // Each time the overlay opens: mark the notices already seen and show the panels. When it
    // closes, forget the panels the pointer or focus was in, since their leave events never come.
    effect(() => {
      const open = this.svc.open();
      untracked(() => {
        if (open) {
          this.noticeMark.set(this.newest()?.at ?? "");
          this.hud.activity();
        } else this.clearPanelHolds();
      });
    });
    // Without a combat there is no floating layer, so no panel can hold the pointer or focus.
    effect(() => {
      const active = !!this.combat();
      untracked(() => {
        if (!active) this.clearPanelHolds();
      });
    });
    // Opening the overlay or any cockpit state change (also one that keeps the revision, such
    // as a saved battle map) refetches the players and the battle view.
    effect(() => {
      const open = this.svc.open();
      this.api.stateTick();
      untracked(() => {
        if (open) void this.load();
      });
    });
  }

  ngOnDestroy(): void {
    this.combatChat.destroy();
  }

  /** Decides whether the combat on screen just started, and if it has a non-player combatant, looks for its map. */
  private observeCombatStart(tableId: string | null, combat: Combat | null): void {
    const previous = this.seenSession;
    this.seenSession = { tableId, active: !!combat };
    if (!combat) {
      this.combatHandled = false;
      return;
    }
    if (this.combatHandled) return;
    this.combatHandled = true;
    // A start is only observed on the same table, seen before without a combat. A session that
    // loads late (null, then the table with its combat) is not a start.
    const started = tableId !== null && previous !== null && previous.tableId === tableId && !previous.active;
    if (started && combat.participants.some((p) => p.kind !== "pc")) void this.findMapForNewCombat(tableId);
  }

  /** Creates the combat thread on the server when the combat has none yet, then follows it. */
  private ensureCombatThread(tableId: string): Promise<void> {
    this.ensuring ??= this.createCombatThread(tableId).finally(() => {
      this.ensuring = null;
    });
    return this.ensuring;
  }

  private async createCombatThread(tableId: string): Promise<void> {
    await this.combatChat.bind(tableId, null);
    await this.combatChat.ensureThread();
  }

  /** Waits for the combat thread to exist, then sends the same find-map request as the button. */
  private async findMapForNewCombat(tableId: string): Promise<void> {
    try {
      await this.ensureCombatThread(tableId);
    } catch (error) {
      this.combatChat.chatError.set(String(error));
      return;
    }
    await this.requestBattleMap();
  }

  @HostListener("document:keydown.escape")
  escape(): void {
    if (this.svc.open() && this.overlay.isTop("combat")) this.close();
  }

  @HostListener("pointermove")
  @HostListener("pointerdown")
  pointerActivity(): void {
    if (this.svc.open()) this.hud.activity();
  }

  /** Any key shows the panels; H hides or shows them all, unless the key goes to a text field. */
  @HostListener("keydown", ["$event"])
  keyActivity(event: KeyboardEvent): void {
    if (!this.svc.open()) return;
    this.hud.activity();
    if (
      (event.key === "h" || event.key === "H") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      this.combat() &&
      !isTyping(event.target)
    ) {
      event.preventDefault();
      this.hud.toggleHidden();
    }
  }

  /** The pointer enters or leaves a floating panel: while it is inside, the panels stay shown. */
  hover(panel: string, inside: boolean): void {
    if (inside) this.pointerIn.add(panel);
    else this.pointerIn.delete(panel);
    this.syncPin();
  }

  /** The keyboard focus enters or leaves a floating panel. */
  focusPanel(panel: string, inside: boolean): void {
    if (inside) this.focusIn.add(panel);
    else this.focusIn.delete(panel);
    this.syncPin();
  }

  private clearPanelHolds(): void {
    this.pointerIn.clear();
    this.focusIn.clear();
    this.hud.pin(false);
  }

  private syncPin(): void {
    this.hud.pin(this.pointerIn.size > 0 || this.focusIn.size > 0);
  }

  close(): void {
    this.svc.close();
  }

  /** A notice as a sentence in the campaign language. */
  noticeLine(notice: CombatNotice): string {
    return noticeText(notice, this.rules(), (key, params) => this.i18n.t(key, params));
  }

  async load(): Promise<void> {
    const [players, battle, rules] = await Promise.allSettled([
      this.battleApi.players(),
      this.battleApi.battle(),
      this.battleApi.rules(),
    ]);
    if (players.status === "fulfilled") this.players.set(players.value);
    if (battle.status === "fulfilled") this.battle.set(battle.value);
    if (rules.status === "fulfilled") this.rules.set(rules.value);
    this.error.set(
      players.status === "rejected" || battle.status === "rejected"
        ? this.i18n.t("combat.error.load")
        : "",
    );
  }

  /** Passes the turn to the next combatant in initiative order. */
  async nextTurn(): Promise<void> {
    const id = this.nextId();
    if (!id) return;
    try {
      await this.api.action({ type: "combat.turn", activeId: id });
    } catch {
      this.error.set(this.i18n.t("combat.error.turn"));
    }
  }

  async endCombat(): Promise<void> {
    try {
      await this.api.action({ type: "combat.end" });
    } catch {
      this.error.set(this.i18n.t("combat.error.end"));
    }
  }

  /** Asks the agent, in the campaign language, to find and set the battle map of the place. */
  async findMap(): Promise<void> {
    this.hud.setChat(true);
    await this.requestBattleMap();
  }

  /** The find-map request itself, which does not open the chat panel. */
  private async requestBattleMap(): Promise<void> {
    try {
      await this.combatChat.send(this.i18n.t("combat.map.findPrompt"), crypto.randomUUID());
    } catch (error) {
      this.combatChat.chatError.set(String(error));
    }
  }
}
