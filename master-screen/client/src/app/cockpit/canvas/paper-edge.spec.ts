import { describe, expect, it } from 'vitest';
import { hashId, tiltCss, tiltDegrees, tornEdgePolygon } from './paper-edge';

const points = (polygon: string): Array<[number, number]> =>
  [...polygon.matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe('tornEdgePolygon', () => {
  it('gives the same string for the same id', () => {
    expect(tornEdgePolygon('card-7')).toBe(tornEdgePolygon('card-7'));
    expect(hashId('card-7')).toBe(hashId('card-7'));
  });

  it('gives different shapes for different ids', () => {
    expect(tornEdgePolygon('card-7')).not.toBe(tornEdgePolygon('card-8'));
  });

  it('keeps every point within 0 to 100 percent', () => {
    for (const id of ['a', 'b', 'Morvalle', 'npc:ilaria', '', 'x'.repeat(200)]) {
      for (const [x, y] of points(tornEdgePolygon(id))) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
    }
  });

  it('starts and ends on the four untouched corners', () => {
    const pts = points(tornEdgePolygon('card-7'));
    expect(pts).toContainEqual([0, 0]);
    expect(pts).toContainEqual([100, 0]);
    expect(pts).toContainEqual([100, 100]);
    expect(pts).toContainEqual([0, 100]);
  });

  it('moves edge points inward by at most the amplitude', () => {
    for (const [x, y] of points(tornEdgePolygon('card-7', { amplitude: 2.5 }))) {
      const onTop = y <= 2.5 && x > 0 && x < 100;
      const onBottom = y >= 97.5 && y < 100 && x > 0 && x < 100;
      const onLeft = x <= 2.5 && y > 0 && y < 100;
      const onRight = x >= 97.5 && x < 100 && y > 0 && y < 100;
      if (onTop) expect(y).toBeLessThanOrEqual(2.5);
      if (onBottom) expect(y).toBeGreaterThanOrEqual(97.5);
      if (onLeft) expect(x).toBeLessThanOrEqual(2.5);
      if (onRight) expect(x).toBeGreaterThanOrEqual(97.5);
    }
  });
});

describe('tiltDegrees', () => {
  it('is the same for the same id and stays between -1.5 and 1.5', () => {
    for (const id of ['a', 'b', 'card-7', 'Morvalle']) {
      expect(tiltDegrees(id)).toBe(tiltDegrees(id));
      expect(Math.abs(tiltDegrees(id))).toBeLessThanOrEqual(1.5);
    }
  });

  it('formats as a CSS angle', () => {
    expect(tiltCss('card-7')).toMatch(/^-?\d+(\.\d+)?deg$/);
  });
});
