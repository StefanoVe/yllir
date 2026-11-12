import {
  AfterViewChecked,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { Icon } from "../support/icon";
import { ChatSource } from "./chat-source";
import type { SourceRef } from "@shared/cockpit-types";
import { MODULE_KINDS, LEDGER_ICONS } from "../board/module-kinds";
import { TurnStatus } from "./turn-status";
import { Composer } from "./composer";
import { I18n } from "../../i18n";
export function renderMessageMarkdown(text: string) {
  const escape = (v: string) =>
    v
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return escape(text)
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
      return `<ul>${rows}</ul>`;
    })
    .replace(/\n/g, "<br>");
}
@Component({
  selector: "cockpit-chat",
  standalone: true,
  imports: [Icon, TurnStatus, Composer],
  templateUrl: "./chat.html",
  styleUrl: "./chat.css",
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
  expandedActions = signal("");
  newCount = signal(0);
  atBottom = true;
  private seen = 0;
  private signature = "";
  @ViewChild("messageList") list?: ElementRef<HTMLElement>;
  ngAfterViewChecked() {
    const messages = this.api.session()?.messages || [];
    const signature = messages.map((m) => `${m.id}:${m.text.length}`).join("|");
    if (signature === this.signature) return;
    const added = Math.max(0, messages.length - this.seen);
    const initial = !this.signature;
    this.signature = signature;
    this.seen = messages.length;
    // Scroll after layout: a microtask runs before the new messages have their height.
    requestAnimationFrame(() => {
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
  markdown(text: string) {
    return renderMessageMarkdown(text);
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
