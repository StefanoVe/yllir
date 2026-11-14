import { DOCUMENT, Injectable, inject } from "@angular/core";

export type TooltipPosition = "top" | "right" | "bottom" | "left";

/** Delay before a hovered control shows its tooltip. */
export const TOOLTIP_DELAY_MS = 400;

const TOOLTIP_ID = "ms-tooltip";
const STYLE_ID = "ms-tooltip-style";
/** Space between the host and the tooltip. */
const GAP = 8;
/** Minimum distance kept between the tooltip and the viewport edges. */
const MARGIN = 4;

const OPPOSITE: Record<TooltipPosition, TooltipPosition> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

const PERPENDICULAR: Record<TooltipPosition, TooltipPosition[]> = {
  top: ["right", "left"],
  bottom: ["right", "left"],
  left: ["top", "bottom"],
  right: ["top", "bottom"],
};

/**
 * Inverted square box, no arrow, no shadow. Colours come from the theme tokens, so light and dark
 * follow automatically. The fade is the only motion and it is off under reduced motion.
 */
const TOOLTIP_CSS = `
.ms-tooltip {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 1000;
  box-sizing: border-box;
  max-width: 240px;
  padding: 4px 8px;
  background: var(--color-text);
  color: var(--color-bg);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.3;
  white-space: normal;
  overflow-wrap: anywhere;
  border-radius: 0;
  box-shadow: none;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 120ms ease;
}
.ms-tooltip.ms-tooltip--visible {
  opacity: 1;
  visibility: visible;
}
@media (prefers-reduced-motion: reduce) {
  .ms-tooltip { transition: none; }
}
:root[data-motion="reduced"] .ms-tooltip {
  transition: none;
}
`;

interface Spot {
  left: number;
  top: number;
}

/**
 * The one tooltip element of the app, shared by every `msTooltip` host. Only one is visible at a
 * time. Plain DOM: the element lives in document.body and is positioned with `position: fixed`.
 */
@Injectable({ providedIn: "root" })
export class TooltipService {
  private readonly doc = inject(DOCUMENT);
  private el: HTMLElement | null = null;
  /** The host the tooltip is currently shown for, or null when hidden. */
  private owner: HTMLElement | null = null;
  /** The host that received aria-describedby, and the value it had before. */
  private ariaHost: HTMLElement | null = null;
  private ariaPrevious: string | null = null;

  private readonly onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.hide();
  };
  private readonly onDismiss = () => this.hide();

  /** True when the shared tooltip is currently shown for this host. */
  isOwnedBy(host: HTMLElement): boolean {
    return this.owner === host;
  }

  /** Shows (or moves to) the tooltip for `host` with the given text and preferred side. */
  show(host: HTMLElement, text: string, preferred: TooltipPosition): void {
    if (!text) {
      this.hide(host);
      return;
    }
    const el = this.ensureElement();
    if (this.owner !== host) {
      this.restoreDescribedBy();
      this.attachGlobalListeners();
    }
    this.owner = host;
    this.setDescribedBy(host);
    el.textContent = text;
    this.place(host, el, preferred);
    el.classList.add("ms-tooltip--visible");
  }

  /** Hides the tooltip. With a host, does nothing unless that host currently owns it. */
  hide(host?: HTMLElement): void {
    if (!this.owner || (host && host !== this.owner)) return;
    this.restoreDescribedBy();
    this.detachGlobalListeners();
    this.el?.classList.remove("ms-tooltip--visible");
    this.owner = null;
  }

  private ensureElement(): HTMLElement {
    if (this.el) return this.el;
    this.ensureStyle();
    const existing = this.doc.getElementById(TOOLTIP_ID);
    if (existing) {
      this.el = existing;
      return existing;
    }
    const el = this.doc.createElement("div");
    el.id = TOOLTIP_ID;
    el.className = "ms-tooltip";
    el.setAttribute("role", "tooltip");
    this.doc.body.appendChild(el);
    this.el = el;
    return el;
  }

  private ensureStyle(): void {
    if (this.doc.getElementById(STYLE_ID)) return;
    const style = this.doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = TOOLTIP_CSS;
    this.doc.head.appendChild(style);
  }

  /**
   * Adds the tooltip id to the host's aria-describedby. The host name comes from its own
   * aria-label or text; the directive never sets aria-label. Without either, nothing is added.
   */
  private setDescribedBy(host: HTMLElement): void {
    if (this.ariaHost === host) return;
    const named =
      host.hasAttribute("aria-label") || (host.textContent ?? "").trim() !== "";
    if (!named) return;
    const previous = host.getAttribute("aria-describedby");
    this.ariaHost = host;
    this.ariaPrevious = previous;
    host.setAttribute(
      "aria-describedby",
      previous ? `${previous} ${TOOLTIP_ID}` : TOOLTIP_ID,
    );
  }

  private restoreDescribedBy(): void {
    const host = this.ariaHost;
    if (!host) return;
    if (this.ariaPrevious === null) host.removeAttribute("aria-describedby");
    else host.setAttribute("aria-describedby", this.ariaPrevious);
    this.ariaHost = null;
    this.ariaPrevious = null;
  }

  /**
   * Tries the preferred side, then the opposite one, then the two perpendicular sides. Takes the
   * first that fits inside the viewport with a margin; if none fits, clamps the preferred one.
   */
  private place(host: HTMLElement, el: HTMLElement, preferred: TooltipPosition): void {
    const h = host.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const order: TooltipPosition[] = [
      preferred,
      OPPOSITE[preferred],
      ...PERPENDICULAR[preferred],
    ];
    const spots = order.map((side) => this.anchor(side, h, t));
    const fits = (spot: Spot) =>
      spot.left >= MARGIN &&
      spot.top >= MARGIN &&
      spot.left + t.width <= vw - MARGIN &&
      spot.top + t.height <= vh - MARGIN;

    const chosen = spots.find(fits) ?? this.clamp(spots[0], t, vw, vh);
    el.style.left = `${chosen.left}px`;
    el.style.top = `${chosen.top}px`;
  }

  private anchor(
    side: TooltipPosition,
    h: DOMRect,
    t: DOMRect,
  ): Spot {
    const centerX = h.left + h.width / 2 - t.width / 2;
    const centerY = h.top + h.height / 2 - t.height / 2;
    switch (side) {
      case "top":
        return { left: centerX, top: h.top - GAP - t.height };
      case "bottom":
        return { left: centerX, top: h.top + h.height + GAP };
      case "left":
        return { left: h.left - GAP - t.width, top: centerY };
      case "right":
        return { left: h.left + h.width + GAP, top: centerY };
    }
  }

  private clamp(spot: Spot, t: DOMRect, vw: number, vh: number): Spot {
    const maxLeft = vw - t.width - MARGIN;
    const maxTop = vh - t.height - MARGIN;
    return {
      left: Math.max(MARGIN, Math.min(spot.left, maxLeft)),
      top: Math.max(MARGIN, Math.min(spot.top, maxTop)),
    };
  }

  private attachGlobalListeners(): void {
    this.doc.addEventListener("keydown", this.onKeydown);
    window.addEventListener("scroll", this.onDismiss, { capture: true, passive: true });
    window.addEventListener("resize", this.onDismiss);
  }

  private detachGlobalListeners(): void {
    this.doc.removeEventListener("keydown", this.onKeydown);
    window.removeEventListener("scroll", this.onDismiss, { capture: true });
    window.removeEventListener("resize", this.onDismiss);
  }
}
