import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { Icon } from "./support/icon";
import { CockpitService } from "./cockpit.service";
import type { SourceRef } from "@shared/cockpit-types";
import { Board } from "./board/board";
import { Chat } from "./chat/chat";
import { ChatSource } from "./chat/chat-source";
import { TurnStatus, activeTurn } from "./chat/turn-status";
import { DocumentModal } from "./modals/document-modal";
import { SessionModal } from "./modals/session-modal";
import { DocumentsService } from "./support/documents.service";
import { ViewerService } from "./support/viewer.service";
import { CockpitViewer } from "./support/cockpit-viewer";
import { CombatOverlay } from "./combat/combat-overlay";
import { I18n } from "../i18n";

const CHAT_WIDTH_KEY = "yllir.cockpit.chat-width";
const CHAT_COLLAPSED_KEY = "yllir.cockpit.chat-collapsed";
const MIN_CHAT = 320;
const MAX_CHAT = 640;

/**
 * Mission control, the live table (`/live`). The open session is kept by the service;
 * everything opened from here is a modal on top.
 */
@Component({
  selector: "app-cockpit",
  imports: [Board, Chat, TurnStatus, Icon, DocumentModal, SessionModal, CockpitViewer, CombatOverlay],
  templateUrl: "./cockpit.html",
  styleUrl: "./cockpit.css",
  providers: [{ provide: ChatSource, useExisting: CockpitService }],
})
export class Cockpit implements OnInit, OnDestroy {
  api = inject(CockpitService);
  readonly i18n = inject(I18n);
  private documents = inject(DocumentsService);
  private viewer = inject(ViewerService);
  chatWidth = signal(384);
  /** The assistant folded into a 48px strip. Per browser; the width is kept while collapsed. */
  chatCollapsed = signal(false);
  mobile = signal<"board" | "chat">("board");
  unread = signal(0);
  loadError = signal("");
  active = computed(() => activeTurn(this.api.session()));
  openSource = (source: SourceRef) => this.openSourceRef(source);

  ngOnInit() {
    try {
      const saved = Number(localStorage.getItem(CHAT_WIDTH_KEY));
      if (saved >= MIN_CHAT && saved <= MAX_CHAT) this.chatWidth.set(saved);
      this.chatCollapsed.set(localStorage.getItem(CHAT_COLLAPSED_KEY) === "1");
    } catch {}
    void this.start();
  }

  /** Opens the last session used (or the most recent one), or shows the sessions list when there is none. */
  private async start() {
    try {
      const id = await this.api.defaultSessionId();
      if (id) await this.api.select(id);
      else this.api.modal.set({ kind: "sessions" });
    } catch {
      this.loadError.set(this.i18n.t("liveAgent.sessionNotFound"));
    }
  }

  ngOnDestroy() {
    this.api.modal.set(null);
    this.api.destroy();
  }

  openSessions() {
    this.api.modal.set({ kind: "sessions" });
  }

  @HostListener("window:cockpit-open", ["$event"]) onOpen(event: Event) {
    this.openSourceRef((event as CustomEvent<SourceRef>).detail);
  }

  private openSourceRef(source: SourceRef) {
    if (/\.(?:png|jpe?g|webp|svg|gif)$/i.test(source.path))
      this.viewer.openImage(this.documents.asset(source.path));
    else if (/\.pdf$/i.test(source.path))
      this.viewer.openPdf(this.documents.asset(source.path));
    else this.api.modal.set({ kind: "document", source });
  }

  /** Folds or unfolds the assistant. Never called automatically: new messages only mark the strip. */
  toggleChat() {
    const next = !this.chatCollapsed();
    this.chatCollapsed.set(next);
    try {
      localStorage.setItem(CHAT_COLLAPSED_KEY, next ? "1" : "0");
    } catch {}
  }
  /** Ctrl+. (Cmd+. on macOS) folds or unfolds the assistant, except while typing in a text field. */
  @HostListener("window:keydown", ["$event"]) onShortcut(event: KeyboardEvent) {
    if (event.key !== "." || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, select") || target?.isContentEditable) return;
    event.preventDefault();
    this.toggleChat();
  }
  beginDrag(event: PointerEvent) {
    if (this.chatCollapsed()) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  moveDrag(event: PointerEvent) {
    if (!event.buttons || this.chatCollapsed()) return;
    const rect = (
      event.currentTarget as HTMLElement
    ).parentElement!.getBoundingClientRect();
    this.setChatWidth(rect.right - event.clientX);
  }
  dragKey(event: KeyboardEvent) {
    if (this.chatCollapsed()) return;
    const delta =
      event.key === "ArrowLeft" ? 16 : event.key === "ArrowRight" ? -16 : 0;
    if (!delta) return;
    event.preventDefault();
    this.setChatWidth(this.chatWidth() + delta);
  }
  private setChatWidth(value: number) {
    this.chatWidth.set(Math.min(MAX_CHAT, Math.max(MIN_CHAT, value)));
    try {
      localStorage.setItem(CHAT_WIDTH_KEY, String(this.chatWidth()));
    } catch {}
  }

  arrived(count: number) {
    if (this.mobile() === "board") this.unread.update((value) => value + count);
  }
  showChat() {
    this.mobile.set("chat");
    this.unread.set(0);
  }
}
