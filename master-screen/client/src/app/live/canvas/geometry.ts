/** Pure geometry for the live canvas: screen <-> board transform, zoom, containment, hit-testing, snapping. */

export interface View {
  /** Screen position (px, inside the viewport) of the board origin. */
  panX: number;
  panY: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  width: number;
  height: number;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;
/** Grid step in board units. Drops and resizes snap to it; keyboard moves use it too. */
export const GRID = 8;
/** Board coordinates limit (mirrors the server: +-20000). */
export const COORD_LIMIT = 20000;
export const DEFAULT_VIEW: View = { panX: 0, panY: 0, zoom: 1 };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return clamp(zoom, ZOOM_MIN, ZOOM_MAX);
}

export function clampCoord(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, -COORD_LIMIT, COORD_LIMIT);
}

export function snap(value: number, step: number = GRID): number {
  return Math.round(value / step) * step;
}

export function screenToBoard(view: View, point: Point): Point {
  return { x: (point.x - view.panX) / view.zoom, y: (point.y - view.panY) / view.zoom };
}

export function boardToScreen(view: View, point: Point): Point {
  return { x: point.x * view.zoom + view.panX, y: point.y * view.zoom + view.panY };
}

/** Zoom by `factor` keeping the board point under `anchor` (screen px) where it is. Clamped to 25%..200%. */
export function zoomAt(view: View, factor: number, anchor: Point): View {
  const zoom = clampZoom(view.zoom * factor);
  const ratio = zoom / view.zoom;
  return {
    zoom,
    panX: anchor.x - (anchor.x - view.panX) * ratio,
    panY: anchor.y - (anchor.y - view.panY) * ratio,
  };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, panX: view.panX + dx, panY: view.panY + dy };
}

/**
 * Pinch: the board point that was under `startMid` at `startView` follows the
 * current midpoint `mid`, and the zoom follows the ratio of the finger distances.
 */
export function pinchView(startView: View, startMid: Point, mid: Point, distanceRatio: number): View {
  const zoom = clampZoom(startView.zoom * distanceRatio);
  const board = screenToBoard(startView, startMid);
  return {
    zoom,
    panX: mid.x - board.x * zoom,
    panY: mid.y - board.y * zoom,
  };
}

/** The view that shows `bounds` centred in the viewport with a margin; zoom never above 200%. */
export function fitView(bounds: Rect | null, size: Size, margin = 40): View {
  if (!bounds || size.width <= 0 || size.height <= 0) return { ...DEFAULT_VIEW };
  const fitZoom = Math.min(
    (size.width - 2 * margin) / Math.max(bounds.w, 1),
    (size.height - 2 * margin) / Math.max(bounds.h, 1),
  );
  const zoom = clampZoom(Math.min(fitZoom, ZOOM_MAX));
  return {
    zoom,
    panX: (size.width - bounds.w * zoom) / 2 - bounds.x * zoom,
    panY: (size.height - bounds.h * zoom) / 2 - bounds.y * zoom,
  };
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Smallest rectangle containing every rect, or null for none. */
export function unionBounds(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.w);
    bottom = Math.max(bottom, r.y + r.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function containsPoint(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

/** True when `inner` lies completely inside `outer`. */
export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export interface Hittable {
  id: string;
  rect: Rect;
}

/** The top-most item under the point: later items are drawn on top, so they win. */
export function hitTest(items: readonly Hittable[], point: Point): string | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (containsPoint(items[i].rect, point)) return items[i].id;
  }
  return null;
}

/** The frame a card belongs to when dropped: the top-most frame that contains the card's centre. */
export function frameForRect(frames: readonly Hittable[], card: Rect): string | null {
  return hitTest(frames, rectCenter(card));
}

/**
 * Where the segment from the centre of `rect` towards `toward` leaves the rectangle.
 * Used so arrows start and end on the border of cards and frames.
 */
export function edgePoint(rect: Rect, toward: Point): Point {
  const c = rectCenter(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx !== 0 ? rect.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? rect.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(sx, sy);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export interface ArrowSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Straight arrow from the border of `from` to the border of `to`. */
export function arrowSegment(from: Rect, to: Rect): ArrowSegment {
  const fromCenter = rectCenter(from);
  const toCenter = rectCenter(to);
  const start = edgePoint(from, toCenter);
  const end = edgePoint(to, fromCenter);
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

/** Size of a card or frame after a resize gesture, never below its minimum. */
export function resizedSize(origin: { w: number; h: number }, dx: number, dy: number, min: { w: number; h: number }): { w: number; h: number } {
  return {
    w: Math.max(min.w, origin.w + dx),
    h: Math.max(min.h, origin.h + dy),
  };
}
