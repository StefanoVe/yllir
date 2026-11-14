import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipDirective } from "./tooltip.directive";
import { TOOLTIP_DELAY_MS, TooltipPosition } from "./tooltip.service";

@Component({
  imports: [TooltipDirective],
  template: `<button type="button" [msTooltip]="text()" [msTooltipPosition]="position()" aria-label="Settings">+</button>`,
})
class HostComponent {
  readonly text = signal("Settings");
  readonly position = signal<TooltipPosition>("top");
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Gives the tooltip element a fixed size and the host the given rectangle. */
function mockRects(hostRect: DOMRect, tipWidth: number, tipHeight: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return this.id === "ms-tooltip" ? rect(0, 0, tipWidth, tipHeight) : hostRect;
    },
  );
}

function tooltipEl(): HTMLElement | null {
  return document.getElementById("ms-tooltip");
}

function isVisible(): boolean {
  return !!tooltipEl()?.classList.contains("ms-tooltip--visible");
}

describe("TooltipDirective", () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  let host: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    host = fixture.nativeElement.querySelector("button") as HTMLElement;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    tooltipEl()?.remove();
    document.getElementById("ms-tooltip-style")?.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows nothing for empty text", () => {
    fixture.componentInstance.text.set("   ");
    fixture.detectChanges();

    host.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);

    expect(isVisible()).toBe(false);
    expect(host.hasAttribute("aria-describedby")).toBe(false);
  });

  it("shows after the delay with the text and aria-describedby on the host", () => {
    host.dispatchEvent(new Event("mouseenter"));

    vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1);
    expect(isVisible()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(isVisible()).toBe(true);
    expect(tooltipEl()?.textContent).toBe("Settings");
    expect(tooltipEl()?.getAttribute("role")).toBe("tooltip");
    expect(host.getAttribute("aria-describedby")).toBe("ms-tooltip");
    expect(host.getAttribute("aria-label")).toBe("Settings");
  });

  it("hides on mouseleave and removes aria-describedby", () => {
    host.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(host.hasAttribute("aria-describedby")).toBe(true);

    host.dispatchEvent(new Event("mouseleave"));

    expect(isVisible()).toBe(false);
    expect(host.hasAttribute("aria-describedby")).toBe(false);
  });

  it("hides on Escape", () => {
    host.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(isVisible()).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(isVisible()).toBe(false);
    expect(host.hasAttribute("aria-describedby")).toBe(false);
  });

  it("does not show for a touch pointer", () => {
    const touch = new Event("pointerenter");
    Object.defineProperty(touch, "pointerType", { value: "touch" });
    host.dispatchEvent(touch);

    host.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);

    expect(isVisible()).toBe(false);
  });

  it("flips to the opposite side when the preferred side has no room", () => {
    // Top of the host is 2px from the viewport edge: a tooltip above it cannot fit.
    mockRects(rect(100, 2, 50, 10), 80, 20);
    host.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);

    const tip = tooltipEl() as HTMLElement;
    // Opposite side (bottom): host bottom (12) + 8px gap.
    expect(tip.style.top).toBe("20px");
    // Centred on the host: 100 + 25 - 40.
    expect(tip.style.left).toBe("85px");
  });
});
