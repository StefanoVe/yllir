import {
  AfterViewChecked,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { LucideAngularModule, PanelRightClose, PanelRightOpen } from "lucide-angular";
import { Icon } from "../support/icon";
import { ChatSource } from "./chat-source";
import type { SourceRef } from "@shared/cockpit-types";
import { MODULE_KINDS, LEDGER_ICONS } from "../board/module-kinds";
import { TurnStatus } from "./turn-status";
import { Composer } from "./composer";
import { I18n } from "../../i18n";
import { TooltipDirective } from "../../core/tooltip.directive";
import { activeTurn } from "./turn-status";
export function renderMessageMarkdown(text: string) {
  const escape = (v: string) =>
    v
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const html = escape(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
      const [path, anchor] = href.split("#", 2);
      if (/^https?:/i.test(path))
        return `<a href="${path}" target="_blank" rel="noopener">${label}</a>`;
      return `<a href="#" data-source-path="${path}" data-source-anchor="${anchor || ""}">${label}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?:^|\n)(?:[-*]\s+[^\n]*(?:\n|$))+/g, (block) => {
      const rows = block
        .trim()
        .split("\n")
        .map((line) => `<li>${line.replace(/^[-*]\s+/, "")}</li>`)
        .join("");
      return `\n\n<ul>${rows}</ul>\n\n`;
    });
  // A blank line starts a new paragraph (8px apart in CSS); a single line break stays a <br>.
  return html
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part.startsWith("<ul>") ? part : `<p>${part.replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}
@Component({
  selector: "cockpit-chat",
  standalone: true,
  imports: [Icon, TurnStatus, Composer, TooltipDirective, NgTemplateOutlet, LucideAngularModule],
  templateUrl: "./chat.html",
  styleUrl: "./chat.css",
  host: { "[class.collapsed]": "collapsible() && collapsed()" },
})
export class Chat implements AfterViewChecked, OnDestroy {
  readonly api = inject(ChatSource);
  readonly i18n = inject(I18n);
  openSource = input<(source: SourceRef) => void>(() => {});
  /** Shown instead of the messages while the thread does not exist yet. */
  placeholder = input<string>("");
  /** Shows the composer even without a thread: the thread is then created by the first message. */
  alwaysCompose = input(false);
  /** False hides the chat's own header (the combat overlay has its own). */
  showHead = input(true);
  messagesArrived = output<number>();
  /** The cockpit shows the fold toggle and the collapsed strip; the combat overlay has neither. */
  collapsible = input(false);
  collapsed = input(false);
  collapseToggle = output<void>();
  /** Icons of the fold toggle: the panel closes when the assistant is open, opens when it is folded. */
  readonly toggleIcons = { hide: PanelRightClose, show: PanelRightOpen };
  /** A message arrived while folded. Cleared on unfold. */
  private unreadNew = signal(false);
  /** The strip's mark: a new message, a turn running or queued, or a network error, while folded. */
  readonly needsAttention = computed(
    () =>
      this.collapsible() &&
      this.collapsed() &&
      (this.unreadNew() || !!activeTurn(this.api.session()) || !!this.api.chatError()),
  );
  expandedActions = signal("");
  newCount = signal(0);
  atBottom = true;
  private seen = 0;
  private signature = "";
  @ViewChild("messageList") list?: ElementRef<HTMLElement>;

  constructor() {
    effect(() => {
      if (!this.collapsed()) this.unreadNew.set(false);
    });
  }

  ngAfterViewChecked() {
    const messages = this.api.session()?.messages || [];
    const signature = messages.map((m) => `${m.id}:${m.text.length}`).join("|");
    if (signature === this.signature) return;
    const added = Math.max(0, messages.length - this.seen);
    const initial = !this.signature;
    this.signature = signature;
    this.seen = messages.length;
    const foldedArrival = !initial && added > 0 && this.collapsed();
    // Scroll after layout: a microtask runs before the new messages have their height.
    requestAnimationFrame(() => {
      if (foldedArrival) this.unreadNew.set(true);
      const el = this.list?.nativeElement;
      if (!el) return;
      this.observeHeight(el);
      if (initial || this.atBottom) this.scrollEnd(el);
      else if (added) {
        this.newCount.update((n) => n + added);
        this.messagesArrived.emit(added);
      }
    });
  }
  private resizeObserver?: ResizeObserver;
  /** While the DM is at the bottom, late growth (fonts, long replies) keeps the newest text in view. */
  private observeHeight(el: HTMLElement) {
    // Test environments (jsdom) have no ResizeObserver: the pane then just does not follow growth.
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver ??= new ResizeObserver(() => {
      if (this.atBottom) el.scrollTop = el.scrollHeight;
    });
    // Observing an already observed element is a no-op, so new messages are simply added.
    this.resizeObserver.observe(el);
    for (const child of Array.from(el.children))
      this.resizeObserver.observe(child);
  }
  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }
  scrollChanged(el: HTMLElement) {
    this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (this.atBottom) this.newCount.set(0);
  }
  scrollEnd(el: HTMLElement) {
    el.scrollTop = el.scrollHeight;
    this.newCount.set(0);
  }
  toggleLabel() {
    return this.i18n.t(this.collapsed() ? "liveAgent.showAssistant" : "liveAgent.hideAssistant");
  }
  markdown(text: string) {
    return renderMessageMarkdown(text);
  }
  /** Local 24-hour time of a message, HH:mm. Empty when the stamp does not parse. */
  timeLabel(at: string) {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  /** Header state of the thread: nothing while idle, the turn state while one is open. */
  stateLabel() {
    const turn = activeTurn(this.api.session());
    if (!turn) return "";
    return this.i18n.t(
      turn.status === "queued" ? "liveAgent.turn.statusQueued" : "liveAgent.turn.statusRunning",
    );
  }
  messageClick(event: MouseEvent) {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      "a[data-source-path]",
    );
    if (!link) return;
    event.preventDefault();
    this.openSource()({
      path: decodeURIComponent(link.dataset["sourcePath"] || ""),
      anchor: decodeURIComponent(link.dataset["sourceAnchor"] || ""),
    });
  }
  icon(kind: string) {
    if (kind in MODULE_KINDS)
      return MODULE_KINDS[kind as keyof typeof MODULE_KINDS].icon;
    if (kind in LEDGER_ICONS) return LEDGER_ICONS[kind]!;
    return (
      (
        {
          module: "board",
          ledger: "ledger",
          combat: "swords",
          position: "place",
          party: "users",
        } as Record<string, string>
      )[kind] || "file"
    );
  }
  async send(text: string) {
    try {
      await this.api.send(text, crypto.randomUUID());
    } catch (error) {
      this.api.chatError.set(String(error));
    }
  }
  async retry(text: string) {
    this.api.chatError.set("");
    try {
      await this.api.send(text, crypto.randomUUID());
    } catch (error) {
      this.api.chatError.set(String(error));
    }
  }
}
