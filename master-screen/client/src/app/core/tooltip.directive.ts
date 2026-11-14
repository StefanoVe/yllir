import {
  Directive,
  ElementRef,
  HostListener,
  OnChanges,
  OnDestroy,
  inject,
  input,
} from "@angular/core";
import {
  TOOLTIP_DELAY_MS,
  TooltipPosition,
  TooltipService,
} from "./tooltip.service";

/**
 * Shows the shared tooltip for a control: `<button msTooltip="Settings" aria-label="Settings">`.
 * Hover waits TOOLTIP_DELAY_MS; keyboard focus shows it only when it is visible focus; touch never
 * shows it. The view keeps its own aria-label: the directive only adds aria-describedby.
 */
@Directive({
  selector: "[msTooltip]",
})
export class TooltipDirective implements OnChanges, OnDestroy {
  /** The text to show. Empty or whitespace means no tooltip. */
  readonly msTooltip = input<string>("");
  readonly msTooltipPosition = input<TooltipPosition>("top");

  private readonly tooltip = inject(TooltipService);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Pointer type of the last pointerenter; touch never gets a hover tooltip. */
  private pointerType = "";

  @HostListener("pointerenter", ["$event"])
  onPointerEnter(event: PointerEvent): void {
    this.pointerType = event.pointerType ?? "";
  }

  @HostListener("mouseenter")
  onMouseEnter(): void {
    if (this.pointerType === "touch") return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.showNow();
    }, TOOLTIP_DELAY_MS);
  }

  @HostListener("mouseleave")
  onMouseLeave(): void {
    this.clearTimer();
    this.tooltip.hide(this.el);
  }

  @HostListener("focus")
  onFocus(): void {
    if (this.matchesFocusVisible()) {
      this.clearTimer();
      this.showNow();
    }
  }

  @HostListener("blur")
  onBlur(): void {
    this.clearTimer();
    this.tooltip.hide(this.el);
  }

  @HostListener("pointerdown")
  onPointerDown(): void {
    this.clearTimer();
    this.tooltip.hide(this.el);
  }

  /** Text or side changed: refresh the open tooltip, or hide it when the text is now empty. */
  ngOnChanges(): void {
    if (!this.tooltip.isOwnedBy(this.el)) return;
    if (!this.text()) this.tooltip.hide(this.el);
    else this.tooltip.show(this.el, this.text(), this.msTooltipPosition());
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.tooltip.hide(this.el);
  }

  private showNow(): void {
    const text = this.text();
    if (text) this.tooltip.show(this.el, text, this.msTooltipPosition());
  }

  private text(): string {
    return (this.msTooltip() ?? "").trim();
  }

  private matchesFocusVisible(): boolean {
    try {
      return this.el.matches(":focus-visible");
    } catch {
      return false;
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
