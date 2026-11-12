import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW,
  GRID,
  ZOOM_MAX,
  ZOOM_MIN,
  arrowSegment,
  boardToScreen,
  clampZoom,
  containsPoint,
  containsRect,
  edgePoint,
  fitView,
  frameForRect,
  hitTest,
  pinchView,
  resizedSize,
  screenToBoard,
  snap,
  unionBounds,
  zoomAt,
  type View,
} from './geometry';

const view: View = { panX: 120, panY: -40, zoom: 1.5 };

describe('screen and board transform', () => {
  it('maps a board point to the screen and back', () => {
    const board = { x: 300, y: -75 };
    const screen = boardToScreen(view, board);
    expect(screen).toEqual({ x: 300 * 1.5 + 120, y: -75 * 1.5 - 40 });
    const back = screenToBoard(view, screen);
    expect(back.x).toBeCloseTo(board.x);
    expect(back.y).toBeCloseTo(board.y);
  });
});

describe('zoom', () => {
  it('clamps zoom between 25% and 200%', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(zoomAt(DEFAULT_VIEW, 100, { x: 0, y: 0 }).zoom).toBe(ZOOM_MAX);
    expect(zoomAt(DEFAULT_VIEW, 0.001, { x: 0, y: 0 }).zoom).toBe(ZOOM_MIN);
  });

  it('keeps the board point under the anchor where it was', () => {
    const anchor = { x: 410, y: 230 };
    const before = screenToBoard(view, anchor);
    const zoomed = zoomAt(view, 1.25, anchor);
    const after = screenToBoard(zoomed, anchor);
    expect(zoomed.zoom).toBeCloseTo(1.875);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('pinch moves with the midpoint and follows the finger distance', () => {
    const start = { panX: 0, panY: 0, zoom: 1 };
    const moved = pinchView(start, { x: 100, y: 100 }, { x: 130, y: 90 }, 1);
    expect(moved.zoom).toBe(1);
    expect(moved.panX).toBeCloseTo(30);
    expect(moved.panY).toBeCloseTo(-10);
    expect(pinchView(start, { x: 0, y: 0 }, { x: 0, y: 0 }, 3).zoom).toBe(ZOOM_MAX);
  });
});

describe('fitView', () => {
  it('centres the bounds in the viewport', () => {
    const v = fitView({ x: 0, y: 0, w: 400, h: 200 }, { width: 840, height: 440 }, 40);
    // 760 x 360 available: the height is the limit, 360 / 200 = 1.8.
    expect(v.zoom).toBeCloseTo(1.8);
    const topLeft = boardToScreen(v, { x: 0, y: 0 });
    const bottomRight = boardToScreen(v, { x: 400, y: 200 });
    expect(topLeft.x).toBeCloseTo(840 - bottomRight.x);
    expect(topLeft.y).toBeCloseTo(440 - bottomRight.y);
  });

  it('falls back to the default view with nothing to show', () => {
    expect(fitView(null, { width: 500, height: 500 })).toEqual(DEFAULT_VIEW);
    expect(fitView({ x: 0, y: 0, w: 10, h: 10 }, { width: 0, height: 0 })).toEqual(DEFAULT_VIEW);
  });
});

describe('snapping and containment', () => {
  it('snaps to the grid', () => {
    expect(snap(13)).toBe(16);
    expect(snap(11)).toBe(8);
    expect(snap(-13, GRID)).toBe(-16);
  });

  it('tells whether a rectangle lies fully inside another', () => {
    const frame = { x: 0, y: 0, w: 200, h: 200 };
    expect(containsRect(frame, { x: 10, y: 10, w: 50, h: 50 })).toBe(true);
    expect(containsRect(frame, { x: 180, y: 10, w: 50, h: 50 })).toBe(false);
    expect(containsPoint(frame, { x: 200, y: 200 })).toBe(true);
  });

  it('hit-tests the top-most item, and a card belongs to the frame at its centre', () => {
    const items = [
      { id: 'back', rect: { x: 0, y: 0, w: 300, h: 300 } },
      { id: 'front', rect: { x: 100, y: 100, w: 50, h: 50 } },
    ];
    expect(hitTest(items, { x: 120, y: 120 })).toBe('front');
    expect(hitTest(items, { x: 10, y: 10 })).toBe('back');
    expect(hitTest(items, { x: 999, y: 999 })).toBeNull();
    expect(frameForRect(items, { x: 110, y: 110, w: 20, h: 20 })).toBe('front');
    expect(frameForRect(items, { x: 400, y: 400, w: 20, h: 20 })).toBeNull();
  });

  it('unions rectangles and returns null for none', () => {
    expect(unionBounds([])).toBeNull();
    expect(
      unionBounds([
        { x: 10, y: 10, w: 10, h: 10 },
        { x: -5, y: 30, w: 5, h: 5 },
      ]),
    ).toEqual({ x: -5, y: 10, w: 25, h: 25 });
  });
});

describe('arrow geometry', () => {
  it('starts and ends on the borders of the two rectangles', () => {
    const from = { x: 0, y: 0, w: 100, h: 60 };
    const to = { x: 300, y: 0, w: 100, h: 60 };
    const seg = arrowSegment(from, to);
    expect(seg.x1).toBeCloseTo(100);
    expect(seg.y1).toBeCloseTo(30);
    expect(seg.x2).toBeCloseTo(300);
    expect(seg.y2).toBeCloseTo(30);
  });

  it('leaves a rectangle from the side it is pointed at, not from the centre', () => {
    const rect = { x: 0, y: 0, w: 100, h: 40 };
    expect(edgePoint(rect, { x: 500, y: 20 })).toEqual({ x: 100, y: 20 });
    const down = edgePoint(rect, { x: 50, y: 500 });
    expect(down.y).toBeCloseTo(40);
    expect(down.x).toBeCloseTo(50);
  });
});

describe('resizedSize', () => {
  it('never goes below the minimum', () => {
    expect(resizedSize({ w: 200, h: 100 }, -500, -500, { w: 120, h: 80 })).toEqual({ w: 120, h: 80 });
    expect(resizedSize({ w: 200, h: 100 }, 40, 10, { w: 120, h: 80 })).toEqual({ w: 240, h: 110 });
  });
});
