/** Side of the host the tooltip sits on. */
export type TooltipSide = "bottom" | "top" | "right" | "left";

export interface TooltipBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TooltipViewport {
  width: number;
  height: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
  side: TooltipSide;
}

/** Space between the host and the tooltip. */
export const TOOLTIP_GAP = 8;
/** Minimum distance kept between the tooltip and the viewport edges. */
export const TOOLTIP_MARGIN = 4;

/** Order in which the sides are tried. */
const ORDER: TooltipSide[] = ["bottom", "top", "right", "left"];

/**
 * Places a tooltip next to its host inside the viewport, in position `fixed` coordinates.
 * Tries bottom, top, right, left in that order and takes the first side where the tooltip fits.
 * Bottom and top align the left edge with the host, right and left centre vertically; the
 * perpendicular axis is then clamped into the viewport. When no side fits, the side with the most
 * room is used and clamped. A tooltip larger than the viewport is shrunk to the viewport minus the
 * margins, so the caller can cap its size with the same numbers.
 */
export function placeTooltip(
  host: TooltipBox,
  tip: { width: number; height: number },
  viewport: TooltipViewport,
): TooltipPlacement {
  const vw = viewport.width;
  const vh = viewport.height;
  const maxW = Math.max(0, vw - 2 * TOOLTIP_MARGIN);
  const maxH = Math.max(0, vh - 2 * TOOLTIP_MARGIN);
  const w = Math.min(tip.width, maxW);
  const h = Math.min(tip.height, maxH);

  const hRight = host.left + host.width;
  const hBottom = host.top + host.height;
  const centreTop = host.top + host.height / 2 - h / 2;

  const fits: Record<TooltipSide, boolean> = {
    bottom: hBottom + TOOLTIP_GAP + h <= vh - TOOLTIP_MARGIN && w <= maxW,
    top: host.top - TOOLTIP_GAP - h >= TOOLTIP_MARGIN && w <= maxW,
    right: hRight + TOOLTIP_GAP + w <= vw - TOOLTIP_MARGIN && h <= maxH,
    left: host.left - TOOLTIP_GAP - w >= TOOLTIP_MARGIN && h <= maxH,
  };

  const anchor = (side: TooltipSide): { left: number; top: number } => {
    switch (side) {
      case "bottom":
        return { left: host.left, top: hBottom + TOOLTIP_GAP };
      case "top":
        return { left: host.left, top: host.top - TOOLTIP_GAP - h };
      case "right":
        return { left: hRight + TOOLTIP_GAP, top: centreTop };
      case "left":
        return { left: host.left - TOOLTIP_GAP - w, top: centreTop };
    }
  };

  const clampAxis = (value: number, size: number, span: number): number =>
    Math.max(TOOLTIP_MARGIN, Math.min(value, span - TOOLTIP_MARGIN - size));

  const finish = (side: TooltipSide): TooltipPlacement => {
    const spot = anchor(side);
    return {
      left: clampAxis(spot.left, w, vw),
      top: clampAxis(spot.top, h, vh),
      side,
    };
  };

  const first = ORDER.find((side) => fits[side]);
  if (first) return finish(first);

  // No side fits: the side with the most room, first in order on a tie.
  const room: Record<TooltipSide, number> = {
    bottom: vh - hBottom - TOOLTIP_GAP,
    top: host.top - TOOLTIP_GAP,
    right: vw - hRight - TOOLTIP_GAP,
    left: host.left - TOOLTIP_GAP,
  };
  let best = ORDER[0];
  for (const side of ORDER) if (room[side] > room[best]) best = side;
  return finish(best);
}
