import { describe, expect, it } from 'vitest';
import { placeTooltip } from './tooltip-placement';

const VIEW = { width: 1000, height: 800 };
const TIP = { width: 200, height: 100 };

describe('placeTooltip', () => {
  it('puts the tooltip below a host in the middle of the screen, left edges aligned', () => {
    expect(placeTooltip({ left: 480, top: 380, width: 40, height: 40 }, TIP, VIEW)).toEqual({
      left: 480,
      top: 428,
      side: 'bottom',
    });
  });

  it('keeps a host in the top left corner inside the margin', () => {
    expect(placeTooltip({ left: 0, top: 0, width: 40, height: 40 }, TIP, VIEW)).toEqual({
      left: 4,
      top: 48,
      side: 'bottom',
    });
  });

  it('clamps a host in the top right corner back into the viewport', () => {
    expect(placeTooltip({ left: 960, top: 0, width: 40, height: 40 }, TIP, VIEW)).toEqual({
      left: 796,
      top: 48,
      side: 'bottom',
    });
  });

  it('flips above a host in the bottom left corner', () => {
    expect(placeTooltip({ left: 0, top: 760, width: 40, height: 40 }, TIP, VIEW)).toEqual({
      left: 4,
      top: 652,
      side: 'top',
    });
  });

  it('flips above and clamps a host in the bottom right corner', () => {
    expect(placeTooltip({ left: 960, top: 760, width: 40, height: 40 }, TIP, VIEW)).toEqual({
      left: 796,
      top: 652,
      side: 'top',
    });
  });

  it('uses the right side when bottom and top do not fit a tall tooltip', () => {
    expect(placeTooltip({ left: 100, top: 380, width: 40, height: 40 }, { width: 200, height: 780 }, VIEW)).toEqual({
      left: 148,
      top: 10,
      side: 'right',
    });
  });

  it('uses the left side when only the left has room', () => {
    expect(placeTooltip({ left: 800, top: 380, width: 40, height: 40 }, { width: 200, height: 780 }, VIEW)).toEqual({
      left: 592,
      top: 10,
      side: 'left',
    });
  });

  it('places a huge tooltip on the side with most room and keeps it inside the viewport', () => {
    const spot = placeTooltip({ left: 480, top: 380, width: 40, height: 40 }, { width: 1500, height: 1200 }, VIEW);
    expect(spot).toEqual({ left: 4, top: 4, side: 'right' });
  });

  it('never returns a position outside the margins for a tooltip wider than the viewport', () => {
    const spot = placeTooltip({ left: 10, top: 10, width: 10, height: 10 }, { width: 5000, height: 50 }, VIEW);
    expect(spot.left).toBeGreaterThanOrEqual(4);
    expect(spot.top).toBeGreaterThanOrEqual(4);
  });
});
