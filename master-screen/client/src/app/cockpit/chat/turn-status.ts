import { Component, computed, inject, OnDestroy, signal } from "@angular/core";
import { Icon } from "../support/icon";
import { ChatSource, type ChatThreadView } from "./chat-source";
import { I18n, type TranslationKey } from "../../i18n";
import { TooltipDirective } from "../../core/tooltip.directive";
import type { Turn } from "@shared/cockpit-types";
export function activeTurn(session: ChatThreadView | null): Turn | null {
  return (
    session?.turns.find((t) => t.status === "running") ||
    session?.turns.find((t) => t.status === "queued") ||
    null
  );
}
export function elapsedSeconds(turn: Turn) {
  return Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(turn.startedAt || Date.now()).getTime()) / 1000,
    ),
  );
}
const ACTIVITY_KEYS: Record<string, TranslationKey> = {
  thinking: "liveAgent.turn.thinking",
  tool: "liveAgent.turn.tool",
  writing: "liveAgent.turn.writing",
};
const STATUS_KEYS: Record<string, TranslationKey> = {
  queued: "liveAgent.turn.statusQueued",
  running: "liveAgent.turn.statusRunning",
  done: "liveAgent.turn.statusDone",
  error: "liveAgent.turn.statusError",
  cancelled: "liveAgent.turn.statusCancelled",
};
export function turnLabel(turn: Turn, translate: (key: TranslationKey) => string) {
  const key =
    turn.activity?.label ? null : turn.status === "running" && turn.activity ? ACTIVITY_KEYS[turn.activity.kind] : undefined;
  if (turn.activity?.label) return turn.activity.label;
  if (key) return translate(key);
  return translate(STATUS_KEYS[turn.status]);
}
@Component({
  selector: "cockpit-turn-status",
  standalone: true,
  imports: [Icon, TooltipDirective],
  templateUrl: "./turn-status.html",
  styleUrl: "./turn-status.css",
})
export class TurnStatus implements OnDestroy {
  api = inject(ChatSource);
  readonly i18n = inject(I18n);
  tick = signal(0);
  turn = computed(() => activeTurn(this.api.session()));
  private timer: number;
  constructor() {
    this.timer = window.setInterval(() => this.tick.update((n) => n + 1), 1000);
  }
  ngOnDestroy() {
    window.clearInterval(this.timer);
  }
  seconds() {
    this.tick();
    const turn = this.turn();
    return turn ? elapsedSeconds(turn) : 0;
  }
  label(turn: Turn) {
    return turnLabel(turn, (key) => this.i18n.t(key));
  }
  icon(turn: Turn) {
    return turn.status === "queued"
      ? "clock"
      : turn.activity?.kind === "tool"
        ? "code"
        : turn.activity?.kind === "writing"
          ? "file"
          : "activity";
  }
  queued() {
    return (
      this.api.session()?.turns.filter((t) => t.status === "queued").length || 0
    );
  }
  stop() {
    void this.api.cancel();
  }
}
