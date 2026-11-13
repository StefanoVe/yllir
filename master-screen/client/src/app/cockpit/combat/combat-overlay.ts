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
import type { BattleView, CombatRules, LivePlayer } from "@shared/types";
import type { CombatNotice, Combatant, SourceRef } from "@shared/cockpit-types";
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

/** True under 900 px, where the chat starts folded. Without matchMedia (old browsers, tests) it does not. */
function narrowScreen(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 899px)").matches
  );
}

/**
 * Full-screen combat overlay with the table chat floating on the right. Without a combat
 * it shows the initiative step; with one, the battle view. Hosted once by the cockpit.
 */
@Component({
  selector: "cockpit-combat-overlay",
  imports: [Icon, ConfirmButton, Chat, InitiativeStep, BattleBoard],
  templateUrl: "./combat-overlay.html",
  styleUrl: "./combat-overlay.css",
  providers: [CombatChatService, { provide: ChatSource, useExisting: CombatChatService }],
})
export class CombatOverlay implements OnDestroy {
  readonly svc = inject(CombatOverlayService);
  readonly api = inject(CockpitService);
  readonly combatChat = inject(CombatChatService);
  readonly i18n = inject(I18n);
  readonly prefs = inject(BattleMapPrefs);
  private readonly battleApi = inject(BattleApi);
  private readonly overlay = inject(OverlayService);
  /** True while the combat thread is being created, so the effect does not ask twice. */
  private ensuring = false;
  readonly players = signal<LivePlayer[]>([]);
  readonly battle = signal<BattleView | null>(null);
  readonly rules = signal<CombatRules | null>(null);
  readonly error = signal("");
  /** Open on wide screens; folded when the overlay opens under 900 px (see the open effect). */
  readonly chatOpen = signal(true);
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
        if (!threadId && active && tableId) void this.ensureCombatThread(tableId);
        else
          this.combatChat
            .bind(tableId, threadId)
            .catch((error: unknown) => this.error.set(String(error)));
      });
    });
    // Each time the overlay opens: mark the notices already seen, and fold the chat on phones.
    effect(() => {
      const open = this.svc.open();
      untracked(() => {
        if (!open) return;
        this.noticeMark.set(this.newest()?.at ?? "");
        this.chatOpen.set(!narrowScreen());
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

  /** Creates the combat thread on the server when the combat has none yet, then follows it. */
  private async ensureCombatThread(tableId: string): Promise<void> {
    if (this.ensuring) return;
    this.ensuring = true;
    try {
      await this.combatChat.bind(tableId, null);
      await this.combatChat.ensureThread();
    } catch (error) {
      this.error.set(String(error));
    } finally {
      this.ensuring = false;
    }
  }

  @HostListener("document:keydown.escape")
  escape(): void {
    if (this.svc.open() && this.overlay.isTop("combat")) this.close();
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
    this.chatOpen.set(true);
    try {
      await this.combatChat.send(this.i18n.t("combat.map.findPrompt"), crypto.randomUUID());
    } catch (error) {
      this.combatChat.chatError.set(String(error));
    }
  }
}
