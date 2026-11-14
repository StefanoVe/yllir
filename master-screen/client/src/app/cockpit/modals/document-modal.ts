import {
  Component,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  ViewEncapsulation,
  effect,
  inject,
  untracked,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { Router } from "@angular/router";
import { Lock, LucideAngularModule } from "lucide-angular";
import { Icon } from "../support/icon";
import { DocumentsService } from "../support/documents.service";
import { ViewerService } from "../support/viewer.service";
import { OverlayService } from "../support/overlay.service";
import { DocBody } from "../../reader/doc-body";
import { TooltipDirective } from "../../core/tooltip.directive";
import type { DocResponse } from "@shared/types";
import type { SourceRef } from "@shared/cockpit-types";
import { docUrl, parseDocHref } from "../../core/doc-nav.service";
import { I18n } from "../../i18n";

/** The first folder of a document path, humanized ("Magic-Swords" -> "Magic swords"); "" when there is none. */
function categoryOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return "";
  const raw = parts[0]!.replace(/[-_]+/g, " ").trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A campaign document over the cockpit. Links to other documents open inside the
 * modal (with a back button), so the master never leaves the live table by accident.
 */
@Component({
  selector: "cockpit-document-modal",
  imports: [Icon, DocBody, LucideAngularModule, TooltipDirective],
  templateUrl: "./document-modal.html",
  styleUrls: ["./modal.css", "./document-modal.css"],
  // The document body is rendered by the reader's DocBody, whose styles are global.
  encapsulation: ViewEncapsulation.None,
})
export class DocumentModal implements OnInit {
  source = input.required<SourceRef>();
  /** Ordered sheets for the previous and next buttons. Empty = no navigator. */
  siblings = input<SourceRef[]>([]);
  close = output<void>();
  readonly i18n = inject(I18n);
  readonly icons = { lock: Lock };
  private documents = inject(DocumentsService);
  private viewer = inject(ViewerService);
  private overlay = inject(OverlayService);
  private router = inject(Router);
  private body = viewChild<ElementRef<HTMLElement>>("body");
  private closeButton = viewChild<ElementRef<HTMLButtonElement>>("closeButton");
  private returnFocus = document.activeElement as HTMLElement | null;
  doc = signal<DocResponse | null>(null);
  error = signal("");
  /** Path of the document that failed to open, shown under the error. */
  failedPath = signal("");
  /** Visited documents inside the modal; the last one is shown. */
  history = signal<SourceRef[]>([]);
  /** Reading progress of the body, 0..1. */
  progress = signal(0);
  /** Anchor of the outline heading at the top of the body; "" when none. */
  activeHeading = signal("");
  readonly loading = computed(() => !this.doc() && !this.error());
  readonly category = computed(() => categoryOf(this.doc()?.path ?? ""));
  readonly backlinks = computed(() => this.doc()?.backlinks ?? []);
  /** Level 2 and 3 headings, the entries of the "On this page" rail. */
  readonly outline = computed(() =>
    (this.doc()?.headings ?? []).filter((heading) => heading.level === 2 || heading.level === 3),
  );
  readonly showOutline = computed(() => this.outline().length >= 3);
  /** Position of the shown document in `siblings`; null when there is no navigator. */
  readonly navigator = computed(() => {
    const list = this.siblings();
    const path = (this.history().at(-1) ?? this.source()).path;
    const index = list.findIndex((item) => item.path === path);
    if (list.length === 0 || index < 0) return null;
    return {
      index,
      total: list.length,
      prev: index > 0 ? list[index - 1]! : null,
      next: index < list.length - 1 ? list[index + 1]! : null,
    };
  });

  constructor() {
    // Follow the source, not the component's lifetime: the modal is reused when the
    // cockpit opens another document while it is already showing one.
    effect(() => {
      const source = this.source();
      untracked(() => this.load(source, false));
    });
  }

  ngOnInit() {
    setTimeout(() => this.closeButton()?.nativeElement.focus(), 0);
  }

  private load(source: SourceRef, push: boolean) {
    this.show(source, push).catch((e: unknown) =>
      this.error.set(
        this.i18n.t("liveAgent.docOpenFailed") +
          " " +
          (e instanceof Error ? e.message : String(e)),
      ),
    );
  }

  async show(source: SourceRef, push = true) {
    this.error.set("");
    this.failedPath.set("");
    this.doc.set(null);
    this.progress.set(0);
    this.activeHeading.set("");
    try {
      const doc = await this.documents.detail(source.path);
      this.doc.set(doc);
      this.history.update((h) => (push ? [...h, source] : [source]));
      setTimeout(() => {
        const root = this.body()?.nativeElement;
        if (root) root.scrollTop = 0;
        this.scrollToAnchor(source.anchor);
        this.onScroll();
      }, 0);
    } catch {
      this.failedPath.set(source.path);
      this.error.set(this.i18n.t("liveAgent.docUnavailable") + " " + source.path);
    }
  }

  back() {
    const history = this.history();
    if (history.length < 2) return;
    const previous = history[history.length - 2]!;
    this.history.set(history.slice(0, -2));
    this.load(previous, true);
  }

  /** Opens a document that links to the shown one, inside the modal. */
  openBacklink(path: string) {
    this.load({ path }, true);
  }

  /** Scrolls the body to an outline heading and highlights it. */
  goTo(id: string) {
    this.activeHeading.set(id);
    this.scrollToAnchor(id, true);
  }

  /** Updates the reading progress and the active outline entry from the body position. */
  onScroll() {
    const root = this.body()?.nativeElement;
    if (!root) return;
    const max = root.scrollHeight - root.clientHeight;
    this.progress.set(max > 0 ? Math.min(1, Math.max(0, root.scrollTop / max)) : 0);
    this.activeHeading.set(this.headingAt(root));
  }

  /** The last outline heading whose top is at or above the body top plus 80px. */
  private headingAt(root: HTMLElement): string {
    const line = root.getBoundingClientRect().top + 80;
    let active = "";
    for (const heading of this.outline()) {
      const el = this.headingElement(root, heading.id);
      if (el && el.getBoundingClientRect().top <= line) active = heading.id;
    }
    return active;
  }

  private headingElement(root: HTMLElement, id: string): HTMLElement | null {
    return root.querySelector<HTMLElement>("[id=" + JSON.stringify(id) + "]");
  }

  /** Scrolls the body to the heading of the anchor, or to the top. Smooth only when motion is allowed. */
  private scrollToAnchor(anchor?: string, smooth = false) {
    const root = this.body()?.nativeElement;
    if (!root) return;
    const target = anchor ? this.headingElement(root, anchor) : null;
    const top = target
      ? target.getBoundingClientRect().top -
        root.getBoundingClientRect().top +
        root.scrollTop -
        12
      : 0;
    if (smooth && !prefersReducedMotion() && typeof root.scrollTo === "function") {
      root.scrollTo({ top, behavior: "smooth" });
    } else {
      root.scrollTop = top;
    }
  }

  /** Images open in the viewer; links to other documents stay inside this modal. */
  click(event: MouseEvent) {
    const el = event.target as HTMLElement;
    const img = el.closest("img");
    if (img) {
      this.viewer.openImage(img.src, img);
      return;
    }
    const link = el.closest("a");
    if (!link) return;
    const target = parseDocHref(link.getAttribute("href") || "");
    if (!target) return;
    event.preventDefault();
    this.load({ path: target.path, anchor: target.fragment || undefined }, true);
  }

  /** Loads the previous (-1) or next (+1) sheet, replacing the shown one. False when there is none. */
  step(delta: -1 | 1): boolean {
    const nav = this.navigator();
    const target = delta < 0 ? nav?.prev : nav?.next;
    if (!target) return false;
    this.load(target, false);
    return true;
  }

  openInReader() {
    const current = this.history().at(-1) || this.source();
    this.dismiss();
    void this.router.navigateByUrl(
      docUrl(current.path) + (current.anchor ? "#" + encodeURIComponent(current.anchor) : ""),
    );
  }

  dismiss() {
    this.close.emit();
    this.returnFocus?.focus();
  }

  /** Esc closes this modal only when no image or PDF is open above it. */
  @HostListener("document:keydown.escape") escape() {
    if (this.overlay.top() !== null) return;
    this.dismiss();
  }

  /** Left and right arrows walk the sheets, under the same rule as Esc and never while typing. */
  @HostListener("document:keydown", ["$event"]) arrows(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (this.overlay.top() !== null) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    )
      return;
    if (this.step(event.key === "ArrowLeft" ? -1 : 1)) event.preventDefault();
  }
}
