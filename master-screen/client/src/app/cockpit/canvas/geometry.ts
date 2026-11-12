import type { Rect } from "@shared/cockpit-types";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Viewport transform: screen = canvas * zoom + (x, y). */
export interface View {
  zoom: number;
  x: number;
  y: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Level of detail of the cards, from the zoom alone. */
export type Detail = "icon" | "compact" | "full";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function detailLevel(zoom: number): Detail {
  if (zoom < 0.45) return "icon";
  return zoom < 0.55 ? "compact" : "full";
}

/**
 * Multiplier for card text, in canvas units. Zoomed-out text grows so it stays
 * readable on screen; it never drops below the base size when zoomed in.
 */
export function textScale(zoom: number): number {
  // Grow text when zoomed out so titles stay readable, but cap it so they still fit the card.
  return Math.min(2.6, Math.max(1, 1 / zoom));
}

export function center(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Smallest rect containing every input rect. Empty input gives a zero rect. */
export function unionBounds(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.w));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function padRect(rect: Rect, margin: number): Rect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    w: rect.w + margin * 2,
    h: rect.h + margin * 2,
  };
}

/** Grows the rect on one axis until its width/height ratio matches `ratio`. */
export function withAspect(rect: Rect, ratio: number): Rect {
  const w = Math.max(rect.w, 1);
  const h = Math.max(rect.h, 1);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  if (w / h < ratio) {
    const nextW = h * ratio;
    return { x: cx - nextW / 2, y: rect.y, w: nextW, h };
  }
  const nextH = w / ratio;
  return { x: rect.x, y: cy - nextH / 2, w, h: nextH };
}

/**
 * Zoom range of the initial and "fit" view: the whole desk is shown when it fits
 * at FIT_MIN_ZOOM or more, never past 100%. Below the minimum the view keeps the
 * minimum and is panned, so card text stays readable.
 */
export const FIT_MIN_ZOOM = 0.6;
export const FIT_MAX_ZOOM = 1;

/**
 * View that shows `bounds` from the top-left corner, `margin` screen px from the
 * edges. Zoom is clamped to [FIT_MIN_ZOOM, FIT_MAX_ZOOM]: a small desk is not
 * blown up past 100%, and a desk too large for the minimum zoom keeps the minimum
 * and is panned.
 */
export function fitView(bounds: Rect, size: Size, margin: number): View {
  const fitX = (size.width - margin * 2) / Math.max(bounds.w, 1);
  const fitY = (size.height - margin * 2) / Math.max(bounds.h, 1);
  const zoom = Math.min(
    FIT_MAX_ZOOM,
    Math.max(FIT_MIN_ZOOM, Math.min(fitX, fitY)),
  );
  return {
    zoom,
    x: margin - bounds.x * zoom,
    y: margin - bounds.y * zoom,
  };
}

/** Whether a canvas rect lies entirely inside the area `size` that the view shows. */
export function isRectVisible(rect: Rect, view: View, size: Size): boolean {
  const left = rect.x * view.zoom + view.x;
  const top = rect.y * view.zoom + view.y;
  return (
    left >= 0 &&
    top >= 0 &&
    left + rect.w * view.zoom <= size.width &&
    top + rect.h * view.zoom <= size.height
  );
}

/** Zoom at which `rect` fits inside `size`, kept within [min, max]. */
export function fitRectWithin(
  rect: Rect,
  size: Size,
  min: number,
  max: number,
): number {
  const fit = Math.min(
    size.width / Math.max(rect.w, 1),
    size.height / Math.max(rect.h, 1),
  );
  return Math.min(max, Math.max(min, fit));
}

/** Position of a rect inside `bounds`, as CSS percentages (for the minimap). */
export function percentBox(rect: Rect, bounds: Rect) {
  return {
    left: ((rect.x - bounds.x) / bounds.w) * 100,
    top: ((rect.y - bounds.y) / bounds.h) * 100,
    width: (rect.w / bounds.w) * 100,
    height: (rect.h / bounds.h) * 100,
  };
}

/**
 * Point where the ray from the centre of `rect` towards `target` leaves the
 * rect. The ray exits through whichever edge it reaches first: horizontal
 * distance to the side (w/2 / |dx|) against vertical distance to top/bottom
 * (h/2 / |dy|), the smaller ratio wins.
 */
export function borderPoint(rect: Rect, target: Point): Point {
  const c = center(rect);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const tx = dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy);
  const t = Math.min(1, tx, ty);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Whether a point lies inside a rect, edges included. */
export function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.w &&
    point.y <= rect.y + rect.h
  );
}

/** Whether two rects overlap (touching edges do not count). */
export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/** Rect spanned by two corner points, whatever their order. */
export function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Straight link between two rects, from border to border. */
export function linkSegment(from: Rect, to: Rect): Segment {
  const start = borderPoint(from, center(to));
  const end = borderPoint(to, center(from));
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

/** Geometry of one card's text, in canvas units (font sizes already scaled by k). */
export interface CardText {
  w: number;
  h: number;
  /** Text scale: every font size is multiplied by it. */
  k: number;
  title: string;
  /** Width taken by the icons beside the title, gaps included. */
  headIconsWidth: number;
  hasThumb: boolean;
  hasSubtitle: boolean;
  hasStats: boolean;
  hasFooter: boolean;
}

/** Card paddings and gaps, as in the stylesheet. */
const CARD_PAD = 10;
const CARD_GAP = 6;
const CARD_BORDER = 2;
const CARD_HEAD_SIDES = 24;
const KIND_CHIP_PX = 24;
const TITLE_PX = 14;
const TITLE_LINE = 1.25;
/** Upper bound on the width of a title glyph (em): wraps earlier than the real font, which is safe. */
const TITLE_GLYPH_EM = 0.6;
const SUBTITLE_PX = 12;
const SUBTITLE_LINE = 1.25;
const SUMMARY_PX = 13;
const SUMMARY_LINE = 1.45;
const STATS_PX = 11;
const FOOTER_BUTTON_PX = 32;
/** Slack for sub-pixel rounding, so a line is never half shown. */
const CARD_SAFETY_PX = 2;

/** Lines the title takes: two at most, the second one ends in an ellipsis. */
export function titleLines(card: CardText): number {
  const width =
    card.w - CARD_HEAD_SIDES - KIND_CHIP_PX * card.k - CARD_GAP - card.headIconsWidth;
  const perLine = Math.max(1, Math.floor(width / (TITLE_PX * card.k * TITLE_GLYPH_EM)));
  return [...card.title].length > perLine ? 2 : 1;
}

/**
 * Whole lines of summary text that fit below the card header, subtitle and stats
 * (the thumbnail takes what is left). A line is never half shown.
 */
export function summaryLines(card: CardText): number {
  const k = card.k;
  const head =
    CARD_PAD * 2 +
    Math.max(KIND_CHIP_PX * k, titleLines(card) * TITLE_PX * k * TITLE_LINE);
  let used = head + CARD_PAD + CARD_BORDER + CARD_SAFETY_PX;
  if (card.hasFooter) used += FOOTER_BUTTON_PX + CARD_PAD;
  if (card.hasThumb) used += CARD_GAP;
  if (card.hasSubtitle) used += CARD_GAP + SUBTITLE_PX * k * SUBTITLE_LINE;
  if (card.hasStats) used += CARD_GAP + STATS_PX * k * 1.5 + 6;
  const lineHeight = SUMMARY_PX * k * SUMMARY_LINE;
  return Math.max(1, Math.floor((card.h - used) / lineHeight));
}
